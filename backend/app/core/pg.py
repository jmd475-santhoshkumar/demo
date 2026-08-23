"""Single shared Postgres (RDS-compatible) engine -- the one persistent store
for every dataset this app uses (see app/core/dataset_store.py) and every
app-authored record (see app/core/appstate_db.py). No dataset, real or
synthetic, and no app-authored record is read from or written to a local file
at runtime any more: DATABASE_URL is the only place this app's data lives.

Local dev note: point DATABASE_URL at a local Postgres (see
backend/docker-compose.yml) or a dev RDS instance -- there is no local-file
fallback mode any more, on purpose, matching how production will actually run.
"""
import os
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

DATABASE_URL = os.environ.get("DATABASE_URL", "")


class DatabaseNotConfiguredError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    if not DATABASE_URL:
        raise DatabaseNotConfiguredError(
            "DATABASE_URL is not set. This app has no local-file data mode -- point it at a real "
            "Postgres/RDS instance (see DEPLOYMENT_PLAN.md and backend/docker-compose.yml for local dev)."
        )
    # pool_pre_ping avoids handing out a dead connection after an RDS
    # failover/idle-timeout -- worth the extra round trip given how
    # infrequent these calls are relative to a typical web request rate.
    return create_engine(DATABASE_URL, pool_pre_ping=True)


def reset_engine_cache() -> None:
    """Test/ops escape hatch -- lets a changed DATABASE_URL take effect
    without a process restart. Not called anywhere in normal request flow."""
    get_engine.cache_clear()
