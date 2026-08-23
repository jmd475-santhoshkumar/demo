#!/usr/bin/env bash
# ResourceIQ VM bootstrap
#
# Usage:
#   ./vm-bootstrap.sh /root/demo
#
# This script:
#   1. Validates the ResourceIQ repository
#   2. Removes the Windows/local-dev compose override
#   3. Applies required backend/frontend fixes
#   4. Creates/configures .env
#   5. Configures PostgreSQL
#   6. Configures the ALB URL for CORS/Frontend
#   7. Starts PostgreSQL
#
# It does NOT build/start backend/frontend.
# After this script succeeds:
#
#   docker compose up -d --build
#

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

REPO="${1:-$PWD}"

# Your public application URL.
# The EC2 itself is private, so DO NOT try to detect an EC2 public IP.
APP_ORIGIN="http://alb-resouce-iq-949735300.ap-south-2.elb.amazonaws.com"

# ─────────────────────────────────────────────────────────────────────────────
# Helper functions
# ─────────────────────────────────────────────────────────────────────────────

say() {
    printf '\n\033[1m== %s\033[0m\n' "$*"
}

ok() {
    printf '   [ok] %s\n' "$*"
}

warn() {
    printf '   [!!] %s\n' "$*"
}

# ─────────────────────────────────────────────────────────────────────────────
# 0. Repository validation
# ─────────────────────────────────────────────────────────────────────────────

cd "$REPO"

for f in \
    docker-compose.yml \
    backend/requirements.txt \
    frontend/Dockerfile
do
    if [ ! -f "$f" ]; then
        echo "ERROR: $REPO is not the ResourceIQ root."
        echo "Missing: $f"
        exit 1
    fi
done

ok "repo root: $REPO"

command -v python3 >/dev/null 2>&1 || {
    echo "ERROR: python3 is required"
    exit 1
}

docker compose version >/dev/null 2>&1 || {
    echo "ERROR: 'docker compose' v2 is not available"
    exit 1
}

# ─────────────────────────────────────────────────────────────────────────────
# 1. Remove Windows-only Docker Compose override
# ─────────────────────────────────────────────────────────────────────────────

say "clearing Windows-only override"

if [ -f docker-compose.override.yml ]; then

    mv docker-compose.override.yml \
       docker-compose.override.yml.disabled

    ok "docker-compose.override.yml moved to .disabled"

else

    ok "docker-compose.override.yml not present"

fi

mkdir -p db/data
mkdir -p db/init

ok "db/data + db/init exist"

# ─────────────────────────────────────────────────────────────────────────────
# 2. Apply application fixes
# ─────────────────────────────────────────────────────────────────────────────

say "applying boot-blocking fixes"

python3 <<'PYEOF'

import io
import re
import sys

# ─────────────────────────────────────────────────────────────────────────────
# FIX 1: python-multipart
# ─────────────────────────────────────────────────────────────────────────────

path = "backend/requirements.txt"

content = io.open(
    path,
    encoding="utf-8"
).read()

if "python-multipart" in content:

    print(
        "   [ok] fix 1 (python-multipart) already present"
    )

else:

    if not content.endswith("\n"):
        content += "\n"

    content += (
        "python-multipart==0.0.20\n"
    )

    io.open(
        path,
        "w",
        encoding="utf-8",
        newline="\n"
    ).write(content)

    print(
        "   [ok] fix 1 applied "
        "(python-multipart==0.0.20)"
    )


# ─────────────────────────────────────────────────────────────────────────────
# FIX 2a: Frontend Dockerfile BACKEND_URL
# ─────────────────────────────────────────────────────────────────────────────

path = "frontend/Dockerfile"

content = io.open(
    path,
    encoding="utf-8"
).read()

if "ARG BACKEND_URL" in content:

    print(
        "   [ok] fix 2a "
        "(Dockerfile ARG BACKEND_URL) already present"
    )

elif "RUN npm run build" in content:

    replacement = """# BACKEND_URL must be available during the
# Next.js build because rewrites() is evaluated
# during npm run build.

ARG BACKEND_URL=http://backend:8000
ENV BACKEND_URL=$BACKEND_URL

RUN npm run build"""

    content = content.replace(
        "RUN npm run build",
        replacement,
        1
    )

    io.open(
        path,
        "w",
        encoding="utf-8",
        newline="\n"
    ).write(content)

    print(
        "   [ok] fix 2a applied "
        "(BACKEND_URL added before npm build)"
    )

else:

    print(
        "   [!!] fix 2a could not be applied."
    )

    print(
        "       RUN npm run build not found "
        "in frontend/Dockerfile"
    )

    sys.exit(1)


# ─────────────────────────────────────────────────────────────────────────────
# FIX 2b: Docker Compose build argument
# ─────────────────────────────────────────────────────────────────────────────

path = "docker-compose.yml"

content = io.open(
    path,
    encoding="utf-8"
).read()

if re.search(
    r"args:\s*\n\s*BACKEND_URL:",
    content
):

    print(
        "   [ok] fix 2b "
        "(compose BACKEND_URL build arg) already present"
    )

else:

    pattern = (
        r"(  frontend:\n"
        r"    build:\n"
        r"      context: ./frontend\n"
        r"      dockerfile: Dockerfile\n)"
    )

    match = re.search(
        pattern,
        content
    )

    if not match:

        print(
            "   [!!] fix 2b could not be applied."
        )

        print(
            "       frontend build block "
            "does not match expected format."
        )

    else:

        replacement = (
            match.group(1)
            + "      args:\n"
            + "        BACKEND_URL: ${BACKEND_URL:-http://backend:8000}\n"
        )

        content = content.replace(
            match.group(1),
            replacement,
            1
        )

        io.open(
            path,
            "w",
            encoding="utf-8",
            newline="\n"
        ).write(content)

        print(
            "   [ok] fix 2b applied "
            "(compose BACKEND_URL build arg)"
        )

PYEOF

# ─────────────────────────────────────────────────────────────────────────────
# 3. Configure .env
# ─────────────────────────────────────────────────────────────────────────────

say "configuring .env"

if [ ! -f .env ]; then

    if [ ! -f .env.example ]; then
        echo "ERROR: .env.example does not exist"
        exit 1
    fi

    cp .env.example .env

    ok "created .env from .env.example"

else

    ok ".env already exists"

fi

# Backup existing .env before modifying it.

cp .env ".env.bak.$(date +%s)"

# ─────────────────────────────────────────────────────────────────────────────
# Read value from .env
# ─────────────────────────────────────────────────────────────────────────────

getval() {

    awk -F= -v key="$1" '
        $1 == key {
            sub(/^[^=]*=/, "")
            print
            exit
        }
    ' .env

}

# ─────────────────────────────────────────────────────────────────────────────
# Set value in .env
# ─────────────────────────────────────────────────────────────────────────────

setval() {

    local key="$1"
    local value="$2"

    if grep -qE "^${key}=" .env; then

        python3 - "$key" "$value" <<'PYEOF'

import io
import sys

key = sys.argv[1]
value = sys.argv[2]

lines = io.open(
    ".env",
    encoding="utf-8"
).read().splitlines(True)

output = []

for line in lines:

    if line.startswith(key + "="):

        output.append(
            key + "=" + value + "\n"
        )

    else:

        output.append(line)

io.open(
    ".env",
    "w",
    encoding="utf-8",
    newline="\n"
).writelines(output)

PYEOF

    else

        printf '%s=%s\n' "$key" "$value" >> .env

    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# 4. PostgreSQL configuration
# ─────────────────────────────────────────────────────────────────────────────

PG_INITIALISED="no"

if [ -f db/data/PG_VERSION ]; then
    PG_INITIALISED="yes"
fi

PGUSER="$(getval POSTGRES_USER)"

if [ -z "$PGUSER" ]; then
    PGUSER="resourceiq"
fi

PGDB="$(getval POSTGRES_DB)"

if [ -z "$PGDB" ]; then
    PGDB="resourceiq"
fi

PGPASS="$(getval POSTGRES_PASSWORD)"

if [ -z "$PGPASS" ]; then

    if [ "$PG_INITIALISED" = "yes" ]; then

        warn "PostgreSQL data already exists."
        warn "POSTGRES_PASSWORD is empty."
        warn "Restore the original password."
        exit 1

    fi

    PGPASS="$(
        python3 -c '
import secrets
import string

print(
    "".join(
        secrets.choice(
            string.ascii_letters + string.digits
        )
        for _ in range(28)
    )
)
'
    )"

    ok "generated a new POSTGRES_PASSWORD"

else

    ok "keeping existing POSTGRES_PASSWORD"

fi

# PostgreSQL configuration

setval POSTGRES_USER "$PGUSER"

setval POSTGRES_PASSWORD "$PGPASS"

setval POSTGRES_DB "$PGDB"

# IMPORTANT:
# PostgreSQL is another Docker Compose service.
# Therefore use "postgres", NOT localhost.

DATABASE_URL="postgresql+psycopg2://${PGUSER}:${PGPASS}@postgres:5432/${PGDB}"

setval DATABASE_URL "$DATABASE_URL"

ok "DATABASE_URL points at postgres:5432/${PGDB}"

# ─────────────────────────────────────────────────────────────────────────────
# 5. Application URL
# ─────────────────────────────────────────────────────────────────────────────

# The EC2 is private.
# The ALB is the public entry point.
#
# ALB:
# alb-resouce-iq-949735300.ap-south-2.elb.amazonaws.com

APP_ORIGIN="${APP_ORIGIN%/}"

setval CORS_ORIGINS "$APP_ORIGIN"

setval FRONTEND_URL "$APP_ORIGIN"

ok "CORS_ORIGINS set to $APP_ORIGIN"

ok "FRONTEND_URL set to $APP_ORIGIN"

# ─────────────────────────────────────────────────────────────────────────────
# 6. Start PostgreSQL
# ─────────────────────────────────────────────────────────────────────────────

say "starting Postgres"

docker compose up -d postgres

# ─────────────────────────────────────────────────────────────────────────────
# 7. Wait for PostgreSQL health check
# ─────────────────────────────────────────────────────────────────────────────

say "waiting for Postgres"

POSTGRES_HEALTHY="no"

for i in $(seq 1 30); do

    STATUS="$(
        docker compose ps \
            --format '{{.Health}}' \
            postgres \
            2>/dev/null || true
    )"

    STATUS="${STATUS%%$'\n'*}"

    if [ "$STATUS" = "healthy" ]; then

        POSTGRES_HEALTHY="yes"

        break

    fi

    printf "   waiting... (%s/30)\n" "$i"

    sleep 2

done

# ─────────────────────────────────────────────────────────────────────────────
# 8. Result
# ─────────────────────────────────────────────────────────────────────────────

say "result"

docker compose ps postgres

if [ "$POSTGRES_HEALTHY" = "yes" ]; then

    if docker compose exec -T postgres \
        psql -U "$PGUSER" -d "$PGDB" -c '\conninfo' \
        >/dev/null 2>&1
    then

        ok "Postgres is up and accepting connections"

        echo
        echo "   PostgreSQL user : $PGUSER"
        echo "   PostgreSQL DB   : $PGDB"
        echo "   Application URL : $APP_ORIGIN"
        echo
        echo "Next step:"
        echo
        echo "   docker compose up -d --build"
        echo

    else

        warn "Postgres container is healthy but connection failed."

        echo
        echo "Check:"
        echo "   docker compose logs postgres"
        echo

        exit 1

    fi

else

    warn "Postgres did not become healthy."

    echo
    echo "Check:"
    echo "   docker compose logs postgres"
    echo

    exit 1

fi
