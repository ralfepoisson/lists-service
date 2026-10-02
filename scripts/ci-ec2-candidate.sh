#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd -P)"
if [[ "$(uname -s)" == Darwin && -x /opt/homebrew/opt/node@24/bin/node ]]; then
  export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
fi
[[ "$(node -p 'process.versions.node.split(".")[0]')" == 24 && "$(npm --version | cut -d. -f1)" == 11 ]] || {
  echo 'EC2 candidate CI requires Node 24 and npm 11' >&2; exit 69
}
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
