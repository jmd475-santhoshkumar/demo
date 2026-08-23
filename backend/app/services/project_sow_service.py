"""SOW file storage: S3 is the durable source of truth (see
s3_upload_service.py's PERMANENT_KEY_PREFIX), local disk is only ever a
read-through cache. Fixes a real gap -- ECS Fargate's task filesystem is
ephemeral, so a SOW saved to local disk alone would be silently lost on the
next deploy/restart. Every existing consumer of get_sow_file_path()
(LibreOffice PDF conversion, text extraction, SOW chat, direct download) is
unaffected: it still returns a real local Path, just backed by an
S3-materialize-on-demand cache instead of assuming the file was written to
this same disk at upload time.

Falls back to local-disk-only storage when S3 isn't configured (AWS_*
env vars unset) -- fine for local dev, not for anything that needs to
survive a container restart.
"""
from pathlib import Path

import pandas as pd

from app.core import appstate_db
from app.core.config import APP_STATE_DIR
from app.services import s3_upload_service

SOW_UPLOADS_DIR = APP_STATE_DIR / "sow_uploads"
SOW_METADATA_TABLE = "project_sow"
_METADATA_FIELDS = ["project_code", "filename", "size_bytes", "uploaded_at"]


def _s3_key(project_code: str, filename: str) -> str:
    return s3_upload_service.permanent_key("sow", project_code, filename)


def save_sow_file(project_code: str, filename: str, content: bytes) -> dict:
    # Always keep a local copy too -- doubles as this process's read cache
    # for get_sow_file_path's consumers without needing to touch any of them.
    project_dir = SOW_UPLOADS_DIR / project_code
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / filename).write_bytes(content)

    if s3_upload_service.is_configured():
        s3_upload_service.put_object(_s3_key(project_code, filename), content)

    uploaded_at = pd.Timestamp.now().isoformat()
    row = {"project_code": project_code, "filename": filename, "size_bytes": str(len(content)), "uploaded_at": uploaded_at}
    df = appstate_db.read_all(SOW_METADATA_TABLE, _METADATA_FIELDS)
    if not df.empty:
        df = df[~((df["project_code"] == project_code) & (df["filename"] == filename))]
    df = pd.concat([df, pd.DataFrame([row])], ignore_index=True)
    appstate_db.write_all(SOW_METADATA_TABLE, df)
    return {"project_code": project_code, "filename": filename, "size_bytes": len(content), "uploaded_at": uploaded_at}


def list_sow_files(project_code: str) -> list[dict]:
    df = appstate_db.read_all(SOW_METADATA_TABLE, _METADATA_FIELDS)
    if df.empty:
        return []
    rows = df[df["project_code"] == project_code].sort_values("uploaded_at", ascending=False)
    return [
        {"filename": r["filename"], "size_bytes": int(r["size_bytes"]), "uploaded_at": r["uploaded_at"]}
        for _, r in rows.iterrows()
    ]


def get_sow_file_path(project_code: str, filename: str) -> Path | None:
    path = SOW_UPLOADS_DIR / project_code / filename
    if path.exists():
        return path
    # Not in this process's local cache (e.g. a fresh container after a
    # restart/redeploy) -- fetch the durable copy from S3 and materialize it
    # locally once, so every consumer keeps working against a real file path.
    if s3_upload_service.is_configured():
        content = s3_upload_service.get_object_bytes(_s3_key(project_code, filename))
        if content is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
            return path
    return None
