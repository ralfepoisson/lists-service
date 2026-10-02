#!/usr/bin/env bash
set -euo pipefail
umask 077

source_dir="$(cd "$(dirname "$0")" && pwd -P)"
check_source_syntax() {
  for name in release_contract.py backup_restore.py candidate_smoke.py host_candidate.py database_provision.py; do
    /usr/bin/python3 -m py_compile "$source_dir/$name"
  done
  /bin/bash -n "$source_dir/life2-lists-candidate"
  /bin/bash -n "$source_dir/install-host-tools.sh"
}
if [[ "${1:-}" == --check-source ]]; then
  [[ "$#" -eq 1 ]] || exit 64
  check_source_syntax
  echo 'host_tool_source=valid'
  exit 0
fi
[[ "$#" -eq 0 ]] || exit 64
[[ "$EUID" -eq 0 ]] || { echo 'installer requires root' >&2; exit 65; }
[[ "$source_dir" == /root/* || "$source_dir" == /var/tmp/* ]] || {
  echo 'reviewed root-controlled source directory required' >&2; exit 65
}
[[ "$(stat -c '%u:%g' "$source_dir")" == 0:0 &&
   "$(stat -c '%a' "$source_dir")" == 700 && ! -L "$source_dir" ]] || {
  echo 'root-controlled source directory required' >&2; exit 65
}
for name in release_contract.py backup_restore.py candidate_smoke.py host_candidate.py database_provision.py life2-lists-candidate; do
  source="$source_dir/$name"
  [[ -f "$source" && ! -L "$source" && "$(stat -c '%u:%g:%h' "$source")" == 0:0:1 ]] || {
    echo 'untrusted host-tool source metadata' >&2; exit 65
  }
done
check_source_syntax
install -d -o root -g root -m 0755 /usr/local/libexec/life2-lists
for name in release_contract.py backup_restore.py candidate_smoke.py host_candidate.py database_provision.py; do
  install -o root -g root -m 0755 "$source_dir/$name" "/usr/local/libexec/life2-lists/$name"
done
install -o root -g root -m 0755 "$source_dir/life2-lists-candidate" /usr/local/sbin/life2-lists-candidate
install -d -o root -g root -m 0750 /srv/apps/life2-lists
install -d -o root -g root -m 0700 /srv/apps/life2-lists/shared /srv/apps/life2-lists/releases
install -d -o root -g root -m 0750 /srv/apps/life2-lists/backups
echo 'lists_host_tools=installed; no candidate or ingress changed'
