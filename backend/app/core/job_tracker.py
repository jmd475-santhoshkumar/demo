"""In-memory job tracker for long-running uploads (dataset/Excel imports,
JDWH loads) -- lets an upload endpoint return immediately with a job_id while
the actual parsing/cleaning/Postgres-write work happens in a background
thread (see routers/admin.py's use of FastAPI's BackgroundTasks, which
dispatches a sync callable to a threadpool automatically), so one large
upload never blocks every other user's request on the single shared event
loop. Confirmed this was a real bug, not a theoretical one: the upload
endpoints previously called upload_dataset()/load_tables_from_*() directly
inside an async route handler with no threadpool offload -- a slow upload
would have frozen every other request against the single uvicorn worker for
its entire duration.

In-memory only -- matches this app's existing single-backend-instance
constraint (see DEPLOYMENT_PLAN.md); a multi-instance deploy would need a
shared store (e.g. a small Postgres table) instead. Jobs are kept for
JOB_RETENTION_SECONDS after completion so a slow frontend poll doesn't race
a completed-and-forgotten job, then swept lazily on the next get_job call.
"""
import threading
import time
import uuid

JOB_RETENTION_SECONDS = 600

# Measured directly against a real Postgres instance this session: an
# 8,000,000-row / ~196 MB CSV went from raw upload bytes to fully written in
# Postgres in 51.5s (~3.8 MB/s for the full parse+clean+COPY pipeline) --
# used as a rough per-byte "time remaining" estimate until a job's own
# progress checkpoints narrow it further.
ESTIMATED_BYTES_PER_SECOND = 3_800_000

_jobs: dict[str, dict] = {}
_lock = threading.Lock()


def create_job(kind: str, label: str, size_bytes: int | None = None) -> str:
    job_id = uuid.uuid4().hex
    now = time.time()
    estimated_seconds = round(size_bytes / ESTIMATED_BYTES_PER_SECOND, 1) if size_bytes else None
    with _lock:
        _jobs[job_id] = {
            "job_id": job_id, "kind": kind, "label": label,
            "status": "queued", "progress_pct": 0, "message": "Queued",
            "size_bytes": size_bytes, "estimated_seconds": estimated_seconds,
            "created_at": now, "updated_at": now, "started_at": None,
            "result": None, "error": None,
        }
    return job_id


def update_job(job_id: str, *, status: str | None = None, progress_pct: int | None = None, message: str | None = None) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            return
        if status is not None:
            job["status"] = status
            if status == "processing" and job["started_at"] is None:
                job["started_at"] = time.time()
        if progress_pct is not None:
            job["progress_pct"] = progress_pct
        if message is not None:
            job["message"] = message
        job["updated_at"] = time.time()


def complete_job(job_id: str, result: dict) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            return
        job["status"] = "done"
        job["progress_pct"] = 100
        job["message"] = "Done"
        job["result"] = result
        job["updated_at"] = time.time()


def fail_job(job_id: str, error: str) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            return
        job["status"] = "error"
        job["error"] = error
        job["message"] = error
        job["updated_at"] = time.time()


def _remaining_seconds(job: dict) -> float | None:
    if job["status"] in ("done", "error") or not job["estimated_seconds"] or not job["started_at"]:
        return None
    elapsed = time.time() - job["started_at"]
    # Blend the byte-size estimate with the job's own reported progress once
    # it has any -- a coarse checkpoint (e.g. "60% through cleaning") is a
    # better signal than the flat size-based guess alone.
    pct = max(job["progress_pct"], 1)
    projected_total = elapsed / (pct / 100)
    return max(round(projected_total - elapsed, 1), 0)


def get_job(job_id: str) -> dict | None:
    _sweep()
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            return None
        out = dict(job)
    out["remaining_seconds"] = _remaining_seconds(out)
    return out


def _sweep() -> None:
    cutoff = time.time() - JOB_RETENTION_SECONDS
    with _lock:
        stale = [jid for jid, j in _jobs.items() if j["status"] in ("done", "error") and j["updated_at"] < cutoff]
        for jid in stale:
            del _jobs[jid]
