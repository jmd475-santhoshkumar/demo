"""Direct SQL connection to the real JIN Data Warehouse (Azure SQL Database),
as opposed to app/core/adapter.py's JinApiAdapter (a REST-API contract stub
that was never wired to a real endpoint). The data-warehouse team provisioned
exactly 6 tables under the `core` schema -- core.employee,
core.designation_history, core.project, core.project_allocation,
core.weekly_status_report, core.timesheet -- documented in the schema export
at backend/260815_Tables Schema(Schema).csv (column names/types only, no
real data; that file is safe to read and display).

Hard boundary (explicit instruction from the person who provisioned access):
this module must never be exercised against the real server by this
assistant -- no test connection, no table discovery, no real data pull.
Everything here is built to be triggered BY THE RESOURCE MANAGER from the
Settings UI, using their own Microsoft Entra ID sign-in (interactive,
MFA-capable, no credentials this app ever stores).

Two real actions, deliberately kept separate so a click can never do more
than its label says:
  - `connect_and_discover_tables` -- Connect. Touches only INFORMATION_SCHEMA
    metadata (table/column names) -- never a `SELECT *` or even
    `SELECT COUNT(*)` against the real tables, so this step alone can never
    expose a row of real data.
  - `pull_and_load_tables` -- Load Tables. A real `SELECT *` against the 5
    tables this app's data model actually uses (not designation_history, see
    jdwh_table_mapping.py), column-mapped via jdwh_table_mapping.map_all_tables
    and written over this app's local Transformed CSVs (existing files backed
    up first, same convention as admin_data_service.py's manual-upload
    backups) -- this is the step that genuinely changes what the app reads
    from, so the UI gates it behind an explicit confirmation separate from
    Connect.

The column mapping itself (jdwh_table_mapping.py) was built and validated
against a real, partially-masked UAT sample the data-warehouse team provided
(backend/jin_uat_data.ods) -- not against production, and never by this
assistant querying the real server.
"""
import csv
import json
from datetime import datetime

import pandas as pd

from app.core import appstate_db, dataset_store, db
from app.core.config import APP_STATE_DIR, BACKEND_ROOT
from app.services.jdwh_table_mapping import map_all_tables
from app.services.project_extension_history_service import EXTENSION_HISTORY_TABLE

_EXTENSION_HISTORY_FIELDS = ["project_code", "recorded_at", "from_end_date", "to_end_date", "status"]

JDWH_CONFIG_PATH = APP_STATE_DIR / "jdwh_connection.json"
SCHEMA_CSV_PATH = BACKEND_ROOT / "260815_Tables Schema(Schema).csv"

# The exact 6 tables the data-warehouse team provisioned access to -- see the
# schema CSV. Anything else under `core` (or another schema) was never
# granted, so discovery is scoped to only these, not a generic "list every
# table in the database" call.
EXPECTED_TABLES = [
    {"schema": "core", "table": "employee", "label": "Employee"},
    {"schema": "core", "table": "designation_history", "label": "Designation History"},
    {"schema": "core", "table": "project", "label": "Project"},
    {"schema": "core", "table": "project_allocation", "label": "Project Allocation"},
    # Newer, separately-provisioned table -- appears to be the live/current
    # counterpart to project_allocation (which stopped being updated for real
    # client/internal/managed-services work); optional since older/existing
    # connections may not have it yet -- see jdwh_table_mapping.map_rolebased_user_table.
    {"schema": "core", "table": "project_rolebased_user", "label": "Project Rolebased User (optional, current staffing)"},
    {"schema": "core", "table": "weekly_status_report", "label": "Weekly Status Report"},
    {"schema": "core", "table": "timesheet", "label": "Timesheet"},
]

AUTH_TYPES = [
    "Microsoft Entra ID - Universal with MFA support",
    "SQL Login",
    "Windows Authentication",
]

# Azure Data Studio's friendly labels -> the real ODBC Driver 18 `Encrypt`
# connection-string values (msodbcsql 17/18 only accept yes/no/strict).
ENCRYPT_OPTIONS = {"Mandatory": "yes", "Optional": "no", "Strict": "strict"}

DEFAULT_PORT = 1433


class JdwhConnectionError(Exception):
    pass


def _read_schema_csv() -> dict[str, list[dict]]:
    """Real column names/types per table, straight from the data-warehouse
    team's own schema export -- structural metadata only, never a row of
    real data, so this is always safe to read and show in the UI."""
    if not SCHEMA_CSV_PATH.exists():
        return {}
    tables: dict[str, list[dict]] = {}
    with SCHEMA_CSV_PATH.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            table = row.get("TABLE_NAME")
            if not table:
                continue
            tables.setdefault(table, []).append({
                "column": row.get("COLUMN_NAME"),
                "data_type": row.get("DATA_TYPE"),
                "nullable": (row.get("IS_NULLABLE") or "").strip().upper() == "YES",
                "ordinal_position": int(row["ORDINAL_POSITION"]) if row.get("ORDINAL_POSITION") else None,
            })
    for cols in tables.values():
        cols.sort(key=lambda c: c["ordinal_position"] or 0)
    return tables


def get_expected_tables() -> list[dict]:
    """The 6 provisioned tables plus their real column list (from the schema
    export) -- what the Settings UI shows before/without ever connecting, so
    an RM can see exactly what "Load Tables" will look for."""
    schema = _read_schema_csv()
    return [
        {**t, "columns": schema.get(t["table"], [])}
        for t in EXPECTED_TABLES
    ]


def _default_config() -> dict:
    # Deliberately blank, not prefilled with the real server/database -- an RM
    # seeing real-looking values already sitting in a fresh form (that nobody
    # entered) raises exactly the "where did this come from" question this
    # app should never invite. Only auth_type/encrypt keep a sensible default
    # (a dropdown pre-selection, not an identifying value); the frontend shows
    # the real values as example placeholder text instead, same as any blank
    # connection form.
    return {
        "profile_name": "",
        "server": "",
        "port": DEFAULT_PORT,
        "database": "",
        "auth_type": AUTH_TYPES[0],
        "account": "",
        "encrypt": "Mandatory",
        "trust_server_certificate": False,
    }


def get_jdwh_connection() -> dict:
    """UI-safe view of the saved (non-secret) connection profile -- there is
    no password/API key to hide here: Entra ID interactive auth stores no
    credential at all, just the account email to pre-fill the sign-in
    prompt."""
    if not JDWH_CONFIG_PATH.exists():
        return _default_config()
    try:
        saved = json.loads(JDWH_CONFIG_PATH.read_text())
    except (json.JSONDecodeError, OSError):
        return _default_config()
    return {**_default_config(), **saved}


def save_jdwh_connection(cfg: dict) -> dict:
    merged = {**_default_config(), **{k: v for k, v in cfg.items() if k in _default_config()}}
    if merged["auth_type"] not in AUTH_TYPES:
        raise JdwhConnectionError(f"Unknown authentication type '{merged['auth_type']}'.")
    if merged["encrypt"] not in ENCRYPT_OPTIONS:
        raise JdwhConnectionError(f"Unknown encrypt option '{merged['encrypt']}'.")
    JDWH_CONFIG_PATH.write_text(json.dumps(merged, indent=2))
    return merged


def build_connection_string(cfg: dict) -> str:
    """Pure string construction, no I/O -- matches Microsoft's documented
    ODBC Driver 18 for SQL Server connection-string keywords exactly (see
    learn.microsoft.com/sql/connect/odbc/dsn-connection-string-attribute).
    Entra ID interactive auth needs only the account (UID) -- the driver
    itself pops the real Microsoft sign-in/MFA prompt, no password or app
    registration required on this app's part."""
    server = (cfg.get("server") or "").strip()
    if not server:
        raise JdwhConnectionError("Server name is required.")
    database = (cfg.get("database") or "").strip()
    if not database:
        raise JdwhConnectionError("Database name is required.")
    port = int(cfg.get("port") or DEFAULT_PORT)
    encrypt = ENCRYPT_OPTIONS.get(cfg.get("encrypt") or "Mandatory")
    if encrypt is None:
        raise JdwhConnectionError(f"Unknown encrypt option '{cfg.get('encrypt')}'.")
    trust_cert = "yes" if cfg.get("trust_server_certificate") else "no"

    parts = [
        "Driver={ODBC Driver 18 for SQL Server}",
        f"Server=tcp:{server},{port}",
        f"Database={database}",
        f"Encrypt={encrypt}",
        f"TrustServerCertificate={trust_cert}",
    ]

    auth_type = cfg.get("auth_type") or AUTH_TYPES[0]
    if auth_type == "Microsoft Entra ID - Universal with MFA support":
        account = (cfg.get("account") or "").strip()
        if not account:
            raise JdwhConnectionError("A Microsoft account (email) is required for Microsoft Entra ID authentication.")
        parts.append("Authentication=ActiveDirectoryInteractive")
        parts.append(f"UID={account}")
    elif auth_type == "Windows Authentication":
        parts.append("Trusted_Connection=yes")
    elif auth_type == "SQL Login":
        account = (cfg.get("account") or "").strip()
        if not account:
            raise JdwhConnectionError("A username is required for SQL Login.")
        parts.append(f"UID={account}")
        # Password is deliberately never accepted/stored by this app for SQL
        # Login either -- if this auth type is ever actually used, it must be
        # entered fresh at connect time, not persisted in jdwh_connection.json.
        parts.append("PWD={pwd}")
    else:
        raise JdwhConnectionError(f"Unknown authentication type '{auth_type}'.")

    return ";".join(parts) + ";"


def connect_and_discover_tables(cfg: dict, password: str | None = None) -> dict:
    """Opens the real connection (triggering the native Microsoft sign-in/MFA
    popup for Entra ID auth) and checks ONLY which of the 6 expected tables
    exist and what their real columns are, via INFORMATION_SCHEMA -- never a
    SELECT against the tables themselves, so this can never return or expose
    a single row of real data, only structural metadata.

    Deliberately NEVER called by this assistant -- exists for the Resource
    Manager to trigger from the Settings UI with their own sign-in.
    """
    import pyodbc

    conn_str = build_connection_string(cfg)
    if "{pwd}" in conn_str:
        if not password:
            raise JdwhConnectionError("A password is required for SQL Login.")
        conn_str = conn_str.replace("{pwd}", password)

    try:
        conn = pyodbc.connect(conn_str, timeout=30)
    except pyodbc.Error as exc:
        raise JdwhConnectionError(f"Could not connect: {exc}") from exc

    try:
        cursor = conn.cursor()
        found: dict[str, bool] = {}
        columns_by_table: dict[str, list[dict]] = {}
        for t in EXPECTED_TABLES:
            cursor.execute(
                "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, ORDINAL_POSITION "
                "FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? "
                "ORDER BY ORDINAL_POSITION",
                t["schema"], t["table"],
            )
            rows = cursor.fetchall()
            found[t["table"]] = len(rows) > 0
            columns_by_table[t["table"]] = [
                {"column": r.COLUMN_NAME, "data_type": r.DATA_TYPE, "nullable": r.IS_NULLABLE == "YES"}
                for r in rows
            ]
    finally:
        conn.close()

    return {
        "success": True,
        "tables": [
            {**t, "found": found.get(t["table"], False), "columns": columns_by_table.get(t["table"], [])}
            for t in EXPECTED_TABLES
        ],
    }


# Which Postgres table (see app/core/dataset_store.py) each mapped source
# table replaces, and the exact column order db.py's cleaning expects.
_TARGET_TABLE = {
    "employees": (
        "employees",
        ["employee_id", "employee_full_name", "location", "date_of_join", "date_of_resignation", "job_name",
         "department_name", "manager_employee_id", "account_status", "is_active_version", "jin_employee_id",
         "jin_id_status"],
    ),
    "projects": (
        "projects",
        ["project_key", "project_code", "project_name", "project_start_date", "project_end_date", "type_of_project",
         "project_status", "reporter_employee_id", "approver_employee_id", "client_id", "tech_coe",
         "proposition_coe", "is_active_version", "date_source", "extended_end_date", "extended_end_status",
         "cluster_number", "jin_project_id"],
    ),
    "allocations": (
        "allocations",
        ["project_rolebased_user_id", "project_id", "employee_id", "resourcing_status",
         "allocated_start_date", "allocated_end_date", "is_allocation_active", "allocation_by_percentage",
         "is_active_version", "extended_end_date", "extended_status", "extended_start_date",
         "shift_type", "reviewer_employee_id"],
    ),
    "timesheets": (
        "timesheets",
        ["timesheet_surrogate_key", "employee_id", "timesheet_id", "manager_id", "project_id",
         "project_task_id", "date", "time", "status", "created_at", "updated_at", "job_name",
         "department_name", "billing_status"],
    ),
    "wsr_reports": (
        "wsr_reports",
        ["wsr_key", "wsr_id", "project_id_masked", "scope_status", "schedule_status", "quality_status",
         "csat_status", "team_status", "week_start_date", "week_end_date", "comment", "risk_note",
         "jin_allocations_updated", "team_timesheets_submitted", "devops_updated"],
    ),
}


def _fetch_table_as_dataframe(cursor, schema: str, table: str) -> pd.DataFrame:
    cursor.execute(f"SELECT * FROM [{schema}].[{table}]")
    columns = [c[0] for c in cursor.description]
    rows = cursor.fetchall()
    return pd.DataFrame.from_records(rows, columns=columns)


def pull_and_load_tables(cfg: dict, password: str | None = None) -> dict:
    """The real "Load Tables" action: pulls the 5 tables this app's data
    model uses (everything except designation_history -- see
    jdwh_table_mapping.py's module docstring), column-maps them via
    map_all_tables, backs up the current local CSVs, writes the mapped data
    in their place, and reloads the live DuckDB connection so every page
    immediately reflects it.

    Deliberately NEVER called by this assistant -- a real, consequential
    action (replaces this app's live data) that only the Resource Manager
    triggers, with their own Entra ID sign-in, from the Settings UI's
    explicit "Load Tables" confirmation.
    """
    import pyodbc

    conn_str = build_connection_string(cfg)
    if "{pwd}" in conn_str:
        if not password:
            raise JdwhConnectionError("A password is required for SQL Login.")
        conn_str = conn_str.replace("{pwd}", password)

    try:
        conn = pyodbc.connect(conn_str, timeout=30)
    except pyodbc.Error as exc:
        raise JdwhConnectionError(f"Could not connect: {exc}") from exc

    try:
        cursor = conn.cursor()
        raw = {
            "employee": _fetch_table_as_dataframe(cursor, "core", "employee"),
            "project": _fetch_table_as_dataframe(cursor, "core", "project"),
            "project_allocation": _fetch_table_as_dataframe(cursor, "core", "project_allocation"),
            "timesheet": _fetch_table_as_dataframe(cursor, "core", "timesheet"),
            "weekly_status_report": _fetch_table_as_dataframe(cursor, "core", "weekly_status_report"),
        }
        # Optional -- not every connection has this table provisioned yet.
        # Its absence shouldn't fail the whole load, just skip the extra
        # current-staffing signal it provides (see map_rolebased_user_table).
        try:
            rolebased = _fetch_table_as_dataframe(cursor, "core", "project_rolebased_user")
            if not rolebased.empty:
                raw["project_rolebased_user"] = rolebased
        except pyodbc.Error:
            pass
    finally:
        conn.close()

    mapped = map_all_tables(raw)
    return write_mapped_tables(mapped)


def write_mapped_tables(mapped: dict, on_progress=None) -> dict:
    """Shared by every real data source (live SQL pull above, or an uploaded
    workbook/files -- see jdwh_upload_service.py): backs up the table being
    replaced (one generation, see dataset_store.replace_table), writes the
    mapped tables into Postgres matching db.py's exact expected column order,
    and reloads the live DuckDB connection so every page immediately reflects
    it. No local file is read or written anywhere in this path.

    A table mapping to 0 rows is a real, silent failure mode -- it usually
    means the source's employee/project master data didn't cover the
    transactional rows being mapped (every row's employee_id/project_id
    lookup failed, so map_allocation_table/map_timesheet_table/map_wsr_table's
    own dropna() correctly dropped everything -- confirmed happening with a
    small demo-scale sample against a much larger fact table). An empty table
    also breaks numeric-column type inference on reload (an all-blank column
    can come back as string-typed, breaking arithmetic elsewhere in the app
    the moment anything reads it) -- so this is flagged back to the caller
    rather than silently written."""
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    row_counts = {}
    empty_tables = []
    n_tables = len(mapped)
    for i, (key, df) in enumerate(mapped.items()):
        if on_progress:
            on_progress(40 + int(50 * i / n_tables), f"Writing {key}")
        table, columns = _TARGET_TABLE[key]
        # map_all_tables already returns properly-typed columns (dates as
        # real datetime64, not strings) -- reindex to db.py's expected column
        # order only, without re-running clean_table's date parsing, which
        # only knows how to parse strings and would be a no-op-or-worse on
        # already-datetime columns.
        out = df.reindex(columns=columns).copy()
        dataset_store.replace_table(table, out)
        row_counts[key] = len(out)
        if len(out) == 0:
            empty_tables.append(key)

    if "projects" in mapped:
        _backfill_extension_history(mapped["projects"])

    if on_progress:
        on_progress(95, "Refreshing app data")
    db.reload()

    return {
        "success": True,
        "row_counts": row_counts,
        "backup_timestamp": stamp,
        "empty_tables": empty_tables,
    }


def _backfill_extension_history(projects: pd.DataFrame) -> None:
    """The Extensions tab's history table reads project_extensions.csv, an
    append-only log this app only ever writes to when the RM clicks "Extend
    end date" in the UI (see allocation_report_service.extend_project_end_date).
    A project loaded from JDWH with extended_end_date already populated (a
    real extension the source itself already recorded, e.g. DNS_011:
    2026-02-16 -> 2026-08-31) never went through that button, so it never got
    a history row -- the Overview tab correctly showed "end date changed"
    (reads project_extended_end_date directly), but the Extensions tab's
    history table incorrectly showed "No extensions recorded yet." Backfills
    one entry per real, already-extended project on load. Status is left
    blank (None) since JDWH doesn't classify these as BILLABLE/UNBILLABLE the
    way an in-app extension decision does.

    Reads and writes the project_extensions table exactly ONCE, not once per
    project -- an earlier version called record_extension/get_extension_history
    (each their own full read-or-rewrite) inside this loop, which is fine for
    a handful of UAT projects but becomes real O(n^2) I/O at production scale
    (2,000+ real projects, hundreds with a real extension) -- confirmed as the
    likely cause of a real Load Tables timeout/500 against the real JDWH
    warehouse."""
    extended = projects[projects["extended_end_date"].notna()]
    if extended.empty:
        return

    existing = appstate_db.read_all(EXTENSION_HISTORY_TABLE, _EXTENSION_HISTORY_FIELDS)
    already_recorded = set(zip(existing["project_code"], existing["from_end_date"], existing["to_end_date"]))

    now = pd.Timestamp.now().isoformat(timespec="seconds")
    new_rows = []
    for _, row in extended.iterrows():
        to_date = row["extended_end_date"].strftime("%Y-%m-%d")
        from_date = row["project_end_date"].strftime("%Y-%m-%d") if pd.notna(row["project_end_date"]) else ""
        project_code = row["project_code"]
        if (project_code, from_date, to_date) in already_recorded:
            continue
        new_rows.append({
            "project_code": project_code, "recorded_at": now,
            "from_end_date": from_date, "to_end_date": to_date, "status": "",
        })
        already_recorded.add((project_code, from_date, to_date))

    if new_rows:
        combined = pd.concat([existing, pd.DataFrame(new_rows)], ignore_index=True)
        appstate_db.write_all(EXTENSION_HISTORY_TABLE, combined)


def list_jdwh_backups() -> list[dict]:
    """Whether the last Load Tables action's backup is available, plus each
    table's real row count -- so a broken backup (0 or near-0 rows in a table
    that should have thousands, e.g. allocations/timesheets) is visible
    before choosing to revert to it.

    Unlike the old local-file version, this keeps exactly ONE generation (the
    state right before the most recent Load Tables click), not an unlimited
    timestamped history -- see dataset_store.replace_table's own note on this
    scope cut. "backup_timestamp" is therefore informational only (when the
    last load ran), not a selector -- revert_to_backup has nothing to pick
    between any more."""
    tables = [t for t, _ in _TARGET_TABLE.values()]
    if not any(dataset_store.has_backup(t) for t in tables):
        return []
    return [{
        "available": True,
        "row_counts": {
            key: dataset_store.backup_row_count(table)
            for key, (table, _columns) in _TARGET_TABLE.items()
            if dataset_store.has_backup(table)
        },
    }]


def revert_to_backup(timestamp: str | None = None) -> dict:
    """Restores every JDWH-mapped table from its single stored backup,
    undoing the last Load Tables action. `timestamp` is accepted for API
    compatibility with the old multi-generation version but ignored -- there
    is only ever one generation to revert to now (see list_jdwh_backups)."""
    restored = [key for key, (table, _columns) in _TARGET_TABLE.items() if dataset_store.revert_table(table)]
    if not restored:
        raise JdwhConnectionError("No JIN Data Warehouse load has been backed up yet -- nothing to revert to.")
    db.reload()
    return {"success": True, "restored_tables": restored}
