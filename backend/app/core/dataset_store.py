"""Postgres-backed storage for every dataset table this app reads (via
app/core/db.py's in-memory DuckDB refresh). This is the ONE place a dataset's
cleaned rows get written after a Settings-page upload (admin_data_service.py,
jdwh_upload_service.py) or a live JIN Data Warehouse pull
(jdwh_connection_service.py), and read back from for db.py's refresh.

No dataset -- fake, synthetic, or real -- is read from or written to a local
file at runtime any more: every table below lives only in the Postgres/RDS
database named by DATABASE_URL (see app/core/pg.py), and the only way data
enters it is a Settings-page upload or a JDWH pull.

Every table keeps exactly ONE previous generation as a backup (renamed to
zz_backup__<table>), swapped back in by revert_table -- a deliberate scope cut
from the old local-file version's unlimited timestamped backups, since every
generation living in Postgres forever isn't worth the complexity for a
Settings-page "undo my last upload" safety net.
"""
import csv
from io import StringIO

import pandas as pd
from sqlalchemy import inspect, text

from app.core.pg import get_engine

KNOWN_TABLES = [
    "employees", "projects", "allocations", "timesheets", "skills", "competencies",
    "wsr_reports", "leaves", "weekly_pulse", "hr_feedback", "performance_cycles",
    "performance_kra_items", "budgets_jin", "budget_resources_jin",
    "pipeline_forecast", "pipeline_skillset", "pipeline_hierarchy", "pipeline_revenue",
    "coe_skills_mapping",
]

_BACKUP_PREFIX = "zz_backup__"


def _postgres_copy_insert(table, conn, keys, data_iter):
    """Fast bulk-load method for df.to_sql, used only against a real Postgres
    engine (see replace_table below) -- streams rows through COPY FROM STDIN
    instead of one INSERT per row/chunk. This is the difference between a
    100+ MB / 500k-row upload finishing in seconds vs. potentially timing out
    a request: pandas' default INSERT-based to_sql is dramatically slower at
    that scale, real enough to risk an upload failing outright on a large
    real export (e.g. timesheets, allocations)."""
    dbapi_conn = conn.connection
    buf = StringIO()
    writer = csv.writer(buf)
    writer.writerows(data_iter)
    buf.seek(0)
    columns = ", ".join(f'"{k}"' for k in keys)
    table_name = f'"{table.schema}"."{table.name}"' if table.schema else f'"{table.name}"'
    with dbapi_conn.cursor() as cur:
        cur.copy_expert(sql=f"COPY {table_name} ({columns}) FROM STDIN WITH CSV", file=buf)


def _to_sql_fast(df: pd.DataFrame, name: str, conn) -> None:
    """df.to_sql, using the COPY fast path when the engine is really Postgres
    (psycopg2) and falling back to the default (row-batched INSERT) method
    otherwise -- e.g. the SQLite engine this module's own tests run against,
    which has no COPY FROM STDIN equivalent."""
    is_postgres = conn.engine.dialect.name == "postgresql"
    df.to_sql(
        name, conn, if_exists="replace", index=False,
        method=_postgres_copy_insert if is_postgres else "multi",
        chunksize=10_000,
    )


def table_exists(table: str) -> bool:
    return inspect(get_engine()).has_table(table)


def read_table(table: str) -> pd.DataFrame:
    """This table's current contents, or an empty DataFrame if it hasn't been
    uploaded yet -- callers treat "not uploaded yet" as a normal, expected
    state (the app should start and show an empty state, not crash), not an
    error."""
    engine = get_engine()
    insp = inspect(engine)
    if not insp.has_table(table):
        return pd.DataFrame()
    df = pd.read_sql(f'SELECT * FROM "{table}"', engine)
    # pd.read_sql infers each column's pandas dtype from the VALUES it got
    # back, not from Postgres's real column type -- for a column that's
    # entirely NULL (e.g. date_of_resignation, genuinely all-blank in real
    # data) that means it silently comes back as plain `object`, not
    # datetime64, even though Postgres itself has it typed as a real
    # TIMESTAMP/DATE column. DuckDB then has to guess a type for that object
    # column when refreshing its own in-memory table (db.py's _load_all) and
    # picks INTEGER -- confirmed live: adapter.py's date comparison against
    # date_of_resignation crashed with "Invalid comparison between
    # dtype=int32 and Timestamp" the moment this table round-tripped through
    # a real Postgres instance with an all-null resignation column. Fixed at
    # the source: force any column Postgres itself calls DATE/TIMESTAMP back
    # to datetime64, regardless of whether every value happens to be NULL.
    for col in insp.get_columns(table):
        type_name = str(col["type"]).upper()
        if ("TIMESTAMP" in type_name or type_name == "DATE") and col["name"] in df.columns:
            df[col["name"]] = pd.to_datetime(df[col["name"]], errors="coerce")
    return df


def row_count(table: str) -> int | None:
    engine = get_engine()
    if not inspect(engine).has_table(table):
        return None
    with engine.connect() as conn:
        return conn.execute(text(f'SELECT COUNT(*) FROM "{table}"')).scalar()


def replace_table(table: str, df: pd.DataFrame, *, backup: bool = True) -> int:
    """Atomically replaces a table's contents: write the new data to a
    staging table, snapshot the table being replaced under
    zz_backup__<table> (dropping any older backup -- single generation only),
    then swap the staging table into place. Returns the row count written."""
    engine = get_engine()
    staging = f"_staging__{table}"
    with engine.begin() as conn:
        _to_sql_fast(df, staging, conn)
        insp = inspect(conn)
        if insp.has_table(table):
            if backup:
                conn.execute(text(f'DROP TABLE IF EXISTS "{_BACKUP_PREFIX}{table}"'))
                conn.execute(text(f'ALTER TABLE "{table}" RENAME TO "{_BACKUP_PREFIX}{table}"'))
            else:
                conn.execute(text(f'DROP TABLE IF EXISTS "{table}"'))
        conn.execute(text(f'ALTER TABLE "{staging}" RENAME TO "{table}"'))
    return len(df)


def has_backup(table: str) -> bool:
    return inspect(get_engine()).has_table(f"{_BACKUP_PREFIX}{table}")


def backup_row_count(table: str) -> int | None:
    return row_count(f"{_BACKUP_PREFIX}{table}")


def revert_table(table: str) -> bool:
    """Swaps a table's single stored backup back into place (and vice versa,
    so calling this twice in a row toggles rather than losing data). Returns
    False if there's no backup to revert to."""
    engine = get_engine()
    backup_name = f"{_BACKUP_PREFIX}{table}"
    with engine.begin() as conn:
        if not inspect(conn).has_table(backup_name):
            return False
        conn.execute(text(f'ALTER TABLE "{table}" RENAME TO "_swap__{table}"'))
        conn.execute(text(f'ALTER TABLE "{backup_name}" RENAME TO "{table}"'))
        conn.execute(text(f'ALTER TABLE "_swap__{table}" RENAME TO "{backup_name}"'))
    return True
