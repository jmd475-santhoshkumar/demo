"""Append-only log of every project end-date extension change -- unlike the
single mutable extended_end_date/extended_end_status columns on the projects
CSV (which only ever hold the CURRENT value), this keeps every past change as
its own record so the Extensions tab can show a real history, not just the
latest state."""
import pandas as pd

from app.core import appstate_db

EXTENSION_HISTORY_TABLE = "project_extensions"
_FIELDS = ["project_code", "recorded_at", "from_end_date", "to_end_date", "status"]


def record_extension(project_code: str, from_end_date: str | None, to_end_date: str | None, status: str | None) -> dict:
    row = {
        "project_code": project_code,
        "recorded_at": pd.Timestamp.now().isoformat(timespec="seconds"),
        "from_end_date": from_end_date or "",
        "to_end_date": to_end_date or "",
        "status": status or "",
    }
    df = appstate_db.read_all(EXTENSION_HISTORY_TABLE, _FIELDS)
    df = pd.concat([df, pd.DataFrame([row])], ignore_index=True)
    appstate_db.write_all(EXTENSION_HISTORY_TABLE, df)
    return row


def get_extension_history(project_code: str) -> list[dict]:
    df = appstate_db.read_all(EXTENSION_HISTORY_TABLE, _FIELDS)
    if df.empty:
        return []
    rows = df[df["project_code"] == project_code].to_dict("records")
    rows.sort(key=lambda r: r["recorded_at"], reverse=True)
    return [{k: (v if v != "" else None) for k, v in r.items()} for r in rows]
