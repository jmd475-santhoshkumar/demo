"""Shared upsert-by-project_code Postgres helper for the wizard's app-authored
steps (GDPR, Budget, Kickoff) and similar single-row-per-key records (cluster
assignment, the dataset-upload log) -- these aren't derived from any source
system, so a single row per key, overwritten on every save, is enough.
Backed by appstate_db's generic full-table read/replace (see that module for
why this needs no dynamic-schema handling: every column here is plain text).

`project_code` is used as the key column name for historical reasons, but
nothing here actually requires the key to be a project code -- any string ID
works (see admin_data_service.py's reuse of this for a dataset upload log).
"""
import pandas as pd

from app.core import appstate_db


def upsert_row(table_name: str, project_code: str, fields: dict) -> dict:
    row = {"project_code": project_code, **fields}
    row_str = {k: ("" if v is None else str(v)) for k, v in row.items()}
    df = appstate_db.read_all(table_name, list(row_str.keys()))
    if "project_code" in df.columns:
        df = df[df["project_code"] != project_code]
    df = pd.concat([df, pd.DataFrame([row_str])], ignore_index=True)
    appstate_db.write_all(table_name, df)
    return row

def get_row(table_name: str, project_code: str) -> dict | None:
    df = appstate_db.read_all(table_name, ["project_code"])
    if df.empty or "project_code" not in df.columns:
        return None
    match = df[df["project_code"] == project_code]
    if match.empty:
        return None
    return {k: (v if v != "" else None) for k, v in match.iloc[-1].to_dict().items()}
