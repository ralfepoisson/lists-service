#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
postgres_bin_dir="${POSTGRES_BIN_DIR:-/Applications/Postgres.app/Contents/Versions/18/bin}"
for binary in initdb pg_ctl; do
  [[ -x "$postgres_bin_dir/$binary" ]] || { echo "missing PostgreSQL binary: $binary" >&2; exit 69; }
done

temporary_root="$(mktemp -d /tmp/life2-lists-postgres.XXXXXX)"
started=false
cleanup() {
  if [[ "$started" == true ]]; then
    "$postgres_bin_dir/pg_ctl" -D "$temporary_root/data" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  rm -rf -- "$temporary_root"
}
trap cleanup EXIT

port="$(python3 - <<'PY'
import socket
with socket.socket() as server:
    server.bind(('127.0.0.1', 0))
    print(server.getsockname()[1])
PY
)"
"$postgres_bin_dir/initdb" -A trust -U lists_test -D "$temporary_root/data" --no-instructions >/dev/null
"$postgres_bin_dir/pg_ctl" -D "$temporary_root/data" -l "$temporary_root/server.log" -o "-h 127.0.0.1 -p $port -k $temporary_root" -w start >/dev/null
started=true

export DATABASE_URL="postgresql://lists_test@127.0.0.1:$port/postgres"
export LISTS_TEST_DATABASE_URL="$DATABASE_URL"
export POSTGRES_BIN_DIR="$postgres_bin_dir"
cd "$repository_root"
npm run build
node dist/migrate.cjs
node dist/migrate.cjs
python3 -m unittest discover -s tests/release -p 'test_*.py' -v
if [[ "${1:-}" == --coverage ]]; then
  npm run test:coverage
else
  npm test
fi
