"""Resume-upload skill + competency enrichment.

When an employee's skill/competency record is thin (or an RM just wants to
enrich it), this lets someone upload that employee's real resume (PDF or
Word) and uses this app's own LLM provider chain (app/ai/llm.py -- same
Azure OpenAI/Gemini/Claude failover Buddy uses) to extract real skills AND
real competency evidence from it -- never scraped from LinkedIn/Google (a
real ToS and privacy problem for a tool meant to run on real employees),
only from a document the user actually provides.

Deliberately does NOT touch HR feedback (11_HR_Feedback_dummy.csv). That
table is structurally third-party: a specific real reviewer_employee_id
(a manager/EM/PM) giving their own opinion about one specific real
project_id. A resume is self-authored -- it can never genuinely contain
"what someone else said about this person on project X". Extracting
"feedback" from a resume would mean inventing a review, a rating, and a
reviewer that never existed, which is a materially different (and worse)
kind of fabrication than a resume-derived skill or competency. Skills and
competency are properties a resume can legitimately speak to; feedback is
not.

Every row added this way is tagged with a "resume_extracted" source --
scoring.py's existing observed-vs-not discount already treats anything
other than "observed" as lower-confidence, so a resume-derived record is
automatically weighted below a real project-verified one, consistent with
every other inferred source in this app.
"""
import io
import json
import uuid
from datetime import datetime

import pandas as pd

from app.ai import llm
from app.core import appstate_db, db, dataset_store
from app.core.adapter import LocalAdapter
from app.services import s3_upload_service

RESUME_UPLOADS_DIR_NAME = "resumes"  # local read-through cache dir name, under app state (see S3 note below)

# One record per successful upload (resume or LinkedIn-exported PDF) -- lets
# the UI show "you already imported this employee's document, here's what it
# added" instead of re-extracting blind on every click, and lets the raw file
# be re-served for an in-browser preview. Stored in Postgres (appstate_db),
# keyed by employee_id; added_skills/added_competencies are JSON-encoded
# since appstate_db's tables are flat string columns.
IMPORT_INDEX_TABLE = "document_imports"
_IMPORT_FIELDS = [
    "import_id", "employee_id", "channel", "filename", "stored_filename", "uploaded_at", "summary",
    "extracted_skill_count", "added_skills", "skipped_existing_skill_count",
    "extracted_competency_count", "added_competencies", "skipped_existing_competency_count",
]

# Raw resume/LinkedIn-PDF file bytes: S3 is the durable store (same pattern
# as project_sow_service.py -- see that module's docstring for why local
# disk alone would silently lose every upload on an ECS Fargate task
# restart), local disk is a read-through cache only.
from app.core.config import APP_STATE_DIR  # noqa: E402 -- kept local to the one place that still needs a Path

RESUME_UPLOADS_DIR = APP_STATE_DIR / RESUME_UPLOADS_DIR_NAME

# Keeps the LLM prompt bounded -- a real resume is a handful of pages at most;
# this is a safety cap, not a real-world limit anyone should hit.
MAX_RESUME_CHARS = 15000

# A skill someone lists on their own resume reflects real hands-on
# experience, not just passing familiarity -- 4/5 before the skill_source
# discount below (not 5/5, since it's still self-reported and unverified).
RESUME_SKILL_SCORE = 4

_CANONICAL_COES = ("Data Engineering", "AI & ML", "Full Stack Engineering", "TechOps & Automation", "BI & Reporting")

CONTENT_TYPES = {"pdf": "application/pdf", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}


class ResumeProcessingError(Exception):
    pass


def _resume_s3_key(employee_id: str, stored_filename: str) -> str:
    return s3_upload_service.permanent_key("resumes", employee_id, stored_filename)


def _json_or(value: str, default):
    try:
        return json.loads(value) if value else default
    except (TypeError, json.JSONDecodeError):
        return default


def list_document_imports(employee_id: str) -> list[dict]:
    """Every past successful resume/LinkedIn-PDF import for this employee,
    most recent first -- backs the "you already imported this" panel."""
    df = appstate_db.read_all(IMPORT_INDEX_TABLE, _IMPORT_FIELDS)
    if df.empty:
        return []
    rows = df[df["employee_id"] == employee_id].to_dict("records")
    for r in rows:
        r["added_skills"] = _json_or(r.get("added_skills", ""), [])
        r["added_competencies"] = _json_or(r.get("added_competencies", ""), [])
        for k in ("extracted_skill_count", "skipped_existing_skill_count", "extracted_competency_count", "skipped_existing_competency_count"):
            r[k] = int(r[k]) if r.get(k) not in (None, "") else 0
    rows.sort(key=lambda r: r["uploaded_at"], reverse=True)
    return rows


def get_document_import_file(employee_id: str, import_id: str) -> tuple[bytes, str, str]:
    """Raw bytes + filename + content-type for one past import, for an
    in-browser preview (PDF) or download (Word)."""
    df = appstate_db.read_all(IMPORT_INDEX_TABLE, _IMPORT_FIELDS)
    match = df[(df["employee_id"] == employee_id) & (df["import_id"] == import_id)] if not df.empty else df
    if match.empty:
        raise ResumeProcessingError("No such import on record for this employee.")
    record = match.iloc[-1]
    stored_filename = record["stored_filename"]
    filename = record["filename"]

    path = RESUME_UPLOADS_DIR / employee_id / stored_filename
    if not path.exists():
        # Not in this process's local cache (e.g. a fresh container after a
        # restart/redeploy) -- fetch the durable copy from S3.
        content = s3_upload_service.get_object_bytes(_resume_s3_key(employee_id, stored_filename)) if s3_upload_service.is_configured() else None
        if content is None:
            raise ResumeProcessingError("The original file is no longer available.")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)

    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return path.read_bytes(), filename, CONTENT_TYPES.get(ext, "application/octet-stream")


def _extract_text(filename: str, content: bytes) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext == "pdf":
        from pypdf import PdfReader
        try:
            reader = PdfReader(io.BytesIO(content))
        except Exception as exc:
            raise ResumeProcessingError(f"Could not read this PDF: {exc}") from exc
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    elif ext == "docx":
        import docx
        try:
            doc = docx.Document(io.BytesIO(content))
        except Exception as exc:
            raise ResumeProcessingError(f"Could not read this Word document: {exc}") from exc
        text = "\n".join(p.text for p in doc.paragraphs)
    else:
        raise ResumeProcessingError(f"Unsupported file type '.{ext}' -- upload a PDF or Word (.docx) resume.")

    text = text.strip()
    if not text:
        raise ResumeProcessingError(
            "Could not extract any real text from this file -- it may be a scanned image without a real text layer."
        )
    return text[:MAX_RESUME_CHARS]


def _real_competency_questions() -> list[str]:
    """The org's own real, curated behavioral-competency statements (excludes
    the "Tenure-based capability proxy" synthetic-proxy row, which isn't a
    real evaluated dimension) -- read live from the real competency table so
    this always reflects whatever the org's actual framework currently is,
    never a hardcoded copy that could drift from it."""
    df = dataset_store.read_table("competencies")
    real = df[df["competency_source"] == "observed"]
    return sorted(real["competency_question"].dropna().unique().tolist())


def _build_extraction_prompt(resume_text: str, competency_questions: list[str]) -> str:
    numbered_questions = "\n".join(f"{i + 1}. {q}" for i, q in enumerate(competency_questions))
    return f"""You are extracting real, evidence-based information from a real employee's resume for an internal staffing tool.

PART 1 -- SKILLS
Extract ONLY skills, tools, technologies, platforms, and professional competencies that are ACTUALLY mentioned in the
resume text -- never invent or infer a skill that isn't genuinely present. For each, if it clearly belongs to one of
these Centers of Excellence, tag it; otherwise use null: Data Engineering, AI & ML, Full Stack Engineering, TechOps & Automation, BI & Reporting

PART 2 -- COMPETENCY EVIDENCE
Below is the org's real, fixed list of behavioral competency statements. For EACH one, decide if the resume text
provides genuine, specific evidence supporting it (e.g. a described project, responsibility, or outcome that clearly
demonstrates it) -- not a vague guess. Only include a competency in your answer if the evidence is real and specific;
if the resume says nothing that speaks to a statement, leave it out entirely (do not force-fit every statement).
Score 1-5 based on how strong and specific the evidence is (1 = weak/indirect mention, 5 = strong, explicit, repeated evidence).

Competency statements (use the EXACT text below, do not paraphrase):
{numbered_questions}

Respond with ONLY a JSON object, no other text, no markdown fences:
{{
  "skills": [{{"skill": "<exact skill name, title case>", "coe": "<one of the 5 CoE names above, or null>"}}],
  "competencies": [{{"question": "<EXACT statement text from the list above>", "score": <1-5>, "evidence": "<one short phrase from the resume that supports this>"}}],
  "summary": "<1-2 sentence real professional summary based only on the resume text>"
}}

Resume text:
---
{resume_text}
---
"""


def _call_llm_for_extraction(resume_text: str, competency_questions: list[str]) -> dict:
    providers = llm.get_providers()
    if not providers:
        raise ResumeProcessingError(
            "No AI provider is configured -- set GEMINI_API_KEY, ANTHROPIC_API_KEY, or the Azure OpenAI vars in the backend .env file."
        )

    prompt = _build_extraction_prompt(resume_text, competency_questions)
    messages = [{"role": "user", "content": prompt}]

    for provider in providers:
        try:
            turn = provider.generate_with_tools(messages, [], max_tokens=2000)
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
            parsed = json.loads(cleaned.strip())
        except json.JSONDecodeError:
            continue
        if isinstance(parsed.get("skills"), list):
            return parsed

    raise ResumeProcessingError("The AI could not extract a valid result from this resume -- try a different file.")


def _append_skills(employee_id: str, emp: pd.Series, raw_skills: list[dict], source_label: str) -> list[str]:
    existing = dataset_store.read_table("skills")
    existing_lower = set(
        existing.loc[existing["employee_id"] == employee_id, "skill"].astype(str).str.strip().str.lower()
    )

    new_rows = []
    added = []
    for s in raw_skills:
        skill_name = str(s["skill"]).strip()
        if not skill_name or skill_name.lower() in existing_lower:
            continue
        coe = s.get("coe") if s.get("coe") in _CANONICAL_COES else None
        new_rows.append({
            "employee_id": employee_id,
            "designation": emp.get("job_name"),
            "coe": coe or emp.get("department_name"),
            "coe_skill": coe or "Resume",
            "skill": skill_name,
            "subskill": skill_name,
            "experience": None,
            "score": RESUME_SKILL_SCORE,
            "skill_source": source_label,
        })
        added.append(skill_name)
        existing_lower.add(skill_name.lower())

    if new_rows:
        dataset_store.replace_table("skills", pd.concat([existing, pd.DataFrame(new_rows)], ignore_index=True))
    return added


def _append_competencies(employee_id: str, emp: pd.Series, raw_competencies: list[dict], real_questions: set[str], source_label: str) -> list[str]:
    existing = dataset_store.read_table("competencies")
    existing_questions = set(
        existing.loc[existing["employee_id"] == employee_id, "competency_question"].astype(str).str.strip()
    )

    new_rows = []
    added = []
    for c in raw_competencies:
        question = str(c.get("question") or "").strip()
        # Only ever a question that's genuinely in the org's real fixed list
        # -- guards against the model paraphrasing or inventing a new one.
        if not question or question not in real_questions or question in existing_questions:
            continue
        try:
            score = max(1, min(5, int(round(float(c.get("score", 0))))))
        except (TypeError, ValueError):
            continue
        new_rows.append({
            "employee_id": employee_id,
            "designation": emp.get("job_name"),
            "coe_dep": emp.get("department_name"),
            "competency_sheet": emp.get("job_name"),
            "competency_question": question,
            "response": "Yes",
            "score": score,
            "competency_source": source_label,
        })
        added.append(question)
        existing_questions.add(question)

    if new_rows:
        dataset_store.replace_table("competencies", pd.concat([existing, pd.DataFrame(new_rows)], ignore_index=True))
    return added


def process_resume(employee_id: str, filename: str, content: bytes, channel: str = "resume") -> dict:
    channel = channel if channel in ("resume", "linkedin") else "resume"
    source_label = f"{channel}_extracted"

    employees = LocalAdapter().get_employees()
    match = employees[employees["employee_id"] == employee_id]
    if match.empty:
        raise ResumeProcessingError(f"No real employee found with id '{employee_id}'.")
    emp = match.iloc[0]

    resume_text = _extract_text(filename, content)
    competency_questions = _real_competency_questions()
    result = _call_llm_for_extraction(resume_text, competency_questions)

    raw_skills = [s for s in result.get("skills", []) if isinstance(s, dict) and str(s.get("skill") or "").strip()]
    raw_competencies = [c for c in result.get("competencies", []) if isinstance(c, dict)]
    if not raw_skills and not raw_competencies:
        raise ResumeProcessingError("No real skills or competency evidence could be extracted from this resume.")

    import_id = uuid.uuid4().hex
    stored_filename = f"{import_id}_{filename}"

    # Always keep a local copy too -- doubles as this process's read cache
    # for get_document_import_file without needing extra round trips.
    emp_dir = RESUME_UPLOADS_DIR / employee_id
    emp_dir.mkdir(parents=True, exist_ok=True)
    (emp_dir / stored_filename).write_bytes(content)
    if s3_upload_service.is_configured():
        s3_upload_service.put_object(_resume_s3_key(employee_id, stored_filename), content)

    added_skills = _append_skills(employee_id, emp, raw_skills, source_label)
    added_competencies = _append_competencies(employee_id, emp, raw_competencies, set(competency_questions), source_label)

    if added_skills or added_competencies:
        db.reload()

    record = {
        "import_id": import_id,
        "employee_id": employee_id,
        "channel": channel,
        "filename": filename,
        "stored_filename": stored_filename,
        "uploaded_at": datetime.now().isoformat(),
        "summary": result.get("summary") or "",
        "extracted_skill_count": len(raw_skills),
        "added_skills": json.dumps(added_skills),
        "skipped_existing_skill_count": len(raw_skills) - len(added_skills),
        "extracted_competency_count": len(raw_competencies),
        "added_competencies": json.dumps(added_competencies),
        "skipped_existing_competency_count": len(raw_competencies) - len(added_competencies),
    }
    df = appstate_db.read_all(IMPORT_INDEX_TABLE, _IMPORT_FIELDS)
    df = pd.concat([df, pd.DataFrame([{k: str(v) for k, v in record.items()}])], ignore_index=True)
    appstate_db.write_all(IMPORT_INDEX_TABLE, df)

    return {**record, "added_skills": added_skills, "added_competencies": added_competencies}
