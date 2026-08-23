"""One-time restore: brings real employee_full_name values back into
01_Employee_Details_clean.csv, from a real employee export the user uploaded
(real_employees.xlsx), replacing the anonymized names a prior local script run
had put in place.

Git history was checked first and ruled out: the file was untracked (git rm
--cached) at commit 5db6bf3 as part of excluding real data from source
control, then re-added with already-anonymized names in ad48a4b -- there is
no pre-anonymization commit to recover from.

Joins on jin_employee_id (a UUID), NOT employee_id -- the two files use
completely different employee_id schemes (real_employees.xlsx's employee_id
IS the same UUID as its own jin_employee_id column; this app's local CSV uses
a separate internal numeric employee_id, with jin_employee_id as the shared
key added earlier by backfill_jin_employee_id.py).

Never prints a single real name/email value anywhere -- only row/match
counts -- per this app's standing rule to never view/print real employee
name values structurally.

Usage:
    python -m app.scripts.restore_real_employee_names
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

    for col in ("jin_employee_id", "employee_full_name"):
        if col not in real.columns:
            print(f"real_employees.xlsx has no '{col}' column -- can't restore from here.")
            sys.exit(1)
    if "jin_employee_id" not in current.columns:
        print(f"{EMPLOYEES_CSV.name} has no 'jin_employee_id' column -- can't join to the real file.")
        sys.exit(1)

    real_names = real.dropna(subset=["jin_employee_id"]).set_index("jin_employee_id")["employee_full_name"]
    real_names = real_names[~real_names.index.duplicated(keep="first")]

    matched_mask = current["jin_employee_id"].isin(real_names.index)
    before = current.loc[matched_mask, "employee_full_name"].reset_index(drop=True)
    after = real_names.reindex(current.loc[matched_mask, "jin_employee_id"]).reset_index(drop=True)
    changed = (before.fillna("") != after.fillna("")).sum()
    print(f"{changed} of {matched_mask.sum()} matched employees have a different name in real_employees.xlsx than the current file.")

    current["employee_full_name"] = current["jin_employee_id"].map(real_names).combine_first(current["employee_full_name"])
    restored = matched_mask.sum()
    missing = (~matched_mask).sum()
    print(f"Restored real names for {restored}/{len(current)} employees. {missing} employee(s) had no matching jin_employee_id in real_employees.xlsx (kept as-is).")

    current.to_csv(EMPLOYEES_CSV, index=False)
    print(f"Written to {EMPLOYEES_CSV}")


if __name__ == "__main__":
    main()
