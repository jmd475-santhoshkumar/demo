from fastapi import APIRouter
from pydantic import BaseModel

from app.engines.coe_skill_engine import derive_skills_for_coes
from app.engines.role_mix_engine import analyze_team_size_fit, get_role_mix, list_coes, list_docx_categories, list_role_mix_templates
from app.services.team_size_insight_service import summarize_team_size_fit

router = APIRouter(prefix="/role-mix", tags=["role-mix"])


class TeamSizeFitRequest(BaseModel):
    project_code: str
    designations: list[str]

@router.get("/templates")
def templates() -> list[dict]:
    return list_role_mix_templates()

@router.get("/lookup")
def lookup(type_of_project: str, tech_coe: str | None = None) -> dict:
    return get_role_mix(type_of_project, tech_coe)

@router.get("/categories")
def categories() -> list[dict]:
    return list_docx_categories()

@router.get("/coes")
def coes() -> list[dict]:
    return list_coes()

@router.get("/coe-skills")
def coe_skills(coes: str) -> dict:
    coe_list = [c.strip() for c in coes.split(",") if c.strip()]
    return derive_skills_for_coes(coe_list)

@router.post("/team-size-fit")
def team_size_fit(req: TeamSizeFitRequest) -> dict:
    result = analyze_team_size_fit(req.project_code, req.designations)
    result["ai_summary"] = summarize_team_size_fit(result)
    return result
