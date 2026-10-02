#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd -P)"
[[ "$(git -C "$repo" branch --show-current)" == main && -z "$(git -C "$repo" status --porcelain)" ]] || {
  echo 'EC2 candidate CI requires clean local main' >&2; exit 65;
}
cd "$repo"
npm ci
npm run format:check
npm run lint
npm run typecheck
./scripts/test-postgres-integration.sh --coverage
npm run verify:build
npm audit --audit-level=high
python3 -m unittest discover -s tests/release -p 'test_*.py' -v
plantuml -checkonly docs/architecture/solution-architecture.puml docs/architecture/erd.puml
