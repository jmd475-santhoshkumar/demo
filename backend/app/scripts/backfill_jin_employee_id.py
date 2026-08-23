"""One-time backfill: adds `jin_employee_id` to 01_Employee_Details_clean.csv,
the employee-side equivalent of backfill_jin_project_id.py. Needed to resolve
stg_jin.budget's reviewedby/createdby (real JIN employee UUIDs) to this app's
employee_id -- confirmed 100% match on both fields against a real sample. See
map_employee_table for the equivalent fix applied to future real "Load
Tables" pulls.
"""
import openpyxl
import pandas as pd

from app.core.config import BACKEND_ROOT, TRANSFORMED_DIR

SCHEMA_XLSX = BACKEND_ROOT / "260815_Tables Schema (2).xlsx"
EMPLOYEES_CSV = TRANSFORMED_DIR / "01_Employee_Details_clean.csv"


def main() -> None:
    wb = openpyxl.load_workbook(SCHEMA_XLSX, data_only=True, read_only=True)
    ws = wb["employee"]
    rows = list(ws.iter_rows(values_only=True))
    header = rows[0]
    idx_code = header.index("employee_code")
    idx_jin = header.index("jin_employee_id")

    code_to_jin = {}
    for r in rows[1:]:
        code, jin_id = r[idx_code], r[idx_jin]
        if code and jin_id and jin_id != "NULL":
            code_to_jin[str(code).strip()] = str(jin_id).strip().lower()

    df = pd.read_csv(EMPLOYEES_CSV, dtype=str)
    df["jin_employee_id"] = df["employee_id"].map(code_to_jin)
    resolved = df["jin_employee_id"].notna().sum()
    df.to_csv(EMPLOYEES_CSV, index=False)
    print(f"jin_employee_id resolved for {resolved}/{len(df)} employees, written to {EMPLOYEES_CSV}")


if __name__ == "__main__":
    main()
