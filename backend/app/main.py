import logging
import os
import threading

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core import auth_config
from app.core.config import CORS_ORIGINS
from app.core.db import get_connection, table_counts
from app.core.safe_json import SafeJSONResponse
from app.routers import admin, allocations, auth, buddy, digest, employees, feedback, forecast, free_pool, governance, leave, pipeline, projects, recommendations, revenue, role_mix, wellbeing
from app.routers import health as health_monitor_router
from app.services import auth_service
from app.services.digest_service import build_digest
from app.services.email_service import render_digest_html, send_email
from app.services.devops_insights_service import fetch_open_devops_tickets_cached


logger = logging.getLogger("resourceiq.scheduler")
logger_warmup = logging.getLogger("resourceiq.warmup")
scheduler = BackgroundScheduler()


def _warmup_embedding_model() -> None:
    """Load the SentenceTransformer model and employee embeddings into this worker's RAM.

    Runs in a daemon thread on startup so uvicorn finishes binding immediately.
    By the time a user clicks the first recommendation row, the model is already
    warm in every worker — no 30-second wait on first request.

    The employee vectors are persisted in .embedding_cache/emb_*.npz so they are
    not re-encoded on restart — only the model weights are loaded into RAM (~5-15s).
    """
    try:
        from app.core.adapter import get_adapter
        from app.engines import experience_engine
        from app.engines.embedding_engine import build_employee_embedding_index
        from app.engines.employee_coe import get_employee_primary_coe_map
        logger_warmup.info("Warming up embedding model…")
        # get_skills() itself is the expensive step here (~15s cold -- it remaps
        # the real skills export's disconnected employee_id scheme onto real
        # employees), and it's a shared dependency of several other cold-start
        # costs below, so it's computed once and reused by all three warmups
        # rather than triggering that remap redundantly from each one.
        skills = get_adapter().get_skills()
        build_employee_embedding_index(skills)
        # These two were NOT previously warmed here -- confirmed as a real
        # ~30s combined cold-start tax on the Forecast page specifically
        # (get_new_project_forecast calls both up front), which combined with
        # the embedding index's own ~40s cold build was enough to blow past
        # the Next dev proxy's timeout (ECONNRESET) on this worker's very
        # first forecast request after every restart -- exactly the same
        # "expensive first computation" race already solved here for
        # embeddings, just not yet extended to these two.
        get_employee_primary_coe_map()
        experience_engine.build_employee_experience_profiles()
        logger_warmup.info("Embedding model warm — worker ready for semantic matching.")
    except Exception:
        logger_warmup.warning("Embedding warmup failed (non-fatal — word-token matching still works).", exc_info=True)


def _warmup_devops_cache() -> None:
    """Pre-fetch the full Azure DevOps ticket board on startup so the first
    /health-monitor/projects request doesn't pay the ~30-50s fetch cost.
    Runs in a daemon thread; no-op (returns empty list fast) if
    AZURE_DEVOPS_PAT isn't configured.
    """
    try:
        logger_warmup.info("Warming up DevOps ticket cache…")
        tickets = fetch_open_devops_tickets_cached()
        logger_warmup.info(f"DevOps ticket cache warm — {len(tickets)} tickets loaded.")
    except Exception:
        logger_warmup.warning("DevOps cache warmup failed (non-fatal — health report will fetch on first request).", exc_info=True)

def _send_scheduled_digest(period_label: str) -> None:
    recipient = os.environ.get("DIGEST_RECIPIENT_EMAIL", "")
    if not recipient:
        logger.warning("Skipping scheduled digest -- DIGEST_RECIPIENT_EMAIL not set.")
        return
    try:
        digest = build_digest()
        html = render_digest_html(digest, period_label)
        send_email(recipient, f"ResourceIQ Digest — {period_label}", html)
    except Exception:
        logger.exception("Scheduled digest send failed")

app = FastAPI(
    title="ResourceIQ API",
    description="JMAN resourcing co-pilot -- backend for the 5 use-case engines.",
    version="0.1.0",
    default_response_class=SafeJSONResponse,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# No-ops entirely until Microsoft SSO creds are set (auth_service.is_sso_configured()
# is False) -- so this changes nothing about today's app. Once configured, every
# request needs a valid session cookie except the paths below (health check,
# the auth flow itself, and the API docs).
_PUBLIC_PATH_PREFIXES = ("/health", "/auth", "/docs", "/redoc", "/openapi.json")


@app.middleware("http")
async def require_session(request: Request, call_next):
    # CORS preflight never carries cookies/credentials -- let CORSMiddleware
    # answer it, don't 401 it.
    if request.method == "OPTIONS":
        return await call_next(request)
    if auth_service.is_sso_configured() and not request.url.path.startswith(_PUBLIC_PATH_PREFIXES):
        claims = auth_service.decode_session_token(request.cookies.get(auth_config.SESSION_COOKIE_NAME))
        if not claims:
            return JSONResponse({"detail": "Not authenticated"}, status_code=401)
    return await call_next(request)

@app.on_event("startup")
def load_data() -> None:
    get_connection()
    # Warm up the embedding model in the background so the first recommendation
    # request is instant instead of waiting 30s for PyTorch to initialise.
    threading.Thread(target=_warmup_embedding_model, daemon=True).start()
    threading.Thread(target=_warmup_devops_cache, daemon=True).start()
    # Friday EOD: what's still unresolved before the weekend. Monday AM: what to
    # tackle first thing this week. Same digest content, different framing.
    scheduler.add_job(_send_scheduled_digest, "cron", day_of_week="fri", hour=18, minute=0, args=["this weekend"], id="friday_eod_digest")
    scheduler.add_job(_send_scheduled_digest, "cron", day_of_week="mon", hour=8, minute=0, args=["this week"], id="monday_am_digest")
    scheduler.start()

@app.on_event("shutdown")
def stop_scheduler() -> None:
    scheduler.shutdown(wait=False)

@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}

@app.get("/meta/tables")
def meta_tables() -> dict[str, int]:
    return table_counts()

app.include_router(auth.router)
app.include_router(role_mix.router)
app.include_router(allocations.router)
app.include_router(recommendations.router)
app.include_router(health_monitor_router.router)
app.include_router(forecast.router)
app.include_router(pipeline.router)
app.include_router(buddy.router)
app.include_router(free_pool.router)
app.include_router(revenue.router)
app.include_router(leave.router)
app.include_router(employees.router)
app.include_router(digest.router)
app.include_router(wellbeing.router)
app.include_router(projects.router)
app.include_router(admin.router)
app.include_router(feedback.router)
app.include_router(governance.router)
