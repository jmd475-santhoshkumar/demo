"""This week's Kick-off checklist for the Cluster Governance view (the JQA
deck's "Projects Kick Off - This Week" table: Kick Off Completed / Scope
Approved / DevOps Setup, each Yes/No). Which projects are starting this week
is derived live from real project_start_date, not stored here -- only the
3 status flags are manual, since nothing in the app tracks "scope approved"
or "DevOps setup" as a real flag yet. Composite-keyed on (project_code,
week_start_date), same rationale as governance_spotlight_service."""
import pandas as pd

from app.core import appstate_db

KICKOFF_TRACKING_TABLE = "project_governance_kickoff_tracking"
_KEY_FIELDS = ["project_code", "week_start_date"]
_STATUS_FIELDS = ["kickoff_completed", "scope_approved", "devops_setup"]
_FIELDS = _KEY_FIELDS + _STATUS_FIELDS + ["comment"]

def _read_all() -> pd.DataFrame:
    return appstate_db.read_all(KICKOFF_TRACKING_TABLE, _FIELDS)

def save_kickoff_tracking(project_code: str, week_start_date: str, fields: dict) -> dict:
    row = {"project_code": project_code, "week_start_date": week_start_date}
    row.update({k: (fields.get(k) or "pending") for k in _STATUS_FIELDS})
    row["comment"] = fields.get("comment") or ""
    df = _read_all()
    df = df[~((df["project_code"] == project_code) & (df["week_start_date"] == week_start_date))]
    df = pd.concat([df, pd.DataFrame([row])], ignore_index=True)
    appstate_db.write_all(KICKOFF_TRACKING_TABLE, df)
    return row

def list_kickoff_tracking(project_codes: list[str], week_start_date: str) -> dict[str, dict]:
    df = _read_all()
    if df.empty:
        return {}
    rows = df[(df["project_code"].isin(project_codes)) & (df["week_start_date"] == week_start_date)]
    result = {}
    for _, r in rows.iterrows():
        result[r["project_code"]] = {
            **{k: r[k] for k in _STATUS_FIELDS},
            "comment": r["comment"] or None,
        }
    return result
