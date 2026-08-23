import os
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]

DATA_ROOT = BACKEND_ROOT / "data"
# NOTE: the live app no longer reads any dataset from these paths at runtime
# -- every dataset table lives in Postgres/RDS now (see app/core/dataset_store.py,
# app/core/pg.py), populated only via a Settings-page upload or a JIN Data
# Warehouse pull. TRANSFORMED_DIR/PIPELINE_XLSX/DEMAND_FILE_XLSX below are kept
# only because the one-off dev/data-prep scripts under app/scripts/ (which run
# manually, outside the running app, to prepare data BEFORE it's uploaded/seeded
# into Postgres) still reference them.
TRANSFORMED_DIR = DATA_ROOT / "Transformed"
PIPELINE_XLSX = TRANSFORMED_DIR / "07_Pipeline_Details.xlsx"
DEMAND_FILE_XLSX = BACKEND_ROOT / "Demand file .xlsx"
HEADCOUNT_PREDICTION_DIR = DATA_ROOT / "HeadcountPrediction"
# Non-dataset app config only now (e.g. jdwh_connection_service's saved
# connection profile JSON) -- every app-authored RECORD (GDPR/budget/SOW-
# metadata/kickoff/governance/etc) moved to Postgres too, see
# app/core/appstate_db.py.
APP_STATE_DIR = DATA_ROOT / "AppState"
APP_STATE_DIR.mkdir(parents=True, exist_ok=True)

DUCKDB_PATH = ":memory:"

CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
