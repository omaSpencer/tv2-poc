#!/usr/bin/env bash
#
# Idempotent repository bootstrap for the IndaPlay / TV2 PoC backend.
#
# Installs the pinned Node toolchain and PostgreSQL 17, installs backend
# dependencies, builds the project, and writes local (gitignored) env files.
# Per-boot service bring-up and migrations live in start.sh.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$REPO_ROOT/poc/backend"
NODE_VERSION="$(tr -d '[:space:]' < "$BACKEND/.nvmrc")"
PG_MAJOR="17"

echo "== Node ${NODE_VERSION} via nvm =="
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm install "$NODE_VERSION"
nvm alias default "$NODE_VERSION"
nvm use "$NODE_VERSION"
# Force the selected toolchain to the front of PATH so it wins regardless of any
# other node that may already be on PATH.
export PATH="$(dirname "$(nvm which "$NODE_VERSION")"):$PATH"
echo "Using node $(node -v) / npm $(npm -v)"

echo "== PostgreSQL ${PG_MAJOR} =="
if [ ! -x "/usr/lib/postgresql/${PG_MAJOR}/bin/postgres" ]; then
  sudo install -d /usr/share/postgresql-common/pgdg
  sudo curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
    | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    "postgresql-${PG_MAJOR}" "postgresql-client-${PG_MAJOR}"
fi

echo "== Backend dependencies and build =="
cd "$BACKEND"
npm ci
npm run build

echo "== Local env files (gitignored, dev-only credentials) =="
if [ ! -f "$BACKEND/.env" ]; then
  cat > "$BACKEND/.env" <<'ENVEOF'
NODE_ENV=development
PORT=3000
LOG_LEVEL=info
DATABASE_URL=postgresql://poc:poc@127.0.0.1:5432/poc

FEATURE_IDENTITY=off
FEATURE_OUTBOX_RELAY=off
FEATURE_SEARCH=off
FEATURE_MEDIA=off

POSTGRES_USER=poc
POSTGRES_PASSWORD=poc
POSTGRES_DB=poc
POSTGRES_PORT=5432

TEST_DATABASE_URL=postgresql://poc:poc@127.0.0.1:5432/poc_test
ENVEOF
fi
# The integration suite runs the in-process app against the disposable _test
# database; @nestjs/config lets this env file's DATABASE_URL win, so it must
# point at poc_test. Run the suite with `ENV_FILE=.env.test npm test`.
if [ ! -f "$BACKEND/.env.test" ]; then
  cat > "$BACKEND/.env.test" <<'ENVEOF'
NODE_ENV=test
PORT=3000
LOG_LEVEL=info
DATABASE_URL=postgresql://poc:poc@127.0.0.1:5432/poc_test

FEATURE_IDENTITY=off
FEATURE_OUTBOX_RELAY=off
FEATURE_SEARCH=off
FEATURE_MEDIA=off

TEST_DATABASE_URL=postgresql://poc:poc@127.0.0.1:5432/poc_test
ENVEOF
fi

echo "== install.sh complete =="
