"""AI-generated plain-language summary of a team-size-fit check (see
app/engines/role_mix_engine.py's analyze_team_size_fit) -- turns the
structured clean/risky bucket comparison into one sentence a Resource
Manager can act on immediately.

Same grounding discipline as governance_synthetic_service.py: the AI only
ever interprets real computed counts already shown elsewhere on the page
(clean/risky totals at each team size, the real reasons tallied across the
risky precedents) -- it is never given room to invent a cause, client, or
project it wasn't handed. Cached per fingerprint of those real inputs so the
same computed state is never re-sent to the AI twice. Returns None (and the
frontend simply omits the line) when no AI provider is configured or the
call fails -- this is a plain-language add-on, never a dependency for the
feature's real, structured numbers to work."""
import hashlib
import json

import pandas as pd

from app.ai import llm
from app.core import appstate_db

INSIGHT_CACHE_TABLE = "team_size_fit_ai_insight_cache"
_CACHE_FIELDS = ["cache_key", "value"]

_PROMPT = """You are a resourcing analyst helping a Resource Manager understand a team-size decision that has ALREADY been made from real historical delivery data. Your only job is to explain WHY it makes sense in one plain sentence -- do NOT propose a different team size or verdict than the one given below, and do not invent a client name, a cause, or any detail not given here.

Verdict (already decided, do not contradict this): {verdict}

Project type: {scope}
Current team size: {current_headcount} people -- {current_clean}/{current_total} historically similar-sized completed projects finished with no extension or escalation ({current_rate}%).
{alt_line}
Real reasons found among the {risky_total} similarly-sized precedent projects that did NOT finish clean: {reason_summary}

Write ONE plain sentence (under 35 words) explaining why this verdict makes sense, grounded strictly in the real reasons above.

Respond with ONLY a JSON object, no markdown fences: {{"summary": "..."}}"""


def _fingerprint(*parts: str) -> str:
    return hashlib.sha1("::".join(parts).encode()).hexdigest()[:20]


def _load_cache() -> dict:
    df = appstate_db.read_all(INSIGHT_CACHE_TABLE, _CACHE_FIELDS)
    if df.empty:
        return {}
    cache = {}
    for _, r in df.iterrows():
        try:
            cache[r["cache_key"]] = json.loads(r["value"])
        except (json.JSONDecodeError, TypeError):
            continue
    return cache


def _save_cache(cache: dict) -> None:
    df = pd.DataFrame([{"cache_key": k, "value": json.dumps(v)} for k, v in cache.items()])
    appstate_db.write_all(INSIGHT_CACHE_TABLE, df)


def _call_ai(prompt: str) -> dict | None:
    providers = llm.get_providers()
    if not providers:
        return None
    for provider in providers:
        try:
            turn = provider.generate_with_tools([{"role": "user", "content": prompt}], [], max_tokens=200)
        except Exception:
            continue
        content = (turn or {}).get("content")
        if not content:
            continue
        cleaned = content.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`")
            cleaned = cleaned[4:] if cleaned.lower().startswith("json") else cleaned
        try:
            return json.loads(cleaned.strip())
        except json.JSONDecodeError:
            continue
    return None


def summarize_team_size_fit(fit: dict) -> str | None:
    current = fit.get("current_bucket")
    if not current:
        return None

    scope = fit.get("type_of_project") or "project"
    if fit.get("coe"):
        scope += f" / {fit['coe']}"
    elif fit.get("proposition_coe"):
        scope += f" / {fit['proposition_coe']}"

    recommendation = fit.get("recommendation")
    target_key = "larger_bucket" if recommendation == "add_one" else "smaller_bucket" if recommendation == "remove_one" else None
    target = fit.get(target_key) if target_key else None
    alt_line = ""
    if target:
        action = "Adding" if recommendation == "add_one" else "Removing"
        alt_line = (
            f"{action} 1 {fit.get('suggested_role')} would make it a {target['headcount']}-person team -- "
            f"{target['clean']}/{target['total']} historically finished clean ({round((target.get('clean_rate') or 0) * 100)}%)."
        )

    if recommendation == "sufficient":
        verdict = f"KEEP the current {fit.get('current_headcount')}-person team -- no nearby size has a meaningfully better track record."
    elif recommendation == "add_one" and target:
        verdict = f"ADD 1 {fit.get('suggested_role')} to make it {target['headcount']} people."
    elif recommendation == "remove_one" and target:
        verdict = f"REMOVE 1 {fit.get('suggested_role')} to make it {target['headcount']} people."
    else:
        verdict = "No clear verdict yet."

    reason_counts: dict[str, int] = {}
    for p in current.get("risky_examples", []):
        for r in p.get("reasons", []):
            reason_counts[r] = reason_counts.get(r, 0) + 1
    reason_summary = ", ".join(f"{k} ({v}x)" for k, v in sorted(reason_counts.items(), key=lambda kv: -kv[1])) or "none recorded"

    fingerprint_basis = "|".join(
        [
            # v2 prefix: bumps the cache key so summaries generated under the
            # earlier prompt (which let the AI propose its own verdict and
            # ended up contradicting the real one -- e.g. saying "increase
            # the team" under a "sufficient" verdict) are never served stale.
            "v2", scope, str(fit.get("current_headcount")), str(current.get("clean")), str(current.get("total")),
            str(recommendation), str(fit.get("suggested_role")), reason_summary,
        ]
    )
    cache_key = f"team_size_fit::{_fingerprint(fingerprint_basis)}"
    cache = _load_cache()
    cached = cache.get(cache_key)
    if cached is not None:
        return cached.get("summary")

    prompt = _PROMPT.format(
        verdict=verdict,
        scope=scope,
        current_headcount=fit.get("current_headcount"),
        current_clean=current.get("clean", 0),
        current_total=current.get("total", 0),
        current_rate=round((current.get("clean_rate") or 0) * 100),
        alt_line=alt_line,
        risky_total=current.get("risky", 0),
        reason_summary=reason_summary,
    )
    ai_result = _call_ai(prompt)
    summary = (ai_result or {}).get("summary")
    cache[cache_key] = {"summary": summary}
    _save_cache(cache)
    return summary
