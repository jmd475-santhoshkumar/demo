import json
import os
from abc import ABC, abstractmethod
from functools import lru_cache

import pandas as pd

from app.core.config import APP_STATE_DIR
from app.core.db import get_cursor

# Persisted JIN connection config -- lets the Settings page save/switch this
# from the UI (no .env edit + backend restart needed) once real credentials
# exist. Falls back to env vars (DATA_SOURCE_MODE/JIN_API_BASE_URL/JIN_API_KEY)
# when no saved config exists yet, so the original env-var path still works
# for anyone who prefers setting it that way.
_CONNECTION_CONFIG_PATH = APP_STATE_DIR / "jin_connection.json"


def _read_connection_config() -> dict:
    if _CONNECTION_CONFIG_PATH.exists():
        try:
            return json.loads(_CONNECTION_CONFIG_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {
        "mode": os.environ.get("DATA_SOURCE_MODE", "local").strip().lower(),
        "base_url": os.environ.get("JIN_API_BASE_URL", ""),
        "api_key": os.environ.get("JIN_API_KEY", ""),
    }


def get_connection_config() -> dict:
    """UI-safe view -- never returns the raw API key, only whether one is set."""
    cfg = _read_connection_config()
    return {
        "mode": cfg.get("mode") or "local",
        "base_url": cfg.get("base_url") or None,
        "has_api_key": bool(cfg.get("api_key")),
    }


def save_connection_config(mode: str, base_url: str | None, api_key: str | None) -> dict:
    mode = (mode or "local").strip().lower()
    if mode not in ("local", "jin"):
        raise ValueError("mode must be 'local' or 'jin'")
    existing = _read_connection_config()
    cfg = {
        "mode": mode,
        "base_url": (base_url or "").strip() or existing.get("base_url", ""),
        # A blank submitted key keeps whatever was already saved, so re-saving
        # just the base_url/mode doesn't silently wipe out an entered key.
        "api_key": (api_key or "").strip() or existing.get("api_key", ""),
    }
    _CONNECTION_CONFIG_PATH.write_text(json.dumps(cfg, indent=2))
    reset_adapter()
    return get_connection_config()


def test_connection() -> dict:
    """A REAL attempt, not a simulated result -- see JinApiAdapter above, which
    raises NotImplementedError until its HTTP calls are actually wired to a
    live JIN endpoint. This surfaces exactly that (or a real connection
    error, once it IS wired) rather than a fake green checkmark."""
    cfg = _read_connection_config()
    if cfg.get("mode") != "jin":
        return {"success": False, "message": "Currently in Local mode -- switch to JIN Data Warehouse mode and save credentials first."}
    if not cfg.get("base_url") or not cfg.get("api_key"):
        return {"success": False, "message": "Base URL and API key are both required before testing the connection."}
    try:
        get_adapter().get_employees()
        return {"success": True, "message": "Connected to the JIN Data Warehouse."}
    except NotImplementedError as exc:
        return {"success": False, "message": str(exc)}
    except Exception as exc:
        return {"success": False, "message": f"Connection failed: {exc}"}


def reset_adapter() -> None:
    _build_adapter.cache_clear()

@lru_cache(maxsize=None)
def _cached_query(table: str) -> pd.DataFrame:
    return get_cursor().execute(f"SELECT * FROM {table}").df()

class DataSourceAdapter(ABC):
    @abstractmethod
    def get_employees(self) -> pd.DataFrame: ...

    @abstractmethod
    def get_projects(self) -> pd.DataFrame: ...

    @abstractmethod
    def get_allocations(self) -> pd.DataFrame: ...

    @abstractmethod
    def get_timesheets(self) -> pd.DataFrame: ...

    @abstractmethod
    def get_skills(self) -> pd.DataFrame: ...

    @abstractmethod
    def get_competencies(self) -> pd.DataFrame: ...

    @abstractmethod
    def get_wsr_reports(self) -> pd.DataFrame: ...

    @abstractmethod
    def get_pipeline_forecast(self) -> pd.DataFrame: ...

    @abstractmethod
    def get_pipeline_skillset(self) -> pd.DataFrame: ...

    @abstractmethod
    def get_pipeline_hierarchy(self) -> pd.DataFrame: ...

    @abstractmethod
    def get_pipeline_revenue(self) -> pd.DataFrame: ...

    @abstractmethod
    def get_leaves(self) -> pd.DataFrame:
        ...

    @abstractmethod
    def get_weekly_pulse(self) -> pd.DataFrame: ...

    @abstractmethod
    def get_hr_feedback(self) -> pd.DataFrame: ...

    @abstractmethod
    def get_performance_cycles(self) -> pd.DataFrame: ...

    @abstractmethod
    def get_performance_kra_items(self) -> pd.DataFrame: ...

    @abstractmethod
    def get_coe_skills_mapping(self) -> pd.DataFrame: ...

    @abstractmethod
    def get_budgets_jin(self) -> pd.DataFrame: ...

    @abstractmethod
    def get_budget_resources_jin(self) -> pd.DataFrame: ...

class LocalAdapter(DataSourceAdapter):

    def _query(self, table: str) -> pd.DataFrame:
        return _cached_query(table).copy()

    def get_employees(self) -> pd.DataFrame:
        df = self._query("employees")
        # The raw account_status flag on the base table is NOT a real
        # employment-status signal -- confirmed against the full real JDWH
        # export: 225 rows carry an explicit account_status=0 with zero
        # corroborating exit evidence. date_of_resignation is equally useless
        # as a signal (every real row is either blank or the literal
        # "2999-12-31" sentinel -- confirmed zero genuine resignation dates
        # exist anywhere in this data).
        #
        # jin_id_status (backfilled via app/scripts/backfill_jin_id_status.py)
        # IS a real, corroborated signal -- confirmed directly against a real
        # employee (JMD94, Satyam Pandey) who genuinely left while still
        # carrying account_status=1: jin_id_status correctly reads 0 for him.
        # 87 other employees show this exact same mismatch (jin_id_status=0,
        # account_status=1), meaning the old account_status-only view was
        # silently over-counting active headcount by at least that many.
        # Falls back to the old "not_yet_departed" logic only for the
        # handful of employees this backfill couldn't resolve (no
        # jin_employee_id match), so nobody silently loses a status.
        has_jin_status = df["jin_id_status"].notna() if "jin_id_status" in df.columns else pd.Series(False, index=df.index)
        # Loads as float64 (0.0/1.0/NaN) via the CSV -> DuckDB -> pandas
        # pipeline, not the string "1" the raw CSV cell shows -- compare
        # numerically, not by string equality.
        is_active_via_jin = df["jin_id_status"] == 1

        today = pd.Timestamp.now().normalize()
        not_yet_departed = df["date_of_resignation"].isna() | (df["date_of_resignation"] > today)

        df["account_status"] = pd.Series(is_active_via_jin.where(has_jin_status, not_yet_departed)).astype(int)
        return df

    def get_projects(self) -> pd.DataFrame:
        return self._query("projects")

    def get_allocations(self) -> pd.DataFrame:
        df = self._query("allocations")
        # A departed employee (see get_employees()'s account_status, backed by
        # jin_id_status) cannot still be a live team member -- confirmed real
        # case: JMD94 (Satyam Pandey) carried an allocation row dated into
        # 2026-11 despite having actually left. Close out any row still "in
        # effect" (flagged active, or not yet ended) for a departed employee
        # so every one of this method's consumers (free pool, health
        # monitor, availability checks, recommendation "already busy" logic)
        # stops treating them as currently staffed. Genuinely historical rows
        # (already ended before today) are left untouched either way.
        employees = self.get_employees()
        departed_ids = set(employees.loc[employees["account_status"] == 0, "employee_id"])
        if departed_ids:
            today = pd.Timestamp.now().normalize()
            end_dt = pd.to_datetime(df["allocated_end_date"], errors="coerce")
            still_in_effect = df["is_allocation_active"].astype(bool) | end_dt.isna() | (end_dt >= today)
            close_out = df["employee_id"].isin(departed_ids) & still_in_effect
            df.loc[close_out, "is_allocation_active"] = 0
        return df

    def get_timesheets(self) -> pd.DataFrame:
        return self._query("timesheets")

    def get_skills(self) -> pd.DataFrame:
        # The real skills export (05_Skill_Details_clean.csv) uses a
        # completely different, disconnected employee_id scheme (EMP1,
        # EMP2... -- confirmed zero overlap with real employee_ids) --
        # skill_mapping_service remaps it onto real employees (by matching
        # real designation + a real-allocation-derived CoE, never a random
        # guess) so every consumer of this method gets real-ID-keyed rows
        # instead of silently matching nothing. Imported here, not at module
        # level, to avoid a circular import (skill_mapping_service reads the
        # raw table via this module's own _cached_query).
        from app.engines.skill_mapping_service import build_real_employee_skills_table
        return build_real_employee_skills_table()

    def get_competencies(self) -> pd.DataFrame:
        from app.engines.skill_mapping_service import build_real_employee_competency_table
        return build_real_employee_competency_table()

    def get_wsr_reports(self) -> pd.DataFrame:
        return self._query("wsr_reports")

    def get_pipeline_forecast(self) -> pd.DataFrame:
        return self._query("pipeline_forecast")

    def get_pipeline_skillset(self) -> pd.DataFrame:
        return self._query("pipeline_skillset")

    def get_pipeline_hierarchy(self) -> pd.DataFrame:
        return self._query("pipeline_hierarchy")

    def get_pipeline_revenue(self) -> pd.DataFrame:
        return self._query("pipeline_revenue")

    def get_leaves(self) -> pd.DataFrame:
        return self._query("leaves")

    def get_weekly_pulse(self) -> pd.DataFrame:
        return self._query("weekly_pulse")

    def get_hr_feedback(self) -> pd.DataFrame:
        return self._query("hr_feedback")

    def get_performance_cycles(self) -> pd.DataFrame:
        return self._query("performance_cycles")

    def get_performance_kra_items(self) -> pd.DataFrame:
        return self._query("performance_kra_items")

    def get_coe_skills_mapping(self) -> pd.DataFrame:
        return self._query("coe_skills_mapping")

    def get_budgets_jin(self) -> pd.DataFrame:
        return self._query("budgets_jin")

    def get_budget_resources_jin(self) -> pd.DataFrame:
        return self._query("budget_resources_jin")

class JinApiAdapter(DataSourceAdapter):

    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url
        self.api_key = api_key

    def _not_implemented(self, endpoint: str):
        raise NotImplementedError(
            f"JinApiAdapter is a production contract stub. Wire {endpoint} to the "
            f"real JIN API at {self.base_url} when credentials are available."
        )

    def get_employees(self) -> pd.DataFrame:
        self._not_implemented("/api/employees")

    def get_projects(self) -> pd.DataFrame:
        self._not_implemented("/api/projects")

    def get_allocations(self) -> pd.DataFrame:
        self._not_implemented("/api/project-allocations")

    def get_timesheets(self) -> pd.DataFrame:
        self._not_implemented("/api/timesheets")

    def get_skills(self) -> pd.DataFrame:
        self._not_implemented("/api/skills")

    def get_competencies(self) -> pd.DataFrame:
        self._not_implemented("/api/competencies")

    def get_wsr_reports(self) -> pd.DataFrame:
        self._not_implemented("/api/status-reports")

    def get_pipeline_forecast(self) -> pd.DataFrame:
        self._not_implemented("/api/pipeline/forecast")

    def get_pipeline_skillset(self) -> pd.DataFrame:
        self._not_implemented("/api/pipeline/skillset")

    def get_pipeline_hierarchy(self) -> pd.DataFrame:
        self._not_implemented("/api/pipeline/hierarchy")

    def get_pipeline_revenue(self) -> pd.DataFrame:
        self._not_implemented("/api/pipeline/revenue")

    def get_leaves(self) -> pd.DataFrame:
        self._not_implemented("/api/leave-requests")

    def get_weekly_pulse(self) -> pd.DataFrame:
        self._not_implemented("/api/weekly-pulse")

    def get_hr_feedback(self) -> pd.DataFrame:
        self._not_implemented("/api/hr-feedback")

    def get_performance_cycles(self) -> pd.DataFrame:
        self._not_implemented("/api/performance-cycles")

    def get_performance_kra_items(self) -> pd.DataFrame:
        self._not_implemented("/api/performance-kra-items")

    def get_coe_skills_mapping(self) -> pd.DataFrame:
        self._not_implemented("/api/coe-skills-mapping")

@lru_cache(maxsize=1)
def _build_adapter() -> DataSourceAdapter:
    # mode=jin (+ base_url/api_key, saved from the Settings page or via the
    # DATA_SOURCE_MODE/JIN_API_BASE_URL/JIN_API_KEY env vars) is the real "flip
    # to production" switch this app ships ready for -- until real JIN
    # credentials exist, every JinApiAdapter method raises NotImplementedError
    # on purpose (see the class above) rather than silently returning fake
    # data, so this switch can be tested for wiring without ever pretending
    # to be connected.
    cfg = _read_connection_config()
    if cfg.get("mode") == "jin":
        return JinApiAdapter(base_url=cfg.get("base_url", ""), api_key=cfg.get("api_key", ""))
    return LocalAdapter()

def get_adapter() -> DataSourceAdapter:
    return _build_adapter()
