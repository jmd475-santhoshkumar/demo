from app.engines.role_hierarchy import TITLE_TO_LEVEL

_LEVEL_BY_LOWER_TITLE: dict[str, int] = {title.lower(): level for title, level in TITLE_TO_LEVEL.items()}

# One rate per canonical org level (app.engines.role_hierarchy) -- every title at the
# same level bills the same, regardless of which naming family (UK/USA vs India) it
# belongs to. Reuses today's real numbers at every level except Senior Software
# Engineer, which used to share a band with plain Software Engineer (both $45) despite
# being a different real level -- it now matches its true peer, Senior Associate
# Consultant, at $85.
LEVEL_RATES: dict[int, float] = {
    1: 25.0,
    2: 45.0,
    3: 85.0,
    4: 65.0,
    5: 70.0,
    6: 110.0,
    7: 145.0,
    8: 190.0,
    9: 240.0,
}

NON_BILLABLE_RATE = None

_NON_BILLABLE_TITLES = {
    "admin manager", "fp&a business partner", "fp&a manager", "it manager",
    "marketing manager", "office manager", "people partner", "resourcing manager",
    "senior hr leader consultant", "talent acquisition partner",
}

def get_hourly_rate(job_name) -> float | None:
    if not isinstance(job_name, str) or not job_name.strip():
        return NON_BILLABLE_RATE
    text = job_name.strip().lower()
    if text in _NON_BILLABLE_TITLES:
        return NON_BILLABLE_RATE
    level = _LEVEL_BY_LOWER_TITLE.get(text)
    if level is None:
        return NON_BILLABLE_RATE
    return LEVEL_RATES.get(level)

def get_rate_card(job_names: list[str]) -> list[dict]:
    from app.services.jin_budget_service import get_real_rate_card

    real_by_designation: dict[str, dict] = {}
    for r in get_real_rate_card():
        existing = real_by_designation.get(r["designation"])
        if existing is None or r["sample_size"] > existing["sample_size"]:
            real_by_designation[r["designation"]] = r

    seen = sorted(set(j for j in job_names if j))
    out = []
    for j in seen:
        real = real_by_designation.get(j)
        entry = {"job_name": j, "hourly_rate_usd": get_hourly_rate(j), "source": "illustrative"}
        if real:
            # Real day-rate data from JIN's real budget line items, not currency-
            # normalized (no currencyId lookup exists yet -- see jin_budget_service
            # module docstring), so kept separate from hourly_rate_usd rather than
            # replacing it.
            entry["real_median_cost_per_day"] = real["median_cost_per_day"]
            entry["real_median_price_per_day"] = real["median_price_per_day"]
            entry["real_location"] = real["location"]
            entry["real_sample_size"] = real["sample_size"]
        out.append(entry)
    return out
