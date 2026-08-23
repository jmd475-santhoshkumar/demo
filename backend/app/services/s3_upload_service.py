"""S3 for this app's file storage -- two distinct usage patterns, both
against the same private bucket (Block Public Access on):

1. A TRANSIENT RELAY for large browser uploads (dataset/Excel/JDWH files) --
   the browser uploads directly to S3 via a short-lived presigned URL (never
   touching this backend for the actual bytes), the backend pulls the object
   into memory and feeds it through the exact same
   admin_data_service.upload_dataset()/jdwh_upload_service.load_tables_from_*()
   paths a direct upload would have used, and deletes the S3 object once it's
   been read (see UPLOAD_KEY_PREFIX below). Same pattern as the autoeda
   sibling project's app/s3_attachments.py -- ported deliberately, not
   reinvented.
2. PERMANENT storage for files this app owns for good (SOW documents --
   see project_sow_service.py) -- uploaded straight through the backend
   (these are small enough that a presigned relay isn't worth the extra
   round trip) via put_object, read back via get_object_bytes, and never
   auto-deleted (see PERMANENT_KEY_PREFIX below). This is what actually
   fixes SOW files being lost on every ECS Fargate task restart -- local
   disk there is ephemeral, S3 isn't.

Why S3 over a direct browser -> backend upload for the big transient-relay
files specifically: the byte transfer (which for a real multi-hundred-MB
file is usually the SLOWEST part of the whole operation, bounded by the
uploader's own bandwidth, not this app) happens entirely against S3's own
edge network instead of tying up this app's one backend instance/ALB
connection for that whole duration.

Bucket is expected to be fully PRIVATE (Block Public Access on) -- presigned
URLs grant temporary, scoped access without needing any public bucket
permission at all, and permanent objects are only ever read by this backend
via its own AWS credentials/role, never a public URL.
"""
import os
import uuid

import boto3
from botocore.client import Config as BotoConfig

PRESIGN_EXPIRES_IN = 3600
# S3 objects here are a transient relay, not storage -- deleted immediately
# after a successful read (see confirm_and_delete below). A bucket lifecycle
# rule expiring anything left in this prefix after 1 day is the recommended
# backstop for the case where processing crashes before cleanup runs (set via
# the S3 console/DevOps, not from this app -- see DEPLOYMENT_PLAN.md).
UPLOAD_KEY_PREFIX = "dataset-uploads"

# Files this app owns permanently -- never touched by any lifecycle/expiry
# rule, unlike UPLOAD_KEY_PREFIX above. Keep the two prefixes on separate,
# clearly-named branches so a bucket lifecycle rule can safely target just
# "dataset-uploads/" without any risk of catching real business records.
PERMANENT_KEY_PREFIX = "app-files"

# Real per-file cap: presigned PUT alone (no multipart) comfortably handles
# anything this app's real exports are ever likely to be; capped well below
# S3's own 5GB single-PUT ceiling as a sanity bound, not a technical limit.
MAX_UPLOAD_BYTES = 1024 * 1024 * 1024  # 1 GB


class S3NotConfiguredError(RuntimeError):
    pass


def is_configured() -> bool:
    return bool(os.getenv("AWS_ACCESS_KEY_ID") and os.getenv("AWS_SECRET_ACCESS_KEY") and _bucket())


def _bucket() -> str:
    return os.getenv("S3_ATTACHMENTS_BUCKET", "")


def _client():
    region = os.getenv("AWS_REGION", "eu-north-1")
    return boto3.client(
        "s3",
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
        region_name=region,
        endpoint_url=f"https://s3.{region}.amazonaws.com",
        config=BotoConfig(signature_version="s3v4"),
    )


def _require_configured() -> None:
    if not is_configured():
        raise S3NotConfiguredError(
            "S3 isn't configured (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / S3_ATTACHMENTS_BUCKET) -- "
            "falling back to a direct upload isn't available on this endpoint; set these env vars first."
        )


def new_upload_key(kind: str, filename: str) -> str:
    safe_name = filename.replace("/", "_").replace("\\", "_")
    return f"{UPLOAD_KEY_PREFIX}/{kind}/{uuid.uuid4().hex}-{safe_name}"


def permanent_key(*parts: str) -> str:
    """Deterministic key for a file this app owns permanently (e.g. a SOW
    document, keyed by project_code/filename so it's naturally overwritten on
    a re-upload of the same name -- no uuid, unlike new_upload_key above)."""
    safe_parts = [p.replace("/", "_").replace("\\", "_") for p in parts]
    return "/".join([PERMANENT_KEY_PREFIX, *safe_parts])


def put_object(key: str, content: bytes, content_type: str | None = None) -> None:
    """Direct (non-presigned) upload -- for a file this backend already has
    the bytes for in memory (e.g. a SOW just received via multipart form),
    where a presigned-URL round trip would be pure overhead."""
    _require_configured()
    _client().put_object(Bucket=_bucket(), Key=key, Body=content, ContentType=content_type or "application/octet-stream")


def presign_put(key: str, content_type: str | None) -> str:
    _require_configured()
    return _client().generate_presigned_url(
        "put_object",
        Params={"Bucket": _bucket(), "Key": key, "ContentType": content_type or "application/octet-stream"},
        ExpiresIn=PRESIGN_EXPIRES_IN,
    )


def head_object(key: str) -> dict | None:
    _require_configured()
    try:
        return _client().head_object(Bucket=_bucket(), Key=key)
    except Exception:
        return None


def get_object_bytes(key: str) -> bytes | None:
    _require_configured()
    try:
        return _client().get_object(Bucket=_bucket(), Key=key)["Body"].read()
    except Exception:
        return None


def delete_object(key: str) -> None:
    if not is_configured():
        return
    try:
        _client().delete_object(Bucket=_bucket(), Key=key)
    except Exception:
        pass  # best-effort -- an orphaned relay object expires via the bucket's lifecycle rule regardless
