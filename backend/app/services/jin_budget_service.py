"""Real JIN budget-approval workflow (stg_jin.budget / stg_jin.budget_resources,
loaded as budgets_jin/budget_resources_jin -- see app/core/db.py). Confirmed
via a full audit: stid<->abudgetid is a clean join (0 orphans), and
budget.projectid matches projects.jin_project_id 387/387 (see
app/scripts/backfill_jin_project_id.py and jdwh_table_mapping.map_project_table
for where that column comes from).

currencyId has NO resolution anywhere in this app or the fuller schema export
(project.project_currency is 100% NULL) -- professionalfee/cost/price are
real but not currency-normalized across the 3 distinct currencyId values, so
this module never presents them as a labeled USD figure. Everything else
(project linkage, designation, delivery location via buId, approval status)
needs no currency and is used directly.

comment/discountreason contain real client names and real commercial terms in
plain text -- internal-audience display only (same posture as Cluster
Governance's real risk notes), never passed into an LLM prompt or exported.
"""
from functools import lru_cache

import pandas as pd

from app.core.adapter import get_adapter

# Resolved from employee.business_unit_id -> employee.location (dominant
# location per bu_id) in the fuller schema export -- budget_resources_jin's
# buid has no location name of its own. Chennai/London/New York line up with
# the 3 real cost/price tiers already found in the resource-line data.
LOCATION_BY_BUID = {
    "000db52c-63de-49f5-832d-a0f631a51260": "Chennai",
    "0005754a-e64e-4e29-b0de-579b86ef3086": "London",
    "4fca14d0-b5f6-11ee-9a1c-e750bf2b016e": "New York",
}

APPROVED_STATUSES = {"APPROVED", "FINANCE_APPROVED"}


def _jin_employee_id_lookup() -> dict:
    """real jin_employee_id (UUID) -> app employee_id, from the column
    map_employee_table now carries through (see backfill_jin_employee_id.py
    for the one-time backfill applied to the CSV already on disk)."""
    employees = get_adapter().get_employees()
    if "jin_employee_id" not in employees.columns:
        return {}
    valid = employees.dropna(subset=["jin_employee_id"])
    return dict(zip(valid["jin_employee_id"], valid["employee_id"]))


def _budgets_raw() -> pd.DataFrame:
    return get_adapter().get_budgets_jin().copy()


def _resources_raw() -> pd.DataFrame:
    return get_adapter().get_budget_resources_jin().copy()


def _projects_with_jin_id() -> pd.DataFrame:
    projects = get_adapter().get_projects()
    if "jin_project_id" not in projects.columns:
        return pd.DataFrame(columns=["project_code", "project_name", "jin_project_id", "proposition_coe"])
    out = projects[projects["jin_project_id"].notna()][["project_code", "project_name", "jin_project_id", "proposition_coe"]]
    return out.drop_duplicates(subset=["jin_project_id"])


def _employee_names() -> dict:
    employees = get_adapter().get_employees()
    return dict(zip(employees["employee_id"], employees["employee_full_name"]))


def _resolve_person(jin_id: str | None, jin_lookup: dict, names: dict) -> str | None:
    if not jin_id or pd.isna(jin_id):
        return None
    emp_id = jin_lookup.get(str(jin_id).strip().lower())
    if not emp_id:
        return None
    name = names.get(emp_id)
    return name if isinstance(name, str) and name else emp_id


def get_budget_approvals() -> list[dict]:
    """One row per real budget (stid) -- the Budget Approvals dashboard.
    project_code is present only for the ~94% of budgets whose projectid
    resolved (see module docstring); the rest show as unlinked rather than
    silently dropped, since a PENDING/REJECTED budget with no project yet is
    a real, valid state (a deal not yet turned into a project)."""
    budgets = _budgets_raw()
    if budgets.empty:
        return []
    resources = _resources_raw()
    projects = _projects_with_jin_id()
    jin_lookup = _jin_employee_id_lookup()
    names = _employee_names()

    line_counts = resources.groupby("abudgetid").size().to_dict()

    merged = budgets.merge(
        projects, left_on="projectid", right_on="jin_project_id", how="left", suffixes=("", "_proj")
    )

    out = []
    for row in merged.itertuples(index=False):
        out.append({
            "budget_id": row.stid,
            "version": int(row.version) if pd.notna(row.version) else None,
            "project_code": getattr(row, "project_code", None),
            "project_name": getattr(row, "project_name", None),
            "engagement_style": row.engagementstyle,
            "status": row.status,
            "proposition_coe": row.propositioncoe,
            "professional_fee": float(row.professionalfee) if pd.notna(row.professionalfee) else None,
            "currency_id": row.currencyid,
            "margin_pct": float(row.margin) if pd.notna(row.margin) else None,
            "payment_term": row.paymentterm,
            "discount_type": row.discounttype,
            "discount_value": float(row.discountvalue) if pd.notna(row.discountvalue) else None,
            "discount_reason": row.discountreason if pd.notna(row.discountreason) else None,
            "comment": row.comment if pd.notna(row.comment) else None,
            "is_billable": bool(row.isbillable),
            "resource_line_count": line_counts.get(row.stid, 0),
            "created_at": row.createdat.isoformat() if pd.notna(row.createdat) else None,
            "created_by": _resolve_person(row.createdby, jin_lookup, names),
            "reviewed_at": row.reviewedat.isoformat() if pd.notna(row.reviewedat) else None,
            "reviewed_by": _resolve_person(row.reviewedby, jin_lookup, names),
        })
    out.sort(key=lambda r: r["created_at"] or "", reverse=True)
    return out


def _latest_version_per_group(budgets: pd.DataFrame, group_col: str, statuses: set | None = None) -> pd.DataFrame:
    df = budgets if statuses is None else budgets[budgets["status"].isin(statuses)]
    if df.empty:
        return df
    return df.sort_values("version").groupby(group_col, as_index=False).tail(1)


def get_project_budget_plan(project_code: str) -> dict | None:
    """The latest APPROVED/FINANCE_APPROVED budget for a real project_code,
    with its resource-line composition -- used by health_detail_service for
    a planned-vs-actual team comparison (headcount/allocation%, not $, since
    currency isn't resolved -- see module docstring)."""
    projects = _projects_with_jin_id()
    match = projects[projects["project_code"] == project_code]
    if match.empty:
        return None
    jin_id = match.iloc[0]["jin_project_id"]

    budgets = _budgets_raw()
    project_budgets = budgets[budgets["projectid"] == jin_id]
    if project_budgets.empty:
        return None

    latest_approved = _latest_version_per_group(project_budgets, "projectid", APPROVED_STATUSES)
    used_status = "approved"
    if latest_approved.empty:
        latest_approved = _latest_version_per_group(project_budgets, "projectid")
        used_status = "latest_non_approved"
    budget_row = latest_approved.iloc[0]

    resources = _resources_raw()
    lines = resources[resources["abudgetid"] == budget_row["stid"]]
    by_designation = []
    for designation, grp in lines.groupby("designation"):
        by_designation.append({
            "designation": designation,
            "planned_line_count": len(grp),
            "avg_allocation_pct": round(float(grp["allocation"].mean()), 1),
            "total_working_days": float(grp["workingdays"].sum()),
            "locations": sorted({LOCATION_BY_BUID.get(str(b).strip().lower(), "Unknown") for b in grp["buid"]}),
        })
    by_designation.sort(key=lambda d: -d["planned_line_count"])

    return {
        "budget_id": budget_row["stid"],
        "version": int(budget_row["version"]),
        "status": budget_row["status"],
        "used_status": used_status,
        "professional_fee": float(budget_row["professionalfee"]) if pd.notna(budget_row["professionalfee"]) else None,
        "currency_id": budget_row["currencyid"],
        "planned_resources": by_designation,
    }


def get_real_role_mix(project_code: str) -> dict | None:
    """Drop-in replacement for role_mix_engine.get_role_mix() (same return
    shape: roles/role_mix/expected_headcount_common/sample_size/source) but
    built from this PROJECT's own real approved budget instead of a
    statistical model averaged over similar past projects. Every planned
    line is real and specific to this project, so every role is "common"
    (no prevalence-based guessing) and sample_size/prevalence_pct don't
    apply. Returns None when this project has no real budget record, so
    callers fall back to the statistical model exactly as before -- this
    only replaces the model where real data actually exists (~26% of
    projects today), it never removes coverage for the rest."""
    plan = get_project_budget_plan(project_code)
    if plan is None:
        return None

    roles = [
        {
            "designation": r["designation"],
            "headcount": r["planned_line_count"],
            "typical_pct": r["avg_allocation_pct"],
            "prevalence_pct": None,
            "common": True,
        }
        for r in plan["planned_resources"]
    ]
    return {
        "roles": roles,
        "role_mix": {r["designation"]: round(r["headcount"] * r["typical_pct"] / 100, 2) for r in roles},
        "expected_headcount_common": sum(r["headcount"] for r in roles),
        "sample_size": None,
        "source": "real_budget",
        "budget_version": plan["version"],
        "budget_status": plan["status"],
    }


def get_real_role_mix_by_project() -> dict:
    """Batch form of get_real_role_mix() for every project that has one, in
    one pass -- used by health_monitor_service's per-project loop over
    ~2,000 active projects so it doesn't re-filter/re-group the small
    budgets_jin/budget_resources_jin tables once per project."""
    projects = _projects_with_jin_id()
    if projects.empty:
        return {}

    budgets = _budgets_raw()
    resources = _resources_raw()
    resources = resources.copy()
    resources["location"] = resources["buid"].apply(lambda b: LOCATION_BY_BUID.get(str(b).strip().lower(), "Unknown"))

    jin_id_to_code = dict(zip(projects["jin_project_id"], projects["project_code"]))
    linked = budgets[budgets["projectid"].isin(jin_id_to_code)]
    if linked.empty:
        return {}

    latest_approved = _latest_version_per_group(linked, "projectid", APPROVED_STATUSES)
    fallback_needed = set(linked["projectid"]) - set(latest_approved["projectid"])
    if fallback_needed:
        fallback = _latest_version_per_group(linked[linked["projectid"].isin(fallback_needed)], "projectid")
        latest_approved = pd.concat([latest_approved, fallback], ignore_index=True)

    result = {}
    for _, budget_row in latest_approved.iterrows():
        project_code = jin_id_to_code.get(budget_row["projectid"])
        if not project_code:
            continue
        lines = resources[resources["abudgetid"] == budget_row["stid"]]
        roles = [
            {
                "designation": designation,
                "headcount": len(grp),
                "typical_pct": round(float(grp["allocation"].mean()), 1),
                "prevalence_pct": None,
                "common": True,
            }
            for designation, grp in lines.groupby("designation")
        ]
        result[project_code] = {
            "roles": roles,
            "role_mix": {r["designation"]: round(r["headcount"] * r["typical_pct"] / 100, 2) for r in roles},
            "expected_headcount_common": sum(r["headcount"] for r in roles),
            "sample_size": None,
            "source": "real_budget",
            "budget_version": int(budget_row["version"]),
            "budget_status": budget_row["status"],
        }
    return result


def get_project_actual_vs_planned(project_code: str) -> dict | None:
    """Planned team (from the real budget) vs the app's real current
    allocations for the same project -- headcount/allocation% comparison,
    deliberately currency-free (see module docstring). Returns None if there
    is no budget record for this project at all (a real gap, not fabricated)."""
    plan = get_project_budget_plan(project_code)
    if plan is None:
        return None

    allocations = get_adapter().get_allocations()
    employees = get_adapter().get_employees()
    proj_allocs = allocations[
        (allocations["project_id"] == project_code) & (allocations["is_allocation_active"] == 1)
    ].merge(employees[["employee_id", "job_name"]], on="employee_id", how="left")

    actual_by_designation = (
        proj_allocs.groupby("job_name")
        .agg(actual_headcount=("employee_id", "nunique"), avg_allocation_pct=("allocation_by_percentage", "mean"))
        .reset_index()
        .rename(columns={"job_name": "designation"})
    )
    actual_map = {
        row["designation"]: {
            "actual_headcount": int(row["actual_headcount"]),
            "avg_allocation_pct": round(float(row["avg_allocation_pct"]), 1),
        }
        for _, row in actual_by_designation.iterrows()
    }

    comparison = []
    seen_designations = set()
    for line in plan["planned_resources"]:
        designation = line["designation"]
        seen_designations.add(designation)
        actual = actual_map.get(designation, {"actual_headcount": 0, "avg_allocation_pct": 0.0})
        comparison.append({
            "designation": designation,
            "planned_line_count": line["planned_line_count"],
            "planned_avg_allocation_pct": line["avg_allocation_pct"],
            **actual,
        })
    for designation, actual in actual_map.items():
        if designation not in seen_designations:
            comparison.append({
                "designation": designation,
                "planned_line_count": 0,
                "planned_avg_allocation_pct": 0.0,
                **actual,
            })

    return {
        "budget_id": plan["budget_id"],
        "version": plan["version"],
        "status": plan["status"],
        "used_status": plan["used_status"],
        "comparison": comparison,
    }


def get_budget_detail(budget_id: str) -> dict | None:
    """Everything real and related to one budget, for the Budget Approvals
    detail modal: header fields, its own real resource line items (not just
    the aggregated composition get_project_budget_plan uses), every other
    version of the same project's budget (approval history), the linked
    project's own real fields (if projectid resolved), and the same
    planned-vs-actual comparison the Health page shows."""
    budgets = _budgets_raw()
    row_match = budgets[budgets["stid"] == budget_id]
    if row_match.empty:
        return None
    row = row_match.iloc[0]

    resources = _resources_raw()
    lines = resources[resources["abudgetid"] == budget_id].copy()
    lines["location"] = lines["buid"].apply(lambda b: LOCATION_BY_BUID.get(str(b).strip().lower(), "Unknown"))
    resource_lines = [
        {
            "designation": r["designation"],
            "location": r["location"],
            "start_date": r["startdate"].isoformat() if pd.notna(r["startdate"]) else None,
            "working_days": float(r["workingdays"]) if pd.notna(r["workingdays"]) else None,
            "allocation_pct": float(r["allocation"]) if pd.notna(r["allocation"]) else None,
            "cost_per_day": float(r["cost"]) if pd.notna(r["cost"]) else None,
            "price_per_day": float(r["price"]) if pd.notna(r["price"]) else None,
        }
        for _, r in lines.iterrows()
    ]

    projects = _projects_with_jin_id()
    project_match = projects[projects["jin_project_id"] == row["projectid"]] if pd.notna(row["projectid"]) else projects.iloc[0:0]
    project_code = project_match.iloc[0]["project_code"] if not project_match.empty else None

    project_context = None
    if project_code:
        full_projects = get_adapter().get_projects()
        p = full_projects[full_projects["project_code"] == project_code]
        if not p.empty:
            p = p.iloc[0]
            project_context = {
                "project_code": project_code,
                "project_name": p.get("project_name") if pd.notna(p.get("project_name")) else None,
                "project_status": p.get("project_status") if pd.notna(p.get("project_status")) else None,
                "type_of_project": p.get("type_of_project") if pd.notna(p.get("type_of_project")) else None,
                "tech_coe": p.get("tech_coe") if pd.notna(p.get("tech_coe")) else None,
                "client_id": p.get("client_id") if pd.notna(p.get("client_id")) else None,
                "project_start_date": p["project_start_date"].isoformat() if pd.notna(p.get("project_start_date")) else None,
                "project_end_date": p["project_end_date"].isoformat() if pd.notna(p.get("project_end_date")) else None,
            }

    version_history = []
    if pd.notna(row["projectid"]):
        siblings = budgets[budgets["projectid"] == row["projectid"]].sort_values("version")
        jin_lookup = _jin_employee_id_lookup()
        names = _employee_names()
        for _, s in siblings.iterrows():
            version_history.append({
                "budget_id": s["stid"],
                "version": int(s["version"]),
                "status": s["status"],
                "professional_fee": float(s["professionalfee"]) if pd.notna(s["professionalfee"]) else None,
                "created_at": s["createdat"].isoformat() if pd.notna(s["createdat"]) else None,
                "reviewed_by": _resolve_person(s["reviewedby"], jin_lookup, names),
                "is_current": s["stid"] == budget_id,
            })

    actual_vs_planned = get_project_actual_vs_planned(project_code) if project_code else None

    approvals = get_budget_approvals()
    header = next((a for a in approvals if a["budget_id"] == budget_id), None)

    return {
        "header": header,
        "resource_lines": resource_lines,
        "project_context": project_context,
        "version_history": version_history,
        "actual_vs_planned": actual_vs_planned,
    }


@lru_cache(maxsize=1)
def get_real_rate_card() -> list[dict]:
    """Median real cost/price per (designation, location) from
    budget_resources_jin -- replaces rate_card_service's flat, explicitly
    "illustrative" designation-only USD band with real numbers. Not
    currency-normalized (see module docstring): cost/price are the raw
    figures as entered, labeled by location, not converted to USD."""
    resources = _resources_raw()
    resources = resources.copy()
    resources["location"] = resources["buid"].apply(lambda b: LOCATION_BY_BUID.get(str(b).strip().lower(), "Unknown"))
    grouped = (
        resources.groupby(["designation", "location"])
        .agg(
            median_cost_per_day=("cost", "median"),
            median_price_per_day=("price", "median"),
            sample_size=("id", "count"),
        )
        .reset_index()
    )
    return grouped.to_dict(orient="records")


@lru_cache(maxsize=1)
def get_typical_team_composition() -> dict:
    """Median team shape per real proposition_coe, from real APPROVED/
    FINANCE_APPROVED budgets only -- used to prefill the Budget Creation
    wizard's line items when a proposition_coe is chosen, instead of
    starting from a blank team every time."""
    budgets = _budgets_raw()
    approved = budgets[budgets["status"].isin(APPROVED_STATUSES)]
    resources = _resources_raw()

    out: dict[str, list[dict]] = {}
    for proposition_coe, grp in approved.groupby("propositioncoe"):
        budget_ids = set(grp["stid"])
        lines = resources[resources["abudgetid"].isin(budget_ids)]
        if lines.empty:
            continue
        n_budgets = len(budget_ids)
        composition = []
        for designation, dgrp in lines.groupby("designation"):
            composition.append({
                "designation": designation,
                "avg_lines_per_budget": round(len(dgrp) / n_budgets, 2),
                "avg_allocation_pct": round(float(dgrp["allocation"].mean()), 1),
                "avg_working_days": round(float(dgrp["workingdays"].mean()), 1),
                "frequency_pct": round(100 * dgrp["abudgetid"].nunique() / n_budgets, 1),
            })
        composition.sort(key=lambda c: -c["frequency_pct"])
        out[proposition_coe] = composition
    return out
