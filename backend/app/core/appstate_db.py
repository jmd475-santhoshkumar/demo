"""Generic Postgres-backed storage for the app-authored "AppState" tables
(project kickoff/GDPR/budget/cluster-assignment, governance risk-log/
spotlight/kickoff-tracking, extension-history). Every consumer already reads
its whole table into a DataFrame of strings and does its own filter/upsert/
append logic in pandas (see project_appstate_service.py and the
governance_*_service.py files) -- this module only replaces the storage
underneath a full-table read and a full-table replace-write, matching the
exact semantics the old read-whole-CSV/write-whole-CSV pattern already had.
No schema/dtype inference needed: every column here is already plain text.
"""
import pandas as pd
from sqlalchemy import inspect

from app.core.pg import get_engine


def read_all(table_name: str, columns: list[str]) -> pd.DataFrame:
    """This table's full contents as strings, or an empty DataFrame shaped
    with `columns` if the table doesn't exist yet (nothing saved here yet --
    a normal, expected state, matching the old "CSV file doesn't exist yet"
    case)."""
    engine = get_engine()
    if not inspect(engine).has_table(table_name):
        return pd.DataFrame(columns=columns)
    df = pd.read_sql(f'SELECT * FROM "{table_name}"', engine)
    return df.fillna("").astype(str)


def write_all(table_name: str, df: pd.DataFrame) -> None:
    """Full-table replace -- same "rewrite everything" semantics the old
    df.to_csv(path, index=False) call had."""
    df.to_sql(table_name, get_engine(), if_exists="replace", index=False)
