"""One-time backfill: adds `jin_project_id` to 02_Project_Details_clean.csv.

The real JIN project UUID (`project.project_id` in the fuller schema export
at backend/260815_Tables Schema (2).xlsx) was never carried through
jdwh_table_mapping.map_project_table -- only project_code/project_surrogate_key
were kept. This UUID is the join key stg_jin_budget.csv's `projectId` column
needs (confirmed 387/387 real budget projectIds match it). Backfills the
already-loaded local CSV from the already-downloaded schema export -- no live
JDWH query. See map_project_table for the equivalent fix applied to future
real "Load Tables" pulls.
"""
import openpyxl
import pandas as pd

from app.core.config import BACKEND_ROOT, TRANSFORMED_DIR

SCHEMA_XLSX = BACKEND_ROOT / "260815_Tables Schema (2).xlsx"
PROJECTS_CSV = TRANSFORMED_DIR / "02_Project_Details_clean.csv"


def main() -> None:
    wb = openpyxl.load_workbook(SCHEMA_XLSX, data_only=True, read_only=True)
    ws = wb["project"]
    rows = list(ws.iter_rows(values_only=True))
    header = rows[0]
    idx_code = header.index("project_code")
    idx_pid = header.index("project_id")

    code_to_pid = {}
    for r in rows[1:]:
        code, pid = r[idx_code], r[idx_pid]
        if code and code != "NULL" and pid and pid != "NULL":
            code_to_pid[str(code).strip()] = str(pid).strip().lower()

    df = pd.read_csv(PROJECTS_CSV, dtype=str)
    df["jin_project_id"] = df["project_code"].map(code_to_pid)
    resolved = df["jin_project_id"].notna().sum()
    df.to_csv(PROJECTS_CSV, index=False)
    print(f"jin_project_id resolved for {resolved}/{len(df)} projects, written to {PROJECTS_CSV}")


if __name__ == "__main__":
    main()
