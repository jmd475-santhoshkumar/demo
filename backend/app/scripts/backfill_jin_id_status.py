"""One-time backfill: adds `jin_id_status` to 01_Employee_Details_clean.csv,
joined via the already-backfilled `jin_employee_id` column (see
backfill_jin_employee_id.py) against real_employees.xlsx's own `employee_id`
(which IS that same UUID).

Confirmed real, not another unreliable status flag like the raw
`account_status` column (see LocalAdapter.get_employees()'s own long-standing
caveat about that field): a specific real employee (JMD94, Satyam Pandey) was
confirmed to have actually left while still carrying account_status=1 --
jin_id_status correctly shows 0 for him. Broader check: 87 real employees
show this exact same "jin_id_status=0 but account_status=1" mismatch pattern,
meaning the org's real headcount view has been silently over-counting active
staff by at least that many without this.

Usage:
    python -m app.scripts.backfill_jin_id_status
    (run from backend/)
"""
import sys
from pathlib import Path

import pandas as pd

BACKEND_ROOT = Path(__file__).resolve().parents[2]
EMPLOYEES_CSV = BACKEND_ROOT / "data" / "Transformed" / "01_Employee_Details_clean.csv"
REAL_EMPLOYEES_XLSX = BACKEND_ROOT / "real_employees.xlsx"


def main() -> None:
    if not REAL_EMPLOYEES_XLSX.exists():
        print(f"Expected file not found: {REAL_EMPLOYEES_XLSX}")
        sys.exit(1)

    real = pd.read_excel(REAL_EMPLOYEES_XLSX, dtype=str)
    current = pd.read_csv(EMPLOYEES_CSV, dtype=str)

    if "jin_id_status" not in real.columns:
        print("real_employees.xlsx has no 'jin_id_status' column -- can't backfill from here.")
        sys.exit(1)
    if "jin_employee_id" not in current.columns:
        print(f"{EMPLOYEES_CSV.name} has no 'jin_employee_id' column -- run backfill_jin_employee_id.py first.")
        sys.exit(1)

    status_by_jin_id = real.dropna(subset=["jin_employee_id" if "jin_employee_id" in real.columns else "employee_id"]).copy()
    # real_employees.xlsx's own employee_id IS the jin_employee_id UUID
    # (confirmed earlier this session, same convention restore_real_employee_names.py
    # and backfill_jin_employee_id.py both already rely on).
    status_map = real.set_index("employee_id")["jin_id_status"]
    status_map = status_map[~status_map.index.duplicated(keep="first")]

    current["jin_id_status"] = current["jin_employee_id"].map(status_map)
    resolved = current["jin_id_status"].notna().sum()
    departed = (current["jin_id_status"] == "0").sum()
    print(f"jin_id_status resolved for {resolved}/{len(current)} employees ({departed} marked departed, status=0).")

    current.to_csv(EMPLOYEES_CSV, index=False)
    print(f"Written to {EMPLOYEES_CSV}")


if __name__ == "__main__":
    main()
