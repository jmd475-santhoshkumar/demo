import pandas as pd

from app.core import appstate_db

FEEDBACK_TABLE = "user_feedback"
_COLUMNS = ["submitted_at", "name", "category", "message"]
_VALID_CATEGORIES = {"Bug", "Feature request", "General"}


def submit_feedback(name: str | None, category: str, message: str) -> dict:
    message = (message or "").strip()
    if not message:
        raise ValueError("Feedback message cannot be empty.")
    category = category if category in _VALID_CATEGORIES else "General"

    row = {
        "submitted_at": pd.Timestamp.now().isoformat(),
        "name": (name or "").strip() or "Anonymous",
        "category": category,
        "message": message,
    }
    df = appstate_db.read_all(FEEDBACK_TABLE, _COLUMNS)
    df = pd.concat([df, pd.DataFrame([row])], ignore_index=True)
    appstate_db.write_all(FEEDBACK_TABLE, df)
    return row


def list_feedback() -> list[dict]:
    df = appstate_db.read_all(FEEDBACK_TABLE, _COLUMNS)
    if df.empty:
        return []
    rows = df.sort_values("submitted_at", ascending=False)
    return rows.to_dict(orient="records")
