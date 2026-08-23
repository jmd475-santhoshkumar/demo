"""Shared per-table cleaning logic for every dataset this app stores in
Postgres (see app/core/dataset_store.py). This used to run once, at DuckDB
load time, against local CSV/XLSX files (see app/core/db.py's old _load_all).
Now that Postgres -- not a bundled file -- is the source of truth, the same
cleaning has to run once at WRITE time (a Settings-page upload, or a JIN Data
Warehouse pull), before the cleaned rows ever reach the database, so what's
stored is already the correctly-typed, ready-to-query shape. db.py's DuckDB
refresh then just reads it back as-is.
"""
import re

import pandas as pd

_DATE_COLUMNS = {
    "projects": ["project_start_date", "project_end_date", "extended_end_date"],
    "allocations": ["allocated_start_date", "allocated_end_date", "extended_end_date", "extended_start_date"],
    "leaves": ["leave_start_date", "leave_end_date"],
    "timesheets": ["date", "created_at", "updated_at"],
    "wsr_reports": ["week_start_date", "week_end_date"],
    "hr_feedback": ["feedback_date"],
    "performance_cycles": ["published_on", "form_end_date"],
    "budgets_jin": ["createdat", "updatedat", "reviewedat"],
    "budget_resources_jin": ["startdate"],
}

_EXPLICIT_FORMAT_DATE_COLUMNS = {
    "employees": (["date_of_join", "date_of_resignation"], "%d-%m-%Y"),
    "weekly_pulse": (["week_start_date", "week_end_date", "submitted_on", "created_at", "updated_at", "data_loaded_at"], "%d-%m-%Y"),
}

_PIPELINE_FORECAST_FFILL_COLUMNS = [
    "request_received",
    "original_requested_start_date",
    "request_type",
    "client_priority",
    "client",
    "em",
    "start_date_confirmed",
    "number_of_weeks",
    "deal_stage_hubspot",
    "solution",
    "sow_signed",
]


def strip_string_values(df: pd.DataFrame) -> pd.DataFrame:
    # Source files are occasionally regenerated in a fixed-width-padded style
    # (e.g. allocations' "employee_id" arriving as " EMP233     " instead of
    # "EMP1"), which silently breaks every join against a clean id column in
    # another table. Strip all string cells so ids/status codes compare equal
    # regardless of padding in the raw file.
    #
    # A plain `df[col].str.strip()` looked equivalent but isn't: pandas' .str
    # accessor returns NaN for any element that isn't already a string, so on
    # a genuinely mixed-dtype object column it can silently wipe every real
    # non-string value to NaN. Stripping only elements that are ALREADY
    # strings, element-by-element, preserves every non-string value untouched.
    df = df.copy()
    for col in df.select_dtypes(include="object").columns:
        df[col] = df[col].map(lambda v: v.strip() if isinstance(v, str) else v)
    return df


def sanitize_columns(df: pd.DataFrame) -> pd.DataFrame:
    def clean(col: str) -> str:
        col = col.strip().lower()
        col = re.sub(r"[^a-z0-9]+", "_", col)
        return col.strip("_")

    df = df.copy()
    cleaned = [clean(c) for c in df.columns]
    seen: dict[str, int] = {}
    final = []
    for i, name in enumerate(cleaned):
        name = name or f"col_{i}"
        if name in seen:
            seen[name] += 1
            name = f"{name}_{seen[name]}"
        else:
            seen[name] = 0
        final.append(name)
    df.columns = final
    return df


def clean_table(table: str, df: pd.DataFrame) -> pd.DataFrame:
    """Sanitize columns, strip string cells, and coerce this table's known
    date columns -- the generic cleaning every dataset table gets, matching
    the exact rules db.py's old file-based loader used to apply."""
    df = sanitize_columns(df)
    df = strip_string_values(df)
    for col in _DATE_COLUMNS.get(table, []):
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors="coerce")
    if table in _EXPLICIT_FORMAT_DATE_COLUMNS:
        cols, fmt = _EXPLICIT_FORMAT_DATE_COLUMNS[table]
        for col in cols:
            if col in df.columns:
                df[col] = pd.to_datetime(df[col], format=fmt, errors="coerce")
    return df


def clean_demand_file(raw_df: pd.DataFrame) -> pd.DataFrame:
    """The Demand File's own quirks (see the old db.py _load_all): "%" ->
    requested_pct by its literal original header text, an unnamed index
    column to drop, and a per-deal forward-fill since only a deal's first row
    carries its own client/priority/date fields."""
    df = raw_df.rename(columns={"%": "requested_pct", "Skills": "Skillset"})
    df = df.drop(columns=["Unnamed: 0"], errors="ignore")
    df = sanitize_columns(df)
    df = strip_string_values(df)
    df["original_requested_start_date"] = pd.to_datetime(df["original_requested_start_date"], errors="coerce")
    df["deal_id"] = df["client"].notna().cumsum()
    ffill_cols = [c for c in _PIPELINE_FORECAST_FFILL_COLUMNS if c in df.columns]
    df[ffill_cols] = df.groupby("deal_id")[ffill_cols].ffill()
    return df


def clean_coe_skills_mapping(raw_df: pd.DataFrame) -> pd.DataFrame:
    df = sanitize_columns(raw_df)
    df = strip_string_values(df)
    df = df.dropna(subset=["coe"])  # source file has a trailing blank line
    return df
