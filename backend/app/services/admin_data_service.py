import io

import pandas as pd

from app.core import adapter, dataset_store, db
from app.core.dataset_cleaning import clean_coe_skills_mapping, clean_demand_file, clean_table
from app.services.project_appstate_service import get_row, upsert_row
from app.services.skill_matrix_transform import (
    is_wide_survey_export,
    read_csv_robust,
    transform_wide_skill_matrix,
)

# Bookkeeping only (filename/upload time for the Settings UI) -- reuses
# project_appstate_service's generic single-row-per-key table even though the
# "key" here is a dataset key, not a project_code; the helper never actually
# cares what the key represents.
_UPLOAD_LOG_TABLE = "dataset_upload_log"

# These are the real datasets the Resourcing/RMG team maintains OUTSIDE the
# JIN data warehouse (skill matrix and competency live in separately managed
# spreadsheets; the demand file is the real, live pipeline/deal list; the old
# pipeline workbook still supplies Skillset/Hierarchy/6 Months Revenue, which
# have no equivalent in the demand file). Employees/projects/allocations/
# timesheets/WSR are NOT here -- those come from the JIN warehouse itself (see
# jdwh_upload_service.py / jdwh_connection_service.py), not this manual-upload
# path.
#
# Every one of these tables lives only in Postgres (see
# app/core/dataset_store.py) -- an upload here never touches a local file.
DATASET_REGISTRY = {
    "skill_matrix": {
        "label": "Skill Matrix",
        "description": "Per-employee skill ratings.",
        "file_type": "csv",
        "tables": [{"table": "skills", "sheet_name": None, "label": "Skill Matrix"}],
        "required_columns": ["employee_id"],
    },
    "competency": {
        "label": "Competency",
        "description": "Per-employee competency scores.",
        "file_type": "csv",
        "tables": [{"table": "competencies", "sheet_name": None, "label": "Competency"}],
        "required_columns": ["employee_id"],
    },
    "demand_file": {
        "label": "Demand File",
        "description": "Live pipeline/demand deal list.",
        "file_type": "xlsx",
        "tables": [{"table": "pipeline_forecast", "sheet_name": 0, "label": "Demand"}],
        "required_columns": [],
    },
    "pipeline_data": {
        "label": "Pipeline Data (Skillset/Hierarchy/Revenue)",
        "description": "Skillset, Hierarchy, and 6 Months Revenue from the pipeline workbook.",
        "file_type": "xlsx",
        "tables": [
            {"table": "pipeline_skillset", "sheet_name": "Skillset", "label": "Skillset"},
            {"table": "pipeline_hierarchy", "sheet_name": "Hierarchy", "label": "Hierarchy"},
            {"table": "pipeline_revenue", "sheet_name": "6 Months Revenue", "label": "6 Months Revenue"},
        ],
        "required_columns": [],
    },
    # Everything below has no dedicated Settings-page upload path before this
    # entry -- added so EVERY table this app reads (see
    # dataset_store.KNOWN_TABLES) can actually be populated once the app has
    # no bundled local files at all (see DEPLOYMENT_PLAN.md section 0).
    # leaves/weekly_pulse/hr_feedback/performance_* are synthetic in the
    # current dataset (no real export was provided); budgets_jin/
    # budget_resources_jin are real JIN budget-approval workflow data.
    "leaves": {
        "label": "Leave Details",
        "description": "Employee leave/absence records.",
        "file_type": "csv",
        "tables": [{"table": "leaves", "sheet_name": None, "label": "Leave Details"}],
        "required_columns": ["employee_id"],
    },
    "weekly_pulse": {
        "label": "Weekly Pulse Survey",
        "description": "Weekly employee sentiment survey responses.",
        "file_type": "csv",
        "tables": [{"table": "weekly_pulse", "sheet_name": None, "label": "Weekly Pulse"}],
        "required_columns": [],
    },
    "hr_feedback": {
        "label": "HR Feedback",
        "description": "HR feedback tied to employee/project allocations.",
        "file_type": "csv",
        "tables": [{"table": "hr_feedback", "sheet_name": None, "label": "HR Feedback"}],
        "required_columns": [],
    },
    "performance_cycles": {
        "label": "Performance Cycles",
        "description": "Performance appraisal cycle metadata.",
        "file_type": "csv",
        "tables": [{"table": "performance_cycles", "sheet_name": None, "label": "Performance Cycles"}],
        "required_columns": [],
    },
    "performance_kra_items": {
        "label": "Performance KRA Items",
        "description": "KRA line items per performance cycle.",
        "file_type": "csv",
        "tables": [{"table": "performance_kra_items", "sheet_name": None, "label": "Performance KRA Items"}],
        "required_columns": [],
    },
    "budgets_jin": {
        "label": "JIN Budget",
        "description": "JIN budget-approval header records.",
        "file_type": "csv",
        "tables": [{"table": "budgets_jin", "sheet_name": None, "label": "JIN Budget"}],
        "required_columns": [],
    },
    "budget_resources_jin": {
        "label": "JIN Budget Resources",
        "description": "JIN budget-approval resource-line records.",
        "file_type": "csv",
        "tables": [{"table": "budget_resources_jin", "sheet_name": None, "label": "JIN Budget Resources"}],
        "required_columns": [],
    },
    "coe_skills_mapping": {
        "label": "CoE Skills Mapping",
        "description": "Per-CoE required-skills reference list.",
        "file_type": "csv",
        "tables": [{"table": "coe_skills_mapping", "sheet_name": None, "label": "CoE Skills Mapping"}],
        "required_columns": ["coe"],
    },
}


class DatasetValidationError(Exception):
    pass


def _row_count(table: str) -> int | None:
    try:
        return db.table_counts().get(table)
    except Exception:
        return None


def list_data_sources() -> list[dict]:
    out = []
    for key, meta in DATASET_REGISTRY.items():
        log = get_row(_UPLOAD_LOG_TABLE, key)
        out.append({
            "key": key,
            "label": meta["label"],
            "description": meta["description"],
            "file_type": meta["file_type"],
            "current_filename": log.get("filename") if log else None,
            "row_count": _row_count(meta["tables"][0]["table"]),
            "last_modified": log.get("uploaded_at") if log else None,
            "source": "Manual upload (outside JIN warehouse)",
        })
    return out


def get_connection_status() -> dict:
    """Honest status, not a simulated connection -- see app/core/adapter.py's
    JinApiAdapter, which is a real production-contract stub that raises until
    real credentials/base URL are wired in. Switching to JIN mode before that
    happens would break every page, on purpose -- there is no fake-success
    state here."""
    cfg = adapter.get_connection_config()
    jin_configured = bool(cfg["base_url"] and cfg["has_api_key"])
    jin_connected = cfg["mode"] == "jin" and jin_configured
    return {
        "mode": cfg["mode"],
        "jin_base_url": cfg["base_url"],
        "jin_has_api_key": cfg["has_api_key"],
        "jin_configured": jin_configured,
        "jin_connected": jin_connected,
        "message": (
            "Connected to the JIN Data Warehouse."
            if jin_connected
            else "Not connected -- awaiting JIN Data Warehouse credentials/access. Running on Postgres-backed data (uploaded above + via the JIN upload flow)."
        ),
    }


def save_connection(mode: str, base_url: str | None, api_key: str | None) -> dict:
    adapter.save_connection_config(mode, base_url, api_key)
    return get_connection_status()


def test_connection() -> dict:
    return adapter.test_connection()


def get_dataset_preview(key: str, max_rows: int = 20) -> dict:
    """The REAL, currently-loaded data for this dataset -- straight from the
    same DuckDB tables every other page in this app reads from (via
    db.run_readonly_query, which already handles JSON-safe date/NaN
    conversion), not a re-read of a raw file. This is "what we have right
    now", so Siva/the RM can see exactly what's live before deciding whether
    a replacement is even needed."""
    meta = DATASET_REGISTRY.get(key)
    if meta is None:
        raise DatasetValidationError(f"Unknown dataset '{key}'.")
    tables = []
    for t in meta["tables"]:
        try:
            result = db.run_readonly_query(f"SELECT * FROM {t['table']}", max_rows=max_rows)
        except db.ReadOnlyQueryError as exc:
            result = {"columns": [], "rows": [], "total_row_count": 0, "truncated": False, "error": str(exc)}
        tables.append({"label": t["label"], **result})
    return {"key": key, "label": meta["label"], "tables": tables}


def _json_safe(v):
    if isinstance(v, (list, dict)):
        return v
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v


def _sample_rows(df: pd.DataFrame, n: int = 3) -> list[dict]:
    return [{str(c): _json_safe(row[c]) for c in df.columns} for _, row in df.head(n).iterrows()]


def get_dataset_schema(key: str) -> dict:
    """The expected format for a REPLACEMENT upload -- read live from
    whatever is currently in Postgres for this dataset's table(s) (the data
    this app is actually running on right now is, by definition, an accepted
    format), shown as column names + a few real sample rows so Siva/the RM
    can match column names, casing, and date format exactly rather than
    guessing."""
    meta = DATASET_REGISTRY.get(key)
    if meta is None:
        raise DatasetValidationError(f"Unknown dataset '{key}'.")

    sheets = []
    for t in meta["tables"]:
        df = dataset_store.read_table(t["table"])
        if df.empty and not dataset_store.table_exists(t["table"]):
            continue
        sheets.append({"sheet_name": t["label"], "columns": [str(c) for c in df.columns], "sample_rows": _sample_rows(df)})
    if not sheets:
        raise DatasetValidationError(f"No current data exists yet for '{key}' to derive an expected format from -- upload one to establish it.")
    return {"key": key, "label": meta["label"], "file_type": meta["file_type"], "sheets": sheets}


def _build_employee_lookup() -> dict[str, dict]:
    """employee_id (and, once a real email/name field exists in the employee
    master data, email) -> {employee_id, job_name, department_name}, for
    resolving a Skills Matrix survey respondent to a real employee. Keyed by
    employee_id today since that's the only real identifier this app's
    employee master data carries -- see skill_matrix_transform.py's module
    docstring for why email/name can't be matched yet. Always the LOCAL
    adapter regardless of the active connection mode -- this manual upload
    feature exists specifically for data that lives outside JIN, so it
    shouldn't depend on whatever get_adapter() currently resolves to."""
    employees = adapter.LocalAdapter().get_employees()
    lookup: dict[str, dict] = {}
    for _, r in employees.iterrows():
        emp = {"employee_id": r["employee_id"], "job_name": r.get("job_name"), "department_name": r.get("department_name")}
        lookup[str(r["employee_id"]).strip().lower()] = emp
        email = r.get("email") if "email" in employees.columns else None
        if email and pd.notna(email):
            lookup[str(email).strip().lower()] = emp
    return lookup


def _log_upload(key: str, filename: str) -> None:
    upsert_row(_UPLOAD_LOG_TABLE, key, {"filename": filename, "uploaded_at": pd.Timestamp.now().isoformat(timespec="seconds")})


def _handle_wide_skill_matrix_upload(df: pd.DataFrame, filename: str) -> dict:
    lookup = _build_employee_lookup()
    result = transform_wide_skill_matrix(df, lookup)

    if not result["rows"]:
        sample = ", ".join(result["unmatched_emails"][:5])
        raise DatasetValidationError(
            f"This looks like the real Skills Matrix survey export -- it identifies "
            f"{result['respondent_count']} respondent(s) by email, but none could be matched to a "
            f"real employee_id: this app's employee master data has no email or name field to match "
            f"against, only employee_id. Fastest fix: add an 'Employee ID' column to this export "
            f"(e.g. EMP123, cross-referenced by HR/Siva against the email) and re-upload -- this file "
            f"will ingest automatically once that column exists. Sample respondent email(s) from this "
            f"file: {sample}."
        )

    long_df = clean_table("skills", pd.DataFrame(result["rows"]))
    dataset_store.replace_table("skills", long_df)
    _log_upload("skill_matrix", filename)
    db.reload()

    updated = next(d for d in list_data_sources() if d["key"] == "skill_matrix")
    updated["unmatched_respondent_count"] = len(result["unmatched_emails"])
    updated["matched_respondent_count"] = result["matched_count"]
    return updated


def _validate_csv_columns(meta: dict, df_head: pd.DataFrame) -> None:
    if len(df_head.columns) == 0:
        raise DatasetValidationError("This file has no columns -- is it the right file?")
    cols_lower = {c.strip().lower() for c in df_head.columns}
    missing = [c for c in meta["required_columns"] if c.lower() not in cols_lower]
    if missing:
        raise DatasetValidationError(
            f"This file is missing required column(s): {', '.join(missing)}. Found: {', '.join(df_head.columns)}."
        )


def _validate_workbook_sheets(meta: dict, xl: pd.ExcelFile) -> None:
    # Required sheets are derived per-dataset from its own registry entry,
    # not a fixed global list -- pipeline_data still needs its 3 named
    # sheets, while demand_file just needs at least one sheet at all (its own
    # sheet_name is a position, 0, not a name to look for).
    required_names = [t["sheet_name"] for t in meta["tables"] if isinstance(t["sheet_name"], str)]
    missing_sheets = [s for s in required_names if s not in xl.sheet_names]
    if missing_sheets:
        raise DatasetValidationError(
            f"This workbook is missing required sheet(s): {', '.join(missing_sheets)}. "
            f"Found: {', '.join(xl.sheet_names)}."
        )
    required_positions = [t["sheet_name"] for t in meta["tables"] if isinstance(t["sheet_name"], int)]
    if required_positions and len(xl.sheet_names) <= max(required_positions):
        raise DatasetValidationError(
            f"This workbook needs at least {max(required_positions) + 1} sheet(s); found {len(xl.sheet_names)}."
        )


def upload_dataset(key: str, filename: str, content: bytes, on_progress=None) -> dict:
    """Parses, cleans, and writes a dataset upload -- deliberately parses the
    file exactly ONCE per sheet (validation reuses the same parsed head/
    ExcelFile handle the real load uses right after) rather than a separate
    validate-then-reparse pass, since a real export can be hundreds of MB and
    parsing it twice is a real, avoidable cost at that size, not a rounding
    error.

    `on_progress`, if given, is called as `on_progress(pct: int, message: str)`
    at coarse checkpoints -- this is a genuinely slow, CPU/IO-heavy call for a
    large real export, so the router wraps it in a background thread (see
    routers/admin.py) and uses these checkpoints to give the frontend a real
    (if coarse) progress bar instead of a bare spinner."""
    def report(pct: int, message: str) -> None:
        if on_progress:
            on_progress(pct, message)

    meta = DATASET_REGISTRY.get(key)
    if meta is None:
        raise DatasetValidationError(f"Unknown dataset '{key}'.")

    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    expected_ext = meta["file_type"]
    if ext != expected_ext:
        raise DatasetValidationError(f"{meta['label']} expects a .{expected_ext} file, got .{ext or '?'}.")

    if meta["file_type"] == "csv":
        report(10, "Parsing CSV")
        try:
            raw_df = read_csv_robust(io.BytesIO(content))
        except Exception as exc:
            raise DatasetValidationError(f"Could not parse this file as a CSV: {exc}") from exc

        if key == "skill_matrix" and is_wide_survey_export(raw_df.columns):
            return _handle_wide_skill_matrix_upload(raw_df, filename)

        _validate_csv_columns(meta, raw_df.head(5))
        report(40, "Cleaning data")
        table = meta["tables"][0]["table"]
        cleaned = clean_coe_skills_mapping(raw_df) if table == "coe_skills_mapping" else clean_table(table, raw_df)
        report(65, "Writing to database")
        dataset_store.replace_table(table, cleaned)
    else:
        report(10, "Reading workbook")
        try:
            xl = pd.ExcelFile(io.BytesIO(content))
        except Exception as exc:
            raise DatasetValidationError(f"Could not parse this file as an Excel workbook: {exc}") from exc
        _validate_workbook_sheets(meta, xl)
        n_tables = len(meta["tables"])
        for i, t in enumerate(meta["tables"]):
            report(20 + int(50 * i / n_tables), f"Processing {t['label']}")
            raw_df = xl.parse(t["sheet_name"])
            if t["table"] == "pipeline_forecast":
                cleaned = clean_demand_file(raw_df)
            else:
                cleaned = clean_table(t["table"], raw_df)
            dataset_store.replace_table(t["table"], cleaned)

    report(95, "Refreshing app data")
    _log_upload(key, filename)
    db.reload()

    return next(d for d in list_data_sources() if d["key"] == key)
