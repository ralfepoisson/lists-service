#!/usr/bin/env bash
set -euo pipefail
umask 077

[[ "${APPROVE_LIVE_CANDIDATE:-}" == YES ]] || { echo 'set APPROVE_LIVE_CANDIDATE=YES' >&2; exit 64; }
repo="$(cd "$(dirname "$0")/.." && pwd -P)"
[[ "$(git -C "$repo" branch --show-current)" == main && -z "$(git -C "$repo" status --porcelain)" ]] || {
  echo 'candidate staging requires clean local main' >&2; exit 65
}
sha="$(git -C "$repo" rev-parse HEAD)"
manifest="$repo/release-output/$sha/release.json"
python3 "$repo/deploy/ec2/release_contract.py" validate-manifest "$manifest" >/dev/null
[[ "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["revision"])' "$manifest")" == "$sha" ]] || {
  echo 'candidate manifest does not match local main' >&2; exit 65
}
host="${LISTS_RELEASE_HOST:-personal-projects}"
[[ "$host" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || { echo 'invalid release host' >&2; exit 65; }
staging="/tmp/life2-lists-release-$sha"
ssh -o BatchMode=yes "$host" "test ! -e '$staging' && install -d -m 0700 -- '$staging'"
scp -q "$manifest" "$host:$staging/release.json"
ssh -o BatchMode=yes "$host" "chmod 0600 -- '$staging/release.json' && sudo -n /usr/local/sbin/life2-lists-candidate '$staging/release.json'"
