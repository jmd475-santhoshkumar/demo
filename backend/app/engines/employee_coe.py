import pandas as pd

from app.core.adapter import get_adapter
from app.engines.coe_skill_engine import GENERIC_SKILL_COES
from app.engines.coe_taxonomy import resolve_coe_label

_cache: dict[str, str] | None = None
_cache_fingerprint: tuple | None = None

def _canonicalize(raw_coe: str) -> str:
    # Delegates to coe_taxonomy, which builds its alias map from
    # COE_SKILL_MAP (the same source this function used to read directly) --
    # kept as a thin wrapper here so callers/tests that import _canonicalize
    # from this module keep working unchanged.
    return resolve_coe_label(raw_coe) or raw_coe.strip()

def _fingerprint(skills_df: pd.DataFrame, experience_profiles: dict) -> tuple:
    return (
        len(skills_df), int(pd.util.hash_pandas_object(skills_df, index=False).sum()),
        len(experience_profiles),
    )

def get_employee_primary_coe_map() -> dict[str, str]:
    """Real employees' primary Centre of Excellence, one label per employee.

    Prefers each employee's REAL project-allocation history (tech_coe_breakdown
    from experience_engine.build_employee_experience_profiles() -- the same
    real per-project CoE tags used everywhere else in this app) -- their
    single most-worked real CoE. Only falls back to the skills table for
    anyone with no real allocation history at all -- for most employees that
    table isn't really their own data anyway: it's a same-designation
    synthetic stand-in's skill profile (see skill_mapping_service.py's module
    docstring), not a claim about that specific person.

    This ordering matters in practice, not just in theory: confirmed on real
    data that 693/901 employees have real allocation history to derive a
    genuine CoE from, vs. only 268 ever getting a tag via the synthetic
    stand-in path -- and for at least one real case (a Solutions Consultant
    with a strong real BI & Reporting / Data Engineering track record) the
    stand-in path showed "Full Stack Engineering", the one real category that
    person has the LEAST real history in, purely because that's what their
    randomly-assigned synthetic donor happened to carry.
    """
    global _cache, _cache_fingerprint
    from app.engines.experience_engine import build_employee_experience_profiles

    adapter = get_adapter()
    skills = adapter.get_skills()
    experience_profiles = build_employee_experience_profiles()
    fingerprint = _fingerprint(skills, experience_profiles)
    if _cache is not None and fingerprint == _cache_fingerprint:
        return _cache

    result: dict[str, str] = {}
    for emp_id, profile in experience_profiles.items():
        breakdown = profile.get("tech_coe_breakdown") or {}
        if not breakdown:
            continue
        top_label = max(breakdown.items(), key=lambda kv: kv[1])[0]
        result[emp_id] = _canonicalize(top_label)

    observed = skills[(skills["skill_source"] == "observed") & (~skills["coe"].isin(GENERIC_SKILL_COES))]
    if not observed.empty:
        mode_coe = observed.groupby("employee_id")["coe"].agg(lambda s: s.mode().iat[0] if not s.mode().empty else None)
        for emp_id, coe in mode_coe.items():
            if coe is not None and emp_id not in result:
                result[emp_id] = _canonicalize(coe)

    _cache = result
    _cache_fingerprint = fingerprint
    return result