#!/bin/sh
set -eu

secret_name=${1:-}
source_file=${2:-}
region=${3:-eu-west-1}
if [ -z "$secret_name" ] || [ -z "$source_file" ]; then
  echo "usage: $0 secret-name /absolute/path/to/mode-0600-value [aws-region]" >&2
  exit 64
fi
case "$source_file" in /*) ;; *) echo "secret source path must be absolute" >&2; exit 64 ;; esac
if [ ! -f "$source_file" ] || [ -L "$source_file" ]; then
  echo "secret source must be a regular non-symlink file" >&2
  exit 65
fi
if metadata=$(stat -c '%u:%a' "$source_file" 2>/dev/null); then
  :
else
  metadata=$(stat -f '%u:%Lp' "$source_file")
fi
owner=${metadata%%:*}
mode=${metadata#*:}
if [ "$owner" != "$(id -u)" ] || [ "$mode" != "600" ]; then
  echo "secret source must be owned by the invoking user and mode 0600" >&2
  exit 65
fi
normalized_file=$(mktemp /tmp/lists-secret-value.XXXXXX)
chmod 0600 "$normalized_file"
cleanup() {
  rm -f "$normalized_file"
}
trap cleanup EXIT HUP INT TERM
tr -d '\r\n' <"$source_file" >"$normalized_file"
[ -s "$normalized_file" ] || { echo "secret source must not be empty" >&2; exit 65; }
if aws secretsmanager describe-secret --region "$region" --secret-id "$secret_name" >/dev/null 2>&1; then
  aws secretsmanager put-secret-value --region "$region" --secret-id "$secret_name" \
    --secret-string "file://$normalized_file" --query ARN --output text
else
  aws secretsmanager create-secret --region "$region" --name "$secret_name" \
    --description "Life2 Lists production runtime secret" \
    --secret-string "file://$normalized_file" --query ARN --output text
fi
