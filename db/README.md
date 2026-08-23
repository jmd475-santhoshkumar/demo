# db/

Postgres state for the compose stack.

- `data/` — the live Postgres data directory, bind-mounted to
  `/var/lib/postgresql/data`. Created by the container on first start.
  **Never committed, never edited by hand.** Back this up by stopping the
  stack and copying the directory, or with `pg_dump` (preferred).

- `init/` — optional bootstrap scripts. Any `*.sql` / `*.sh` here runs
  **once**, in filename order, the first time Postgres initializes an empty
  `data/`. Ignored on every later start. Drop a dump in here to seed the
  database automatically:

      cp resourceiq_dump.sql db/init/01_seed.sql

## Resetting the database

The `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` values are only read
during that first initialization. To change them afterwards you must wipe the
data directory:

    docker compose down
    sudo rm -rf db/data
    docker compose up -d
