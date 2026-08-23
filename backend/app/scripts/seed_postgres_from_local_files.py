"""One-time dev/migration utility: pushes the existing local demo dataset
files (backend/data/Transformed/*, the Demand file, the pipeline workbook,
COE_Skills_Mapping.csv) into Postgres, through the exact same cleaning
functions (app/core/dataset_cleaning.py) the Settings-page upload path uses.

This is NOT part of the running app -- it exists only so whoever stands up a
fresh Postgres/RDS instance (local dev via docker-compose, or a first-time
deploy) doesn't have to manually re-upload all ~19 files through the UI one at
a time if they already have this repo's demo CSVs on disk. Uploading through
the Settings page instead works exactly the same way and is the intended
production path -- this script is a shortcut for bootstrapping, not a
replacement for it.

Usage (from backend/, with DATABASE_URL pointing at a real Postgres):
    python -m app.scripts.seed_postgres_from_local_files
"""
import sys

import pandas as pd

from app.core import dataset_store
from app.core.config import BACKEND_ROOT, DEMAND_FILE_XLSX, PIPELINE_XLSX, TRANSFORMED_DIR
from app.core.dataset_cleaning import clean_coe_skills_mapping, clean_demand_file, clean_table

_CSV_TABLES = {
    "employees": "01_Employee_Details_clean.csv",
    "projects": "02_Project_Details_clean.csv",
    "allocations": "03_Project_Allocation_clean.csv",
    "timesheets": "04_Timesheet_Details_clean.csv",
    "skills": "05_Skill_Details_clean.csv",
    "competencies": "06_Competency_Details_clean.csv",
    "wsr_reports": "08_WSR_Report_clean.csv",
    "leaves": "09_Leave_Details_synthetic.csv",
    "weekly_pulse": "10_Weekly_Pulse_dummy.csv",
    "hr_feedback": "11_HR_Feedback_dummy.csv",
    "performance_cycles": "12_Performance_Cycles_dummy.csv",
    "performance_kra_items": "13_Performance_KRA_Items_dummy.csv",
    "budgets_jin": "14_JIN_Budget.csv",
    "budget_resources_jin": "15_JIN_Budget_Resources.csv",
}

_PIPELINE_SHEETS = {
    "Skillset": "pipeline_skillset",
    "Hierarchy": "pipeline_hierarchy",
    "6 Months Revenue": "pipeline_revenue",
}


def main() -> None:
    total = 0
    for table, filename in _CSV_TABLES.items():
        path = TRANSFORMED_DIR / filename
        if not path.exists():
            print(f"skip {table}: {path} not found")
            continue
        df = clean_table(table, pd.read_csv(path, low_memory=False))
        n = dataset_store.replace_table(table, df, backup=False)
        print(f"{table}: {n} rows")
        total += n

    if DEMAND_FILE_XLSX.exists():
        df = clean_demand_file(pd.read_excel(DEMAND_FILE_XLSX, sheet_name=0))
        n = dataset_store.replace_table("pipeline_forecast", df, backup=False)
        print(f"pipeline_forecast: {n} rows")
        total += n
    else:
        print(f"skip pipeline_forecast: {DEMAND_FILE_XLSX} not found")

    if PIPELINE_XLSX.exists():
        sheets = pd.read_excel(PIPELINE_XLSX, sheet_name=None)
        for sheet_name, table in _PIPELINE_SHEETS.items():
            if sheet_name not in sheets:
                print(f"skip {table}: sheet '{sheet_name}' not found in {PIPELINE_XLSX}")
                continue
            df = clean_table(table, sheets[sheet_name])
            n = dataset_store.replace_table(table, df, backup=False)
            print(f"{table}: {n} rows")
            total += n
    else:
        print(f"skip pipeline_skillset/hierarchy/revenue: {PIPELINE_XLSX} not found")

    coe_path = BACKEND_ROOT / "COE_Skills_Mapping.csv"
    if coe_path.exists():
        df = clean_coe_skills_mapping(pd.read_csv(coe_path))
        n = dataset_store.replace_table("coe_skills_mapping", df, backup=False)
        print(f"coe_skills_mapping: {n} rows")
        total += n
    else:
        print(f"skip coe_skills_mapping: {coe_path} not found")

    print(f"Done -- {total} rows written to Postgres.")


if __name__ == "__main__":
    main()
    sys.exit(0)
