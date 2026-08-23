from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

from app.core import job_tracker
from app.services import s3_upload_service
from app.services.admin_data_service import (
    DATASET_REGISTRY,
    DatasetValidationError,
    get_connection_status,
    get_dataset_preview,
    get_dataset_schema,
    list_data_sources,
    save_connection,
    test_connection,
    upload_dataset,
)
from app.services.jdwh_connection_service import (
    JdwhConnectionError,
    connect_and_discover_tables,
    get_expected_tables,
    get_jdwh_connection,
    list_jdwh_backups,
    pull_and_load_tables,
    revert_to_backup,
    save_jdwh_connection,
)
from app.services.jdwh_upload_service import (
    JdwhUploadError,
    load_tables_from_files,
    load_tables_from_workbook,
    preview_file,
    preview_workbook,
)

router = APIRouter(prefix="/admin", tags=["admin"])


class ConnectionConfigRequest(BaseModel):
    mode: str
    base_url: str | None = None
    api_key: str | None = None


class JdwhConnectionConfigRequest(BaseModel):
    profile_name: str | None = None
    server: str
    port: int = 1433
    database: str
    auth_type: str
    account: str | None = None
    encrypt: str = "Mandatory"
    trust_server_certificate: bool = False


class JdwhRevertRequest(BaseModel):
    timestamp: str | None = None


class JdwhConnectRequest(JdwhConnectionConfigRequest):
    # SQL Login only -- never persisted, only used for this one connection
    # attempt (see jdwh_connection_service.build_connection_string).
    password: str | None = None


class PresignUploadRequest(BaseModel):
    kind: str
    filename: str
    content_type: str | None = None
    file_size_bytes: int | None = None


class ConfirmUploadRequest(BaseModel):
    kind: str
    s3_key: str
    filename: str


@router.get("/data-sources")
def data_sources() -> list[dict]:
    return list_data_sources()


@router.get("/connection-status")
def connection_status() -> dict:
    return get_connection_status()


@router.post("/connection")
def save_connection_endpoint(req: ConnectionConfigRequest) -> dict:
    try:
        return save_connection(req.mode, req.base_url, req.api_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/connection/test")
def test_connection_endpoint() -> dict:
    return test_connection()


@router.get("/jdwh/connection")
def jdwh_connection() -> dict:
    return get_jdwh_connection()


@router.get("/jdwh/expected-tables")
def jdwh_expected_tables() -> dict:
    """The 6 provisioned tables and their real columns, straight from the
    data-warehouse team's own schema export -- structural metadata only,
    shown before (or without ever) connecting."""
    return {"tables": get_expected_tables()}


@router.post("/jdwh/connection")
def jdwh_save_connection(req: JdwhConnectionConfigRequest) -> dict:
    try:
        return save_jdwh_connection(req.model_dump())
    except JdwhConnectionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/jdwh/connect")
def jdwh_connect(req: JdwhConnectRequest) -> dict:
    """Opens the real connection (the Resource Manager's own Microsoft sign-in
    handles Entra ID/MFA) and confirms the 6 provisioned tables' real columns
    via INFORMATION_SCHEMA only -- never a row of real data."""
    payload = req.model_dump()
    password = payload.pop("password", None)
    try:
        return connect_and_discover_tables(payload, password=password)
    except JdwhConnectionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/jdwh/load-tables")
def jdwh_load_tables(req: JdwhConnectRequest) -> dict:
    """The real, consequential action: pulls the 5 real tables this app's
    data model uses, column-maps them (see jdwh_table_mapping.py), backs up
    the current local CSVs, and replaces them -- this changes what every
    page in the app reads from. The Settings UI gates this behind an
    explicit confirmation separate from Connect."""
    payload = req.model_dump()
    password = payload.pop("password", None)
    try:
        return pull_and_load_tables(payload, password=password)
    except JdwhConnectionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/jdwh/backups")
def jdwh_backups() -> dict:
    return {"backups": list_jdwh_backups()}


@router.post("/jdwh/revert")
def jdwh_revert(req: JdwhRevertRequest) -> dict:
    """Undoes a Load Tables action -- restores the local CSVs from the given
    backup (or the most recent one) and reloads."""
    try:
        return revert_to_backup(req.timestamp)
    except JdwhConnectionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/jdwh/preview-workbook")
async def jdwh_preview_workbook(file: UploadFile = File(...)) -> dict:
    """Real feedback that a file was actually read -- sheet names and row/
    column counts only, never a real cell value. Called automatically as
    soon as a file is picked, before the destructive Load step."""
    content = await file.read()
    try:
        return preview_workbook(content, file.filename or "")
    except JdwhUploadError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/jdwh/preview-file")
async def jdwh_preview_file(file: UploadFile = File(...)) -> dict:
    content = await file.read()
    try:
        return preview_file(content, file.filename or "")
    except JdwhUploadError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _process_upload_job(job_id: str, kind: str, filename: str, content: bytes) -> None:
    """Shared by every upload path (direct-to-backend and S3-relayed alike):
    runs the actual parse/clean/Postgres-write work and updates the job's
    status/progress as it goes. Always called from a background thread (see
    BackgroundTasks.add_task below, which Starlette dispatches a sync
    callable to a threadpool for) -- never inline in a route handler, so one
    large upload can't block every other request on the single event loop."""
    def on_progress(pct: int, message: str) -> None:
        job_tracker.update_job(job_id, progress_pct=pct, message=message)

    job_tracker.update_job(job_id, status="processing", progress_pct=1, message="Starting")
    try:
        if kind.startswith("dataset:"):
            key = kind.split(":", 1)[1]
            result = upload_dataset(key, filename, content, on_progress=on_progress)
        elif kind == "jdwh_workbook":
            result = load_tables_from_workbook(content, filename, on_progress=on_progress)
        else:
            raise ValueError(f"Unknown upload kind '{kind}'.")
        job_tracker.complete_job(job_id, result)
    except (DatasetValidationError, JdwhUploadError, ValueError) as exc:
        job_tracker.fail_job(job_id, str(exc))
    except Exception as exc:  # noqa: BLE001 -- surfaced to the polling UI, not swallowed
        job_tracker.fail_job(job_id, f"Unexpected error: {exc}")


def _validate_upload_kind(kind: str) -> None:
    if kind.startswith("dataset:"):
        key = kind.split(":", 1)[1]
        if key not in DATASET_REGISTRY:
            raise HTTPException(status_code=400, detail=f"Unknown dataset key '{key}'.")
    elif kind in ("jdwh_workbook",):
        return
    else:
        raise HTTPException(status_code=400, detail=f"Unknown upload kind '{kind}'.")


@router.post("/jdwh/upload-workbook")
async def jdwh_upload_workbook(background_tasks: BackgroundTasks, file: UploadFile = File(...)) -> dict:
    """No live connection needed (e.g. no JMAN VPN available right now) --
    one uploaded workbook with all 6 tables as separate sheets, real data
    already exported (see jdwh_upload_service.py's module docstring for the
    expected sheet names/shape). Runs in the background (see
    _process_upload_job) -- returns a job_id immediately; poll GET
    /admin/jobs/{job_id} for progress/result."""
    content = await file.read()
    filename = file.filename or ""
    job_id = job_tracker.create_job(kind="jdwh_workbook", label=filename, size_bytes=len(content))
    background_tasks.add_task(_process_upload_job, job_id, "jdwh_workbook", filename, content)
    return {"job_id": job_id}


@router.post("/jdwh/upload-files")
async def jdwh_upload_files(
    background_tasks: BackgroundTasks,
    employee: UploadFile = File(...),
    project: UploadFile = File(...),
    project_allocation: UploadFile = File(...),
    timesheet: UploadFile = File(...),
    weekly_status_report: UploadFile = File(...),
    designation_history: UploadFile | None = File(None),
    project_rolebased_user: UploadFile | None = File(None),
) -> dict:
    """Same as /jdwh/upload-workbook, but 6 (or 7) separate files instead of
    one workbook -- designation_history is accepted for consistency with the
    rest of the JDWH UI but genuinely unused (see jdwh_table_mapping.py).
    project_rolebased_user is optional and, when provided, is combined with
    project_allocation's own rows (see map_rolebased_user_table). Not
    S3-relayed (unlike the single-file paths above) -- coordinating 6
    separate presigned uploads isn't worth the complexity when this shape is
    typically used for smaller per-table exports; runs in the background all
    the same so it doesn't block other requests."""
    uploads = {
        "employee": employee, "project": project, "project_allocation": project_allocation,
        "timesheet": timesheet, "weekly_status_report": weekly_status_report,
    }
    if designation_history is not None:
        uploads["designation_history"] = designation_history
    if project_rolebased_user is not None:
        uploads["project_rolebased_user"] = project_rolebased_user

    files: dict[str, tuple[bytes, str]] = {}
    for table, upload in uploads.items():
        files[table] = (await upload.read(), upload.filename or "")

    total_bytes = sum(len(content) for content, _ in files.values())
    job_id = job_tracker.create_job(kind="jdwh_files", label="JDWH files upload", size_bytes=total_bytes)

    def run() -> None:
        def on_progress(pct: int, message: str) -> None:
            job_tracker.update_job(job_id, progress_pct=pct, message=message)

        job_tracker.update_job(job_id, status="processing", progress_pct=1, message="Starting")
        try:
            result = load_tables_from_files(files, on_progress=on_progress)
            job_tracker.complete_job(job_id, result)
        except JdwhUploadError as exc:
            job_tracker.fail_job(job_id, str(exc))
        except Exception as exc:  # noqa: BLE001
            job_tracker.fail_job(job_id, f"Unexpected error: {exc}")

    background_tasks.add_task(run)
    return {"job_id": job_id}


@router.get("/data-sources/{key}/preview")
def preview(key: str, rows: int = Query(default=20, ge=1, le=5000)) -> dict:
    try:
        return get_dataset_preview(key, max_rows=rows)
    except DatasetValidationError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/data-sources/{key}/schema")
def schema(key: str) -> dict:
    try:
        return get_dataset_schema(key)
    except DatasetValidationError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/data-sources/{key}/upload")
async def upload(key: str, background_tasks: BackgroundTasks, file: UploadFile = File(...)) -> dict:
    """Direct-to-backend upload -- fine for smaller files, or when S3 isn't
    configured (see /s3/presign-upload for the large-file path). Runs in the
    background; returns a job_id immediately instead of waiting for
    parse/clean/write to finish."""
    content = await file.read()
    filename = file.filename or ""
    kind = f"dataset:{key}"
    _validate_upload_kind(kind)
    job_id = job_tracker.create_job(kind=kind, label=filename, size_bytes=len(content))
    background_tasks.add_task(_process_upload_job, job_id, kind, filename, content)
    return {"job_id": job_id}


@router.get("/jobs/{job_id}")
def get_job_status(job_id: str) -> dict:
    """Poll target for every upload path above -- status/progress_pct/message/
    remaining_seconds while running, result once done, error if it failed."""
    job = job_tracker.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found (it may have expired).")
    return job


@router.post("/s3/presign-upload")
def s3_presign_upload(req: PresignUploadRequest) -> dict:
    """Step 1 of the large-file path: the browser gets a short-lived,
    scoped-to-one-object presigned PUT URL and uploads the raw bytes DIRECTLY
    to S3 -- this backend/its ALB never sees that traffic at all, which is
    the whole point for a real multi-hundred-MB export (the transfer itself,
    bounded by the uploader's own bandwidth, is usually the slowest part of
    the whole operation)."""
    if not s3_upload_service.is_configured():
        raise HTTPException(status_code=503, detail="S3 upload isn't configured on this server -- use the direct upload instead.")
    if req.file_size_bytes and req.file_size_bytes > s3_upload_service.MAX_UPLOAD_BYTES:
        limit_mb = s3_upload_service.MAX_UPLOAD_BYTES // (1024 * 1024)
        raise HTTPException(status_code=413, detail=f"File exceeds the {limit_mb} MB limit.")
    _validate_upload_kind(req.kind)
    s3_key = s3_upload_service.new_upload_key(req.kind.replace(":", "-"), req.filename)
    upload_url = s3_upload_service.presign_put(s3_key, req.content_type)
    return {"s3_key": s3_key, "upload_url": upload_url}


@router.post("/s3/confirm-upload")
def s3_confirm_upload(req: ConfirmUploadRequest, background_tasks: BackgroundTasks) -> dict:
    """Step 2: the browser calls this once its direct-to-S3 PUT finishes.
    Confirms the object actually landed (head_object -- never trusts the
    browser's own "it worked" claim), then processes it in the background
    exactly like a direct upload would, deleting the S3 object once read (S3
    here is a transient relay, not storage -- see s3_upload_service's module
    docstring)."""
    _validate_upload_kind(req.kind)
    meta = s3_upload_service.head_object(req.s3_key)
    if meta is None:
        raise HTTPException(status_code=400, detail="Uploaded file not found in storage -- please retry.")
    size_bytes = meta.get("ContentLength")
    job_id = job_tracker.create_job(kind=req.kind, label=req.filename, size_bytes=size_bytes)

    def run() -> None:
        job_tracker.update_job(job_id, status="processing", progress_pct=1, message="Downloading from storage")
        content = s3_upload_service.get_object_bytes(req.s3_key)
        if content is None:
            job_tracker.fail_job(job_id, "Could not read the uploaded file from storage -- please retry.")
            return
        try:
            _process_upload_job(job_id, req.kind, req.filename, content)
        finally:
            s3_upload_service.delete_object(req.s3_key)

    background_tasks.add_task(run)
    return {"job_id": job_id}
