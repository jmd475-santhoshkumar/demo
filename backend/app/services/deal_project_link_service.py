import pandas as pd

from app.core import appstate_db

# So re-opening the Project Wizard on a deal later (even after a page refresh
# or a new session) resumes at Step 5 instead of offering to create a second,
# duplicate project for the same deal.
LINK_TABLE = "deal_project_link"
_FIELDS = ["deal_key", "project_code"]

def link_deal_to_project(deal_key: str, project_code: str) -> dict:
    row = {"deal_key": deal_key, "project_code": project_code}
    df = appstate_db.read_all(LINK_TABLE, _FIELDS)
    df = df[df["deal_key"] != deal_key] if "deal_key" in df.columns else df
    df = pd.concat([df, pd.DataFrame([row])], ignore_index=True)
    appstate_db.write_all(LINK_TABLE, df)
    return row

def get_project_for_deal(deal_key: str) -> str | None:
    df = appstate_db.read_all(LINK_TABLE, _FIELDS)
    if df.empty:
        return None
    match = df[df["deal_key"] == deal_key]
    return match.iloc[-1]["project_code"] if not match.empty else None
