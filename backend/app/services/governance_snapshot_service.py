"""Weekly point-in-time captures of the Cluster Governance dashboard.

Most of get_cluster_dashboard's real inputs are live-only, with no
historical trail anywhere in this app: current Azure DevOps ticket board
state, current allocations, and the AI-generated cluster summary are all
"as of right now" -- there's no way to honestly recompute "what did Cluster
3 look like on 2026-07-20" after the fact from raw logs (WSR history is the
one exception, but the rest isn't). Real per-week history requires actually
capturing it while that week is current.

So this captures the CURRENT week's fully-computed dashboard payload every
time it's viewed (upsert -- the current week is still live/evolving, so
each view's capture overwrites the previous one for that same week) and it
simply stops changing the moment a new week starts, since nothing calls
save_snapshot for a week that's no longer current. A week nobody ever
viewed while it was current has no snapshot -- a real, honest gap, never
backfilled with a guess.
"""
import json

import pandas as pd
from fastapi.encoders import jsonable_encoder

from app.core import appstate_db

SNAPSHOT_TABLE = "governance_snapshots"
_FIELDS = ["cluster_number", "week_start_date", "captured_at", "payload"]


def save_snapshot(cluster_number: int, week_start_date: str, payload: dict) -> None:
    row = {
        "cluster_number": str(cluster_number),
        "week_start_date": week_start_date,
        "captured_at": pd.Timestamp.now().isoformat(timespec="seconds"),
        "payload": json.dumps(jsonable_encoder(payload)),
    }
    df = appstate_db.read_all(SNAPSHOT_TABLE, _FIELDS)
    if not df.empty:
        df = df[~((df["cluster_number"] == row["cluster_number"]) & (df["week_start_date"] == week_start_date))]
    df = pd.concat([df, pd.DataFrame([row])], ignore_index=True)
    appstate_db.write_all(SNAPSHOT_TABLE, df)


def get_snapshot(cluster_number: int, week_start_date: str) -> dict | None:
    df = appstate_db.read_all(SNAPSHOT_TABLE, _FIELDS)
    if df.empty:
        return None
    match = df[(df["cluster_number"] == str(cluster_number)) & (df["week_start_date"] == week_start_date)]
    if match.empty:
        return None
    row = match.iloc[-1]
    return {**json.loads(row["payload"]), "captured_at": row["captured_at"]}


def list_snapshot_weeks() -> list[str]:
    """Every distinct week_start_date with at least one real captured
    cluster snapshot, most recent first -- feeds the week-picker dropdown."""
    df = appstate_db.read_all(SNAPSHOT_TABLE, _FIELDS)
    if df.empty:
        return []
    return sorted(df["week_start_date"].dropna().unique().tolist(), reverse=True)
