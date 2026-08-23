import json

from app.services import jin_budget_service
from app.services.project_appstate_service import get_row, upsert_row
from app.services.rate_card_service import get_hourly_rate

BUDGET_CSV = "project_budget"

HEADER_FIELDS = ["billing_currency", "engagement_style", "proposition_coe", "payment_term", "is_billable"]

# This app's existing rate authority (already used by demand_forecast_service /
# revenue_engine) is a flat, designation-only, illustrative USD hourly band --
# not the real location-adjusted rate card JIN shows. Reused as-is rather than
# fabricated to look like a precise match.
def get_day_rate(designation: str, hours_per_day: float = 8.0) -> float | None:
    hourly = get_hourly_rate(designation)
    return round(hourly * hours_per_day, 2) if hourly is not None else None

def get_suggested_team(proposition_coe: str, hours_per_day: float = 8.0) -> list[dict]:
    """Typical team composition for this proposition_coe, derived from real
    APPROVED/FINANCE_APPROVED JIN budgets (jin_budget_service). A starting
    point for the wizard's line items, not a finished budget -- every field
    stays editable. base_day_rate/eff_day_rate keep using the existing
    illustrative USD rate (get_day_rate) so this never silently mixes an
    unresolved-currency real number into a USD-labeled field; the real
    cost/price are surfaced alongside as a separate reference. Returns []
    (not a fabricated team) if there's no real budget history for this
    proposition_coe yet."""
    composition = jin_budget_service.get_typical_team_composition().get(proposition_coe, [])
    real_rates_by_designation: dict[str, dict] = {}
    for r in jin_budget_service.get_real_rate_card():
        existing = real_rates_by_designation.get(r["designation"])
        if existing is None or r["sample_size"] > existing["sample_size"]:
            real_rates_by_designation[r["designation"]] = r

    suggestions = []
    for item in composition:
        designation = item["designation"]
        real_rate = real_rates_by_designation.get(designation)
        base_rate = get_day_rate(designation, hours_per_day)
        suggestions.append({
            "designation": designation,
            "location": real_rate["location"] if real_rate else None,
            "estimated_start_date": None,
            "hours_per_day": hours_per_day,
            "allocation_pct": item["avg_allocation_pct"],
            "working_days": round(item["avg_working_days"]),
            "base_day_rate": base_rate,
            "eff_day_rate": base_rate,
            "real_frequency_pct": item["frequency_pct"],
            "real_median_cost_per_day": real_rate["median_cost_per_day"] if real_rate else None,
            "real_median_price_per_day": real_rate["median_price_per_day"] if real_rate else None,
        })
    return suggestions

def save_budget(project_code: str, header: dict, line_items: list[dict]) -> dict:
    fields = {k: header.get(k) for k in HEADER_FIELDS}
    fields["line_items"] = json.dumps(line_items)
    upsert_row(BUDGET_CSV, project_code, fields)
    return {"project_code": project_code, **{k: header.get(k) for k in HEADER_FIELDS}, "line_items": line_items}

def get_budget(project_code: str) -> dict | None:
    row = get_row(BUDGET_CSV, project_code)
    if row is None:
        return None
    row = dict(row)
    row["line_items"] = json.loads(row["line_items"]) if row.get("line_items") else []
    return row
