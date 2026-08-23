import re
import threading
from functools import lru_cache

import duckdb
import pandas as pd

from app.core import dataset_store
from app.core.config import DUCKDB_PATH

# A write (create_project/create_allocation/etc.) calls reload(), which clears
# this cache so the next get_connection() re-reads every CSV from disk into a
# fresh in-memory duckdb connection. Without the lock below, a request
# arriving concurrently with that rebuild could see the connection's tables
# mid CREATE-OR-REPLACE (duckdb doesn't guarantee that's safe to query from a
# second thread while it's happening) and 500 -- rare, but real, and much more
# likely right after a write that's immediately followed by a burst of reads
# (e.g. every wizard step's queries turning "enabled" the instant a project is
# created). The lock just serializes "rebuild the connection" against "hand
# out the connection" -- reads block briefly during a reload instead of racing it.
_reload_lock = threading.Lock()

@lru_cache(maxsize=1)
def _build_connection() -> duckdb.DuckDBPyConnection:
    con = duckdb.connect(str(DUCKDB_PATH))
    _load_all(con)
    return con

def get_connection() -> duckdb.DuckDBPyConnection:
    with _reload_lock:
        return _build_connection()

def _load_all(con: duckdb.DuckDBPyConnection) -> None:
    """Refreshes every known table in this in-memory DuckDB connection from
    Postgres (see app/core/dataset_store.py) -- NOT from a local file. A
    table that hasn't been uploaded via the Settings page yet simply isn't
    created here; queries against it raise a clear "table does not exist"
    instead of the app crashing on boot the way a missing local CSV used to.
    All cleaning (column sanitizing, date parsing, the demand-file/coe-skills
    quirks) already happened once at upload/write time -- see
    app/core/dataset_cleaning.py -- so what Postgres holds is already the
    exact shape DuckDB needs."""
    for table in dataset_store.KNOWN_TABLES:
        df = dataset_store.read_table(table)
        if df.empty and not dataset_store.table_exists(table):
            continue
        con.register("df_tmp", df)
        con.execute(f"CREATE OR REPLACE TABLE {table} AS SELECT * FROM df_tmp")
        con.unregister("df_tmp")

def get_cursor() -> duckdb.DuckDBPyConnection:
    return get_connection().cursor()

def _all_table_names() -> list[str]:
    return list(dataset_store.KNOWN_TABLES)

def table_counts() -> dict[str, int]:
    counts = {}
    cur = get_cursor()
    for t in _all_table_names():
        try:
            counts[t] = cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        except duckdb.Error:
            counts[t] = 0  # not uploaded yet
    return counts

@lru_cache(maxsize=1)
def get_schema_description() -> str:
    """Table(column type, ...) text block for every real table -- the schema
    reference an LLM needs to write a valid ad-hoc SQL query (see
    copilot_service.py's query_database tool). Cached like the connection
    itself; cleared in reload() since a reload can, in principle, change
    column shapes."""
    con = get_cursor()
    lines = []
    for table in _all_table_names():
        try:
            cols = con.execute(f"DESCRIBE {table}").fetchall()
        except duckdb.Error:
            continue
        col_list = ", ".join(f"{c[0]} {c[1]}" for c in cols)
        lines.append(f"{table}({col_list})")
    return "\n".join(lines)

class ReadOnlyQueryError(Exception):
    """Raised when an LLM-generated SQL string is rejected before execution,
    or when DuckDB itself errors while running it. The message is written to
    be genuinely useful as a tool-result: it goes straight back to the LLM so
    it can self-correct on the next attempt (see MAX_SQL_ATTEMPTS in
    copilot_service.py), so it always names exactly what was wrong."""

_LEADING_KEYWORD_RE = re.compile(r"^[a-zA-Z]+")
_ALLOWED_LEADING_KEYWORDS = {"select", "with"}

def _validate_readonly_sql(sql: str) -> str:
    cleaned = (sql or "").strip()
    # A single optional trailing semicolon is fine (models often add one) --
    # anything else semicolon-related is a multi-statement smuggling attempt,
    # caught below via extract_statements.
    if cleaned.endswith(";"):
        cleaned = cleaned[:-1].strip()
    if not cleaned:
        raise ReadOnlyQueryError("Empty SQL query -- write a real SELECT statement.")

    match = _LEADING_KEYWORD_RE.match(cleaned)
    leading = match.group(0).lower() if match else ""
    if leading not in _ALLOWED_LEADING_KEYWORDS:
        raise ReadOnlyQueryError(
            f"Rejected: only SELECT or WITH statements are allowed for read-only queries. "
            f"This statement starts with '{leading or cleaned[:20]}', which this tool never "
            f"permits (no INSERT/UPDATE/DELETE/DROP/ALTER/CREATE or any other write/DDL). "
            f"Rewrite it as a single SELECT/WITH query."
        )

    # Reject anything that isn't exactly one statement -- prevents smuggling a
    # second, mutating statement after a semicolon. duckdb's own parser is the
    # source of truth here (far more reliable than a keyword blocklist, which
    # would also risk false-positives on legitimate column/string content).
    con = get_connection()
    try:
        statements = con.extract_statements(cleaned)
    except duckdb.Error as exc:
        raise ReadOnlyQueryError(f"SQL parse error: {exc}. Fix the syntax and try again.") from exc
    if len(statements) != 1:
        raise ReadOnlyQueryError(
            "Rejected: only a single SQL statement is allowed per call -- remove any "
            "semicolon-separated extra statements and submit one SELECT/WITH query at a time."
        )
    return cleaned

def run_readonly_query(sql: str, max_rows: int = 200) -> dict:
    """Execute an LLM-generated, validated read-only SQL query against the
    real shared DuckDB connection (same data every other tool/adapter reads
    from) and return a JSON-safe {columns, rows, total_row_count, truncated}
    payload. Raises ReadOnlyQueryError -- with a message meant to be read by
    the LLM itself -- on anything rejected before execution or any DuckDB
    error during execution (bad column/table name, syntax error, etc)."""
    cleaned = _validate_readonly_sql(sql)
    cur = get_cursor()
    try:
        result_df = cur.execute(cleaned).fetchdf()
    except duckdb.Error as exc:
        raise ReadOnlyQueryError(f"SQL error: {exc}. Fix the query (check table/column names against the schema) and try again.") from exc

    total_row_count = len(result_df)
    truncated_df = result_df.head(max_rows)
    columns = [str(c) for c in truncated_df.columns]
    rows = []
    for record in truncated_df.itertuples(index=False, name=None):
        row = []
        for v in record:
            if isinstance(v, (list, dict, tuple, set)):
                row.append(v)
            elif pd.isna(v):
                row.append(None)
            elif hasattr(v, "isoformat"):
                row.append(v.isoformat())
            else:
                row.append(v)
        rows.append(row)

    return {
        "columns": columns,
        "rows": rows,
        "total_row_count": total_row_count,
        "truncated": total_row_count > max_rows,
    }

def reload() -> None:
    with _reload_lock:
        _build_connection.cache_clear()
        get_schema_description.cache_clear()
        from app.core.adapter import _cached_query

        _cached_query.cache_clear()
