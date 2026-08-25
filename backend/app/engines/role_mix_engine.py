
import pandas as pd

from app.core.adapter import get_adapter
from app.services.governance_risk_service import list_risks
from app.services.timesheet_insights_service import get_project_effort_spikes

DND_TACTICAL_BUILD = "D&D Tactical Build"
DELIVERY_STANDARD_TEAM = "Delivery Project - Standard Team"

_DND_TEMPLATE = {
    "Principal": 0.25,
    "Technical Solutions Architect": 0.25,
    "Associate Consultant": 1.0,
    "Consultant": 0.5,
    "Senior Solutions Consultant": 0.5,
    "Senior Software Engineer": 1.0,
}

# Real RM-provided team template for a typical DELIVERY project (~5 weeks,
# ~$35k revenue -- see app/engines/revenue_engine.py's DELIVERY_TEMPLATE for
# the duration/revenue side of this same template). 2 engineer seats use
# Senior Software Engineer as the canonical designation; Software Engineer
# fills either seat via the existing adjacent-title fallback in
# demand_forecast_service.py. Same for Consultant/Senior Consultant.
_DELIVERY_TEMPLATE = {
    "Senior Software Engineer": 2.0,
    "Solutions Enabler": 1.0,
    "Consultant": 1.0,
}

# docx-given (not derived-from-real-data) templates, keyed by their DOCX_CATEGORY_MAP name.
_DOCX_TEMPLATES: dict[str, dict[str, float]] = {
    DND_TACTICAL_BUILD: _DND_TEMPLATE,
    DELIVERY_STANDARD_TEAM: _DELIVERY_TEMPLATE,
}

DOCX_CATEGORY_MAP: dict[str, dict] = {
    DND_TACTICAL_BUILD: {"docx_given": True},
    DELIVERY_STANDARD_TEAM: {"docx_given": True},
    "Build Phase - Tactical Build": {"type_of_project": "Client Project"},
    "Build Phase - Enterprise Platform Build": {"type_of_project": "Client Project"},
    "Build Phase - Data Platform Build": {"type_of_project": "Client Project", "tech_coe_any": ["Data Engineering"]},
    "Data Science Projects": {"type_of_project": "Client Project", "tech_coe_any": ["Data Science", "Data Science & ML"]},
    "AI Projects": {"type_of_project": "Client Project", "tech_coe_any": ["Gen AI", "Data Science & ML"]},
    "MS projects": {"type_of_project": "Managed Services"},
    "Full stack Projects": {"type_of_project": "Client Project", "tech_coe_any": ["Full Stack Engineering"]},
    "Value creation Projects": {"proposition_coe_any": ["Value Creation"]},
}

def _clean_scalar(v):
    """pandas nullable dtypes (e.g. a text column that's mostly NULL) can
    hand back pd.NA rather than plain None/NaN -- pydantic's response
    serializer has no idea what to do with pd.NA and 500s outright, so
    anything pulled out of a DataFrame via .get() for direct JSON output
    goes through this first."""
    return None if pd.isna(v) else v

def _primary_coe(tech_coe: str | None) -> str:
    if not tech_coe or pd.isna(tech_coe):
        return "Unknown"
    return str(tech_coe).split(";")[0]

ON_TIME_OVERRUN_GRACE_DAYS = 14

def _tag_on_time(real_projects: pd.DataFrame, allocations: pd.DataFrame) -> pd.DataFrame:
    max_alloc_end = allocations.groupby("project_id")["allocated_end_date"].max().rename("max_alloc_end")
    tagged = real_projects.merge(max_alloc_end, left_on="project_code", right_index=True, how="left")
    overrun_days = (tagged["max_alloc_end"] - tagged["project_end_date"]).dt.days
    tagged["is_on_time"] = overrun_days.fillna(0) <= ON_TIME_OVERRUN_GRACE_DAYS
    return tagged

# Same 5 WSR RAG columns health_monitor_service.py's worst_wsr_signal_vectorized
# tracks -- reimplemented locally (rather than imported) because
# health_monitor_service.py itself imports FROM this module (build_role_mix_
# templates/canonical_project_coe/get_role_mix), so importing it back here
# would be circular.
_WSR_RAG_COLUMNS = ["scope_status", "schedule_status", "quality_status", "csat_status", "team_status"]
_WSR_RAG_LABELS = {
    "scope_status": "Scope",
    "schedule_status": "Schedule",
    "quality_status": "Quality",
    "csat_status": "CSAT",
    "team_status": "Team",
}

def _projects_with_wsr_red_or_risk_note(project_codes: list[str]) -> set[str]:
    """Any project that ever had a RED WSR signal on any of the 5 RAG
    columns, or ever had a real narrative risk_note populated on any WSR row
    -- risk_note is genuinely sparse in the real data (~243 of 32k+ rows), so
    this is a real-but-partial signal, not proof of a clean history by
    itself; combined below with the other 3 signals rather than relied on alone."""
    wsr = get_adapter().get_wsr_reports()
    wsr = wsr[wsr["project_id_masked"].isin(project_codes)]
    if wsr.empty:
        return set()
    is_red = (wsr[_WSR_RAG_COLUMNS] == "RED").any(axis=1)
    has_risk_note = wsr["risk_note"].notna() & (wsr["risk_note"].astype(str).str.strip() != "") if "risk_note" in wsr.columns else False
    return set(wsr.loc[is_red | has_risk_note, "project_id_masked"].unique())

def _projects_with_logged_risk(project_codes: list[str]) -> set[str]:
    """Any project with a real risk ever logged in the Cluster Governance
    tool (resolved or not) -- real operator input, but only exists for
    projects someone has actually reviewed in that tool, so absence here
    means "nothing logged," not "verified clean.\""""
    if not project_codes:
        return set()
    risks = list_risks(project_codes, include_resolved=True)
    return {r["project_code"] for r in risks}

def _projects_with_effort_spike(project_codes: list[str]) -> set[str]:
    """Any project whose own last recorded timesheet week ran >1.5x its own
    prior 3-week baseline (timesheet_insights_service.get_project_effort_
    spikes -- already scoped to each project's own history, not "today")."""
    spikes = get_project_effort_spikes()
    codes = set(project_codes)
    return {pid for pid, v in spikes.items() if pid in codes and v.get("is_effort_spike")}

def _tag_clean(real_projects: pd.DataFrame) -> pd.DataFrame:
    """Tags each real, completed project with had_extension/had_escalation/
    is_clean -- "clean" meaning a real precedent worth recommending a team
    combination from: no recorded extension (projects.extended_end_date is
    the single source of truth for that -- see project_extension_history_
    service.py's own docstring, which is a derived log, not the ground
    truth) and no escalation signal across WSR history, the real risk log,
    or a real effort spike near the project's own end."""
    codes = real_projects["project_code"].unique().tolist()
    escalated = (
        _projects_with_wsr_red_or_risk_note(codes)
        | _projects_with_logged_risk(codes)
        | _projects_with_effort_spike(codes)
    )
    tagged = real_projects.copy()
    tagged["had_extension"] = tagged["extended_end_date"].notna() if "extended_end_date" in tagged.columns else False
    tagged["had_escalation"] = tagged["project_code"].isin(escalated)
    tagged["is_clean"] = ~tagged["had_extension"] & ~tagged["had_escalation"]
    return tagged

def _escalation_reason_tags(filtered: pd.DataFrame, codes: list[str]) -> dict[str, list[str]]:
    """Per-project human-readable reasons a project counts as non-clean --
    which real signal(s) actually fired (a real extension and whether it was
    billable/unbillable, a WSR RED status, a real WSR risk note, a real
    logged Cluster Governance risk, or a real effort spike near the
    project's end), not just a bare "escalated" flag."""
    if not codes:
        return {}
    wsr = get_adapter().get_wsr_reports()
    wsr = wsr[wsr["project_id_masked"].isin(codes)]
    red_flags_by_code: dict[str, list[str]] = {}
    risk_notes_by_code: dict[str, list[str]] = {}
    if not wsr.empty:
        for code, group in wsr.groupby("project_id_masked"):
            flags = [label for col, label in _WSR_RAG_LABELS.items() if (group[col] == "RED").any()]
            if flags:
                red_flags_by_code[code] = flags
            if "risk_note" in group.columns:
                notes = group["risk_note"].dropna().astype(str).str.strip()
                risk_notes_by_code[code] = sorted({n for n in notes if n})

    logged_by_code: dict[str, list[dict]] = {}
    for r in list_risks(codes, include_resolved=True):
        logged_by_code.setdefault(r["project_code"], []).append(
            {"description": r["risk_description"], "type": r.get("risk_type")}
        )

    spikes = get_project_effort_spikes()

    tags: dict[str, list[str]] = {}
    for code in codes:
        rows = filtered[filtered["project_code"] == code]
        if rows.empty:
            continue
        first = rows.iloc[0]
        reasons = []
        if bool(first.get("had_extension", False)):
            status = _clean_scalar(first.get("extended_end_status"))
            reasons.append(f"extended ({status.lower()})" if isinstance(status, str) and status else "extended")
        if red_flags_by_code.get(code):
            reasons.append(f"WSR escalation ({', '.join(red_flags_by_code[code])})")
        if risk_notes_by_code.get(code):
            reasons.append("a real risk note was logged in WSR")
        if logged_by_code.get(code):
            reasons.append("a real risk was logged in Cluster Governance")
        if spikes.get(code, {}).get("is_effort_spike"):
            reasons.append("an effort spike was recorded near the project's end")
        tags[code] = reasons
    return tags

def _real_completed_merged() -> pd.DataFrame:
    adapter = get_adapter()
    projects = adapter.get_projects()
    allocations = adapter.get_allocations()
    employees = adapter.get_employees()

    real = projects[
        (projects["date_source"].isin(["given", "derived_allocation"])) & (projects["project_status"] == "COMPLETE")
    ].copy()
    real["tech_coe_primary"] = real["tech_coe"].apply(_primary_coe)
    real = _tag_on_time(real, allocations)
    real = _tag_clean(real)

    merged = (
        real.merge(allocations, left_on="project_code", right_on="project_id")
        .merge(employees[["employee_id", "job_name"]], on="employee_id", how="left")
    )
    merged = merged.dropna(subset=["job_name"])
    merged["fte"] = merged["allocation_by_percentage"] / 100.0
    return merged

COMMON_ROLE_PREVALENCE_PCT = 40.0

MIN_ON_TIME_SAMPLE_PROJECTS = 3

def _aggregate_role_mix_preferring_on_time(group: pd.DataFrame) -> dict:
    on_time = group[group.get("is_on_time", False) == True]  # noqa: E712
    on_time_n = int(on_time["project_code"].nunique()) if not on_time.empty else 0
    all_n = int(group["project_code"].nunique())

    if on_time_n >= MIN_ON_TIME_SAMPLE_PROJECTS:
        result = _aggregate_role_mix_detailed(on_time)
        result["source"] = "derived_empirical_on_time_preferred"
    else:
        result = _aggregate_role_mix_detailed(group)

    result["on_time_sample_size"] = on_time_n
    result["all_completed_sample_size"] = all_n
    return result

def _resolve_matched_cohort(project_code: str) -> dict | None:
    """Real completed precedent projects of the SAME kind as project_code --
    the shared cohort-matching step behind both get_clean_role_mix_for_project
    and analyze_team_size_fit. Returns None if the project itself is unknown;
    an empty `filtered` frame (with metadata still populated) if the project
    is known but no precedent exists yet.

    tech CoE is the sharpest narrowing signal when it's real (e.g. "Data
    Engineering") -- but real tech_coe is genuinely blank on a large share of
    "Client Project" rows (~60% in the real data), and type_of_project alone
    is too broad a bucket to produce a real "typical team" (a check against
    1500+ wildly varied real Client Projects surfaced only ONE role crossing
    the 40% commonality bar). proposition_coe (e.g. "Value Creation", "Core
    Reporting") is the real, populated sub-category most of those blank-
    tech_coe projects DO carry -- exactly the "type or sub proposition"
    narrowing this feature needs, so it's used as the second-tier signal
    rather than falling straight through to type-only."""
    adapter = get_adapter()
    projects = adapter.get_projects()
    target = projects[projects["project_code"] == project_code]
    if target.empty:
        return None

    target_row = target.iloc[0]
    type_of_project = _clean_scalar(target_row.get("type_of_project"))
    coe = canonical_project_coe(target_row.get("tech_coe"))
    proposition_coe = _clean_scalar(target_row.get("proposition_coe"))

    merged = _real_completed_merged()
    base_mask = merged["project_code"] != project_code
    if type_of_project:
        base_mask &= merged["type_of_project"] == type_of_project

    matched_by = "type_of_project"
    mask = base_mask
    if coe:
        raw_aliases = CANONICAL_COE_MAP.get(coe, [])
        mask = base_mask & merged["tech_coe"].fillna("").apply(lambda v: any(a in v for a in raw_aliases))
        matched_by = "type_of_project + tech CoE"
    elif proposition_coe:
        mask = base_mask & merged["proposition_coe"].fillna("").apply(lambda v: proposition_coe in v)
        matched_by = "type_of_project + proposition CoE"

    filtered = merged[mask]

    # Also narrow by real project length when we can -- a 4-week engagement
    # and a 52-week one needing different headcounts is a real confound a
    # pure type/CoE match doesn't control for. Only applied when there's
    # still enough left to bucket by headcount afterward (MIN_DURATION_
    # NARROWED_SAMPLE); a small cohort narrowed further by duration too
    # would leave headcount buckets too thin to mean anything, so it falls
    # back to the type/CoE-only cohort instead, same graceful-degradation
    # shape as the on-time/clean preference tiers above.
    target_duration_weeks = None
    duration_narrowed = False
    start, end = target_row.get("project_start_date"), target_row.get("project_end_date")
    if pd.notna(start) and pd.notna(end):
        weeks = (end - start).days / 7
        if weeks and weeks > 0:
            target_duration_weeks = round(weeks, 1)
            proj_weeks = (filtered["project_end_date"] - filtered["project_start_date"]).dt.days / 7
            similar_duration = proj_weeks.between(weeks * DURATION_SIMILARITY_MIN_RATIO, weeks * DURATION_SIMILARITY_MAX_RATIO)
            narrowed = filtered[similar_duration]
            if narrowed["project_code"].nunique() >= MIN_DURATION_NARROWED_SAMPLE:
                filtered = narrowed
                duration_narrowed = True
                matched_by += " + similar duration"

    return {
        "filtered": filtered,
        "coe": coe,
        "type_of_project": type_of_project,
        "proposition_coe": proposition_coe,
        "matched_by": matched_by,
        "target_duration_weeks": target_duration_weeks,
        "duration_narrowed": duration_narrowed,
    }

DURATION_SIMILARITY_MIN_RATIO = 0.5
DURATION_SIMILARITY_MAX_RATIO = 2.0
MIN_DURATION_NARROWED_SAMPLE = 15

MIN_SIZE_BUCKET_SAMPLE = 2

def _team_size_bucket(filtered: pd.DataFrame, project_meta: pd.DataFrame, headcount: int) -> dict:
    b = project_meta[project_meta["headcount"] == headcount]
    total = len(b)
    clean_rows = b[b["is_clean"] == True]  # noqa: E712
    risky_rows = b[b["is_clean"] == False]  # noqa: E712
    # Every clean/risky precedent is returned, not just a handful -- the
    # frontend scrolls its own list rather than us silently dropping proof.
    reason_tags = _escalation_reason_tags(filtered, risky_rows.index.tolist())
    return {
        "headcount": headcount,
        "total": total,
        "clean": len(clean_rows),
        "risky": len(risky_rows),
        "clean_rate": round(len(clean_rows) / total, 2) if total else None,
        "clean_examples": [
            {"project_code": code, "project_name": _clean_scalar(row["project_name"])}
            for code, row in clean_rows.iterrows()
        ],
        "risky_examples": [
            {"project_code": code, "project_name": _clean_scalar(row["project_name"]), "reasons": reason_tags.get(code, [])}
            for code, row in risky_rows.iterrows()
        ],
    }

def _designation_prevalence(filtered: pd.DataFrame, project_meta: pd.DataFrame, headcount: int) -> dict[str, float]:
    codes = project_meta[project_meta["headcount"] == headcount].index
    if len(codes) == 0:
        return {}
    sub = filtered[filtered["project_code"].isin(codes)]
    n = len(codes)
    return {d: round(100 * rows["project_code"].nunique() / n, 0) for d, rows in sub.groupby("job_name")}

def _suggest_role_for_size_change(
    filtered: pd.DataFrame, project_meta: pd.DataFrame, from_h: int, to_h: int, candidate_designations: set[str] | None = None
) -> str | None:
    """The single designation whose real prevalence rises the most going
    from a from_h-person team to a to_h-person one in this cohort -- "the
    role that's usually the difference" rather than the whole team.

    When shrinking a team (to_h < from_h), candidate_designations must be the
    CURRENT team's own designations -- recommending "remove 1 Consultant"
    when nothing on the actual team is titled "Consultant" (a real, common
    mismatch: many close-but-different real titles exist, e.g. "Solutions
    Consultant" vs "Senior Associate Consultant") is a suggestion nobody can
    act on. Growing a team has no such constraint -- the new seat doesn't
    need to already exist."""
    p_from = _designation_prevalence(filtered, project_meta, from_h)
    p_to = _designation_prevalence(filtered, project_meta, to_h)
    if not p_to:
        return None
    diffs = {d: p_to.get(d, 0) - p_from.get(d, 0) for d in p_to}
    if candidate_designations is not None:
        diffs = {d: v for d, v in diffs.items() if d in candidate_designations}
    best = max(diffs, key=diffs.get) if diffs else None
    return best if best and diffs[best] > 0 else None

def analyze_team_size_fit(project_code: str, current_designations: list[str]) -> dict:
    """Minimal-change guidance instead of a wholesale team swap: does the
    CURRENTLY selected headcount for this project match a team size that
    historically stayed clean (no extension/escalation) for real completed
    projects of this same type/CoE, or does a size exactly one person
    larger/smaller have a meaningfully better track record -- and if so,
    which specific role is the one that typically differs between those two
    sizes. Always grounded in named real precedent projects, never a guess."""
    current_headcount = len([d for d in current_designations if d])
    cohort = _resolve_matched_cohort(project_code)
    if cohort is None:
        return {"current_headcount": current_headcount, "recommendation": "unknown_project"}

    filtered = cohort["filtered"]
    base = {
        "current_headcount": current_headcount,
        "coe": cohort["coe"], "type_of_project": cohort["type_of_project"],
        "proposition_coe": cohort["proposition_coe"], "matched_by": cohort["matched_by"],
        "target_duration_weeks": cohort["target_duration_weeks"], "duration_narrowed": cohort["duration_narrowed"],
    }
    if filtered.empty or current_headcount == 0:
        return {**base, "recommendation": "no_data"}

    project_meta = filtered.groupby("project_code").agg(
        headcount=("employee_id", "nunique"), is_clean=("is_clean", "first"), project_name=("project_name", "first")
    )

    current_bucket = _team_size_bucket(filtered, project_meta, current_headcount)
    smaller_bucket = _team_size_bucket(filtered, project_meta, current_headcount - 1) if current_headcount > 1 else None
    larger_bucket = _team_size_bucket(filtered, project_meta, current_headcount + 1)

    # A candidate only counts if it comes with a concrete, actionable role --
    # "remove 1 Consultant" is worthless if nothing on the actual team is
    # titled "Consultant". Adding has no such constraint (the new seat
    # doesn't need to already exist); removing is restricted to designations
    # genuinely present in the current selection.
    current_designation_set = {d for d in current_designations if d}
    candidates: list[tuple[str, dict, str | None]] = []
    if current_bucket["total"] >= MIN_SIZE_BUCKET_SAMPLE:
        candidates.append(("sufficient", current_bucket, None))
    if larger_bucket["total"] >= MIN_SIZE_BUCKET_SAMPLE:
        add_role = _suggest_role_for_size_change(filtered, project_meta, current_headcount, current_headcount + 1)
        if add_role:
            candidates.append(("add_one", larger_bucket, add_role))
    if smaller_bucket and smaller_bucket["total"] >= MIN_SIZE_BUCKET_SAMPLE:
        remove_role = _suggest_role_for_size_change(
            filtered, project_meta, current_headcount, current_headcount - 1, candidate_designations=current_designation_set
        )
        if remove_role:
            candidates.append(("remove_one", smaller_bucket, remove_role))

    if not candidates:
        return {**base, "recommendation": "not_enough_data", "current_bucket": current_bucket, "smaller_bucket": smaller_bucket, "larger_bucket": larger_bucket}

    # A neighboring size only wins if its clean rate clears the current
    # size's by a real margin, not sampling noise -- e.g. 94% vs 92% on
    # samples in the hundreds is not a reason to tell someone to change
    # headcount. Default stays "sufficient" whenever the current size
    # already has a real sample; only a genuinely better neighbor (or no
    # sample at all for the current size) overrides that.
    MIN_CLEAN_RATE_IMPROVEMENT = 0.10
    current_rate = current_bucket["clean_rate"] if current_bucket["total"] >= MIN_SIZE_BUCKET_SAMPLE else None
    alt_candidates = [c for c in candidates if c[0] != "sufficient"]
    best_alt = max(alt_candidates, key=lambda c: c[1]["clean_rate"] or 0, default=None)

    if current_rate is not None and (best_alt is None or (best_alt[1]["clean_rate"] or 0) < current_rate + MIN_CLEAN_RATE_IMPROVEMENT):
        recommendation, best_bucket, suggested_role = "sufficient", current_bucket, None
    elif best_alt is not None:
        recommendation, best_bucket, suggested_role = best_alt
    else:
        recommendation, best_bucket, suggested_role = max(candidates, key=lambda c: c[1]["clean_rate"] or 0)

    return {
        **base,
        "recommendation": recommendation,
        "suggested_role": suggested_role,
        "current_bucket": current_bucket,
        "smaller_bucket": smaller_bucket,
        "larger_bucket": larger_bucket,
        "best_bucket": best_bucket,
    }

def _aggregate_role_mix_detailed(group: pd.DataFrame) -> dict:
    n_projects = group["project_code"].nunique()
    roles = []
    role_mix_fte: dict[str, float] = {}
    for designation, rows in group.groupby("job_name"):
        n_projects_with_role = rows["project_code"].nunique()
        prevalence_pct = round(100 * n_projects_with_role / n_projects, 0)
        # .mode() drops NaN and can come back empty if every real allocation
        # row for this designation has no percentage at all (a genuine gap in
        # some real data sources, not just a bad row here or there --
        # confirmed against the real JIN Data Warehouse's own
        # allocation_by_percentage column, which came through entirely
        # unpopulated) -- 100% (full-time) is the most common real-world
        # allocation by far, so it's the honest default when there's truly no
        # percentage data to summarize, rather than crashing outright.
        pct_mode = rows["allocation_by_percentage"].mode()
        typical_pct = float(pct_mode.iat[0]) if not pct_mode.empty else 100.0
        heads_per_project = rows.groupby("project_code")["employee_id"].nunique()
        headcount = max(1, round(heads_per_project.mean()))
        roles.append(
            {
                "designation": designation,
                "headcount": int(headcount),
                "typical_pct": typical_pct,
                "prevalence_pct": prevalence_pct,
                "common": bool(prevalence_pct >= COMMON_ROLE_PREVALENCE_PCT),
            }
        )
        role_mix_fte[designation] = round(headcount * typical_pct / 100, 2)
    roles.sort(key=lambda r: -r["prevalence_pct"])
    expected_headcount_common = sum(r["headcount"] for r in roles if r["common"])
    return {
        "roles": roles,
        "role_mix": role_mix_fte,
        "expected_headcount_common": expected_headcount_common,
        "sample_size": int(n_projects),
        "source": "derived_empirical",
    }

def _docx_template_to_roles(template: dict[str, float]) -> list[dict]:
    # fte <= 1.0 is one person at that %; fte > 1.0 (e.g. "2 engineer seats
    # @ 100% each" = 2.0) needs to split across that many people instead of
    # reporting it as one person at 200%.
    roles = []
    for d, fte in template.items():
        headcount = max(1, round(fte)) if fte >= 1.0 else 1
        typical_pct = round(fte / headcount * 100, 1)
        roles.append({"designation": d, "headcount": headcount, "typical_pct": typical_pct, "prevalence_pct": None, "common": True})
    return roles

def build_role_mix_templates() -> dict[tuple[str, str], dict]:
    merged = _real_completed_merged()
    templates: dict[tuple[str, str], dict] = {}
    for (type_of_project, coe), group in merged.groupby(["type_of_project", "tech_coe_primary"]):
        templates[(type_of_project, coe)] = _aggregate_role_mix_preferring_on_time(group)
    return templates

def get_role_mix_by_category(category: str) -> dict:
    spec = DOCX_CATEGORY_MAP.get(category)
    if spec is None:
        return {"role_mix": {}, "roles": [], "sample_size": 0, "source": "unknown_category"}
    if spec.get("docx_given"):
        template = _DOCX_TEMPLATES[category]
        return {"role_mix": template, "roles": _docx_template_to_roles(template), "sample_size": None, "source": "docx_given"}

    merged = _real_completed_merged()
    mask = pd.Series(True, index=merged.index)
    if "type_of_project" in spec:
        mask &= merged["type_of_project"] == spec["type_of_project"]
    if "tech_coe_any" in spec:
        mask &= merged["tech_coe"].fillna("").apply(lambda v: any(k in v for k in spec["tech_coe_any"]))
    if "proposition_coe_any" in spec:
        mask &= merged["proposition_coe"].fillna("").apply(lambda v: any(k in v for k in spec["proposition_coe_any"]))

    filtered = merged[mask]
    if filtered.empty:
        return {"role_mix": {}, "roles": [], "sample_size": 0, "source": "no_data"}
    result = _aggregate_role_mix_preferring_on_time(filtered)
    result["resolved_via"] = spec
    return result

def list_docx_categories() -> list[dict]:
    return [{"category": name, **get_role_mix_by_category(name)} for name in DOCX_CATEGORY_MAP]

CANONICAL_COE_MAP: dict[str, list[str]] = {
    "Data Engineering": ["Data Engineering"],
    "BI & Reporting": ["BI and Reporting"],
    "AI & ML": ["Data Science & ML", "Gen AI", "Data Science", "DS/AI", "Software Development and LLMs"],
    "Full Stack Engineering": ["Full Stack Engineering"],
    "TechOps & Automation": ["TechOps and Automation", "TechOps And MS"],
}

def canonical_project_coe(tech_coe: str | None) -> str | None:
    if not tech_coe or pd.isna(tech_coe):
        return None
    v = str(tech_coe)
    for canonical, aliases in CANONICAL_COE_MAP.items():
        if any(a in v for a in aliases):
            return canonical
    return None

def list_coes() -> list[dict]:
    real_complete = _real_completed_merged()[["project_code", "tech_coe"]].drop_duplicates("project_code")
    tech_coe = real_complete["tech_coe"].fillna("")
    result = []
    for canonical, raw_aliases in CANONICAL_COE_MAP.items():
        sample_size = int(tech_coe.apply(lambda v: any(a in v for a in raw_aliases)).sum())
        result.append({"coe": canonical, "sample_size": sample_size})
    return sorted(result, key=lambda c: -c["sample_size"])

def get_role_mix_by_coes(coes: list[str], type_of_project: str | None = None) -> dict:
    if not coes:
        return {"role_mix": {}, "roles": [], "sample_size": 0, "source": "no_coes_selected", "matched_project_codes": []}

    raw_aliases = [alias for coe in coes for alias in CANONICAL_COE_MAP.get(coe, [coe])]
    merged = _real_completed_merged()
    mask = merged["tech_coe"].fillna("").apply(lambda v: any(a in v for a in raw_aliases))
    if type_of_project:
        mask &= merged["type_of_project"] == type_of_project

    filtered = merged[mask]
    if filtered.empty:
        return {"role_mix": {}, "roles": [], "sample_size": 0, "source": "no_data", "matched_project_codes": []}
    result = _aggregate_role_mix_preferring_on_time(filtered)
    result["matched_project_codes"] = sorted(filtered["project_code"].unique().tolist())[:10]
    return result

def get_role_mix(type_of_project: str, tech_coe: str | None = None, templates: dict | None = None) -> dict:
    if type_of_project == DND_TACTICAL_BUILD:
        dnd_roles = _docx_template_to_roles(_DND_TEMPLATE)
        return {
            "role_mix": _DND_TEMPLATE,
            "roles": dnd_roles,
            "expected_headcount_common": sum(r["headcount"] for r in dnd_roles),
            "sample_size": None,
            "source": "docx_given",
        }

    if templates is None:
        templates = build_role_mix_templates()
    coe = _primary_coe(tech_coe)

    if (type_of_project, coe) in templates:
        return templates[(type_of_project, coe)]

    same_type = [v for (t, _), v in templates.items() if t == type_of_project]
    if same_type:
        best = max(same_type, key=lambda v: v["sample_size"])
        return {**best, "source": "derived_empirical_type_fallback"}

    if templates:
        best = max(templates.values(), key=lambda v: v["sample_size"])
        return {**best, "source": "derived_empirical_org_fallback"}

    return {"role_mix": {}, "sample_size": 0, "source": "no_data"}

def list_role_mix_templates() -> list[dict]:
    templates = build_role_mix_templates()
    out = [
        {"type_of_project": name, "tech_coe": None, "role_mix": template, "sample_size": None, "source": "docx_given"}
        for name, template in _DOCX_TEMPLATES.items()
    ]
    for (type_of_project, coe), v in templates.items():
        out.append({"type_of_project": type_of_project, "tech_coe": coe, **v})
    return out
