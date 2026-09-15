#!/usr/bin/env bash
#
# Per-boot bring-up for the IndaPlay / TV2 PoC backend.
#
# Starts the PostgreSQL 17 cluster, ensures the poc role and the poc / poc_test
# databases exist, and applies pending migrations. Safe to run repeatedly.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$REPO_ROOT/poc/backend"
PG_MAJOR="17"
PG_PORT="5432"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use "$(tr -d '[:space:]' < "$BACKEND/.nvmrc")" >/dev/null

echo "== Starting PostgreSQL ${PG_MAJOR} cluster =="
sudo pg_ctlcluster "$PG_MAJOR" main start 2>/dev/null || true

echo "== Waiting for PostgreSQL to accept connections =="
for _ in $(seq 1 30); do
  if pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1; then break; fi
  sleep 1
done
pg_isready -h 127.0.0.1 -p "$PG_PORT"

echo "== Ensuring role and databases =="
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='poc'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE ROLE poc WITH LOGIN PASSWORD 'poc' CREATEDB;"
for db in poc poc_test; do
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${db}'" | grep -q 1 \
    || sudo -u postgres psql -c "CREATE DATABASE ${db} OWNER poc TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C';"
done

echo "== Applying migrations (poc, poc_test) =="
cd "$BACKEND"
DATABASE_URL="postgresql://poc:poc@127.0.0.1:${PG_PORT}/poc" npm run db:migrate
DATABASE_URL="postgresql://poc:poc@127.0.0.1:${PG_PORT}/poc_test" npm run db:migrate

echo "== start.sh complete =="
