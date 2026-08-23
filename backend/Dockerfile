# syntax=docker/dockerfile:1

# Pinned to bookworm, not floating "slim" -- Microsoft's ODBC repo doesn't
# yet support trixie's (Debian 13) stricter GPG policy.
FROM python:3.13-slim-bookworm AS base

# unixodbc/msodbcsql18: SQL Server ODBC driver, used only if the live data
# warehouse connection is enabled. curl/gnupg: only needed to add Microsoft's
# package repo below.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        curl \
        gnupg \
        unixodbc \
        unixodbc-dev \
    && curl -sSL -o /tmp/ms-prod.deb https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb \
    && dpkg -i /tmp/ms-prod.deb \
    && rm -f /tmp/ms-prod.deb \
    && apt-get update \
    && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 \
    && apt-get purge -y --auto-remove curl gnupg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

# Model weights are baked in at build time; HF_HUB_OFFLINE below then blocks
# any runtime network fetch -- HF_HOME must match at both stages.
ENV HF_HOME=/opt/hf-cache
ENV PYTORCH_ENABLE_MPS_FALLBACK=1

COPY requirements.txt .

# CPU-only torch build, installed explicitly first so pip's resolver doesn't
# pull the much larger default CUDA build.
RUN pip install --no-cache-dir torch==2.12.1 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

ENV HF_HUB_OFFLINE=1
ENV TRANSFORMERS_OFFLINE=1

COPY . .

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)" || exit 1

# Exactly one worker: the query layer is an in-memory cache refreshed from
# Postgres, and a second worker/task would briefly disagree with the first
# right after a write.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
