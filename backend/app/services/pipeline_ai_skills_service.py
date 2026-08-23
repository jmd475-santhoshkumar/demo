"""AI-driven required-skills extraction for a real pipeline/demand row.

Different job from pipeline_skill_inference.py's fallback: that module only
kicks in when a row has NO real skillset text, and hands back a whole CoE's
entire real skill list (up to 15 skills) as a coarse stand-in. This module
runs for EVERY pipeline row, reads the row's full real context (client,
solution, resources requested, requested %, any real skillset/comments text),
and asks an LLM to pick out the specific real skills (from JMAN's own real
COE_Skills_Mapping.csv, not invented ones) that this particular project
actually needs -- a curated, project-specific list rather than a whole-CoE
dump, shown automatically wherever a resourcing role is viewed (Project
Information, Resource Allocation).

Same hard-verification discipline as semantic_match_service: the LLM may only
cite a skill that appears character-for-character in the real master list
handed to it. Any hallucinated skill/CoE pairing is silently dropped rather
than surfaced.
"""
import json
import re

import pandas as pd

from app.ai import llm
from app.ai.providers.base import QuotaExceededError
from app.core.adapter import get_adapter
from app.engines.pipeline_skill_inference import coe_skill_lists
from app.engines.resource_code_decoder import decode_resource_code
from app.services.recommendation_service import RowIndexOutOfRange

MAX_SKILLS_RETURNED = 12

SYSTEM_PROMPT = """You are a delivery-staffing skills planner for JMAN's Resource Management Group.
You will be given the real details of one pipeline deal/role and a master menu of JMAN's real
skills, grouped by Centre of Excellence (CoE). Your job: pick the specific skills this particular
project genuinely needs to be delivered -- a focused, project-specific shortlist, not a whole CoE's
entire skill list.

Hard rules:
- You may ONLY cite a skill that appears character-for-character in the master menu below, under
  the CoE you say it belongs to. Never invent, paraphrase, or rename a skill.
- Prefer skills from the CoE(s) implied by the deal's real solution/resources-requested/skillset
  text over an unrelated CoE.
- Pick only skills that are plausibly relevant to THIS deal, not everything its CoE offers. Aim for
  a tight, defensible shortlist (roughly 5-12 skills), not padding.
- If the deal's real text gives you genuinely nothing to go on, say so honestly rather than
  guessing -- do not stretch a weak signal to avoid an empty result.

Respond with ONLY a JSON object, no other text:
{"required_skills": [{"skill": "<exact skill text from the menu>", "coe": "<exact CoE name from the menu>", "rationale": "<one short sentence tying it to the deal's real details>"}], "primary_coe": "<the single CoE this deal is mostly about, or null>", "no_match_found": true|false}"""

_JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)

_cache: dict[int, tuple[tuple, dict]] = {}


def _parse_llm_response(content: str | None) -> dict:
    if not content:
        return {"required_skills": [], "primary_coe": None, "no_match_found": True}
    cleaned = _JSON_FENCE_RE.sub("", content.strip())
    try:
        parsed = json.loads(cleaned)
        return {
            "required_skills": parsed.get("required_skills") or [],
            "primary_coe": parsed.get("primary_coe") or None,
            "no_match_found": bool(parsed.get("no_match_found", False)),
        }
    except (json.JSONDecodeError, AttributeError):
        return {"required_skills": [], "primary_coe": None, "no_match_found": True}


def _verify_skill(claim: dict, skill_lists: dict[str, list[str]]) -> dict | None:
    skill = (claim.get("skill") or "").strip()
    coe = (claim.get("coe") or "").strip()
    if not skill or not coe:
        return None
    real_skills = skill_lists.get(coe)
    if not real_skills:
        return None
    for real_skill in real_skills:
        if real_skill.lower() == skill.lower():
            return {
                "skill": real_skill,
                "coe": coe,
                "rationale": (claim.get("rationale") or "").strip() or None,
            }
    return None


def _row_fingerprint(row: pd.Series) -> tuple:
    fields = ("solution", "resources_requested", "requested_pct", "skillset", "comments", "notes", "work_request")
    return tuple(str(row.get(f)) for f in fields)


def get_ai_required_skills_for_pipeline_row(row_index: int) -> dict:
    adapter = get_adapter()
    pipeline = adapter.get_pipeline_forecast()
    if row_index < 0 or row_index >= len(pipeline):
        raise RowIndexOutOfRange(row_index, len(pipeline) - 1)

    row = pipeline.iloc[row_index]
    fingerprint = _row_fingerprint(row)
    cached = _cache.get(row_index)
    if cached is not None and cached[0] == fingerprint:
        return cached[1]

    skill_lists = {coe: skills for coe, skills in coe_skill_lists().items() if coe != "_cross_functional"}
    skill_lists["Cross-Functional / Core Consulting Skills"] = coe_skill_lists().get("_cross_functional", [])
    if not any(skill_lists.values()):
        result = {"available": False, "reason": "No real CoE skill reference (COE_Skills_Mapping.csv) is loaded."}
        _cache[row_index] = (fingerprint, result)
        return result

    provider = llm.get_provider()
    if provider is None:
        result = {"available": False, "reason": "No AI provider configured."}
        _cache[row_index] = (fingerprint, result)
        return result

    designations = decode_resource_code(row.get("resources_requested"))
    detail_lines = [
        f"Client: {row.get('client')}" if pd.notna(row.get("client")) else None,
        f"Solution/proposition: {row.get('solution')}" if pd.notna(row.get("solution")) else None,
        f"Work request type: {row.get('work_request')}" if pd.notna(row.get("work_request")) else None,
        f"Resources requested (raw code): {row.get('resources_requested')}" if pd.notna(row.get("resources_requested")) else None,
        f"Resources requested (decoded designation(s)): {', '.join(designations)}" if designations else None,
        f"Requested allocation %: {row.get('requested_pct')}" if pd.notna(row.get("requested_pct")) else None,
        f"Real skillset text (if given): {row.get('skillset')}" if pd.notna(row.get("skillset")) else None,
        f"Comments: {row.get('comments')}" if pd.notna(row.get("comments")) else None,
        f"Notes: {row.get('notes')}" if pd.notna(row.get("notes")) else None,
        f"Deal name: {row.get('hubspot_link')}" if pd.notna(row.get("hubspot_link")) else None,
    ]
    detail_text = "\n".join(d for d in detail_lines if d)

    menu_lines = [f"{coe}: {', '.join(skills)}" for coe, skills in skill_lists.items() if skills]
    menu_text = "\n".join(menu_lines)

    user_message = f"Deal/role details:\n{detail_text}\n\nMaster skill menu (by CoE):\n{menu_text}"
    messages = [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user_message}]

    try:
        turn = provider.generate_with_tools(messages, [], temperature=0.0, max_tokens=1200)
    except QuotaExceededError:
        result = {"available": False, "reason": "AI quota exceeded -- try again later."}
        _cache[row_index] = (fingerprint, result)
        return result

    if turn is None:
        result = {"available": False, "reason": "AI provider call failed."}
        _cache[row_index] = (fingerprint, result)
        return result

    parsed = _parse_llm_response(turn.get("content"))
    verified = []
    seen = set()
    for claim in parsed["required_skills"]:
        v = _verify_skill(claim, skill_lists)
        if v is None:
            continue
        key = (v["coe"], v["skill"])
        if key in seen:
            continue
        seen.add(key)
        verified.append(v)
        if len(verified) >= MAX_SKILLS_RETURNED:
            break

    primary_coe = parsed.get("primary_coe")
    if primary_coe not in skill_lists:
        primary_coe = None

    result = {
        "available": True,
        "required_skills": verified,
        "primary_coe": primary_coe,
        "no_match_found": len(verified) == 0,
    }
    _cache[row_index] = (fingerprint, result)
    return result
