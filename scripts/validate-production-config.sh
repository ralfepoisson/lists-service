#!/bin/sh
set -eu

config_file=${1:-}
if [ -z "$config_file" ] || [ ! -f "$config_file" ] || [ -L "$config_file" ]; then
  echo "usage: $0 /absolute/path/to/owner-only-production.env" >&2
  exit 64
fi
case "$config_file" in /*) ;; *) echo "production config path must be absolute" >&2; exit 64 ;; esac

if metadata=$(stat -c '%u:%a' "$config_file" 2>/dev/null); then
  :
else
  metadata=$(stat -f '%u:%Lp' "$config_file")
fi
owner=${metadata%%:*}
mode=${metadata#*:}
if [ "$owner" != "$(id -u)" ] || [ "$mode" != "600" ]; then
  echo "production config must be owned by the invoking user and mode 0600" >&2
  exit 65
fi

set -a
. "$config_file"
set +a
for name in AWS_REGION TF_STATE_BUCKET TF_STATE_KEY ROUTE53_ZONE_ID \
  REST_CERTIFICATE_ARN REST_DOMAIN_NAME TODOIST_TOKEN_SECRET_ARN \
  TODOIST_TENANT_CATALOG_SECRET_ARN TODOIST_TENANT_TOKEN_SECRET_ARNS \
  REST_API_TOKEN_SECRET_ARN LIFE2_JWT_SIGNING_KEY_SECRET_ARN \
  LIFE2_ALLOWED_ACCOUNT_ID TODOIST_PROJECT_ID; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "$name must be configured" >&2
    exit 65
  fi
done
case "$REST_DOMAIN_NAME" in lists.life-sqrd.com) ;; *) echo "unexpected production domain" >&2; exit 65 ;; esac
case "${REST_ACTIVE_VERSION:-}" in ''|[1-9]*[!0-9]*|0|*[!0-9]*) [ -z "${REST_ACTIVE_VERSION:-}" ] || { echo "REST_ACTIVE_VERSION must be a positive published version" >&2; exit 65; } ;; esac
case "${ALEXA_ACTIVE_VERSION:-}" in ''|[1-9]*[!0-9]*|0|*[!0-9]*) [ -z "${ALEXA_ACTIVE_VERSION:-}" ] || { echo "ALEXA_ACTIVE_VERSION must be a positive published version" >&2; exit 65; } ;; esac
if [ -n "${ALEXA_ACTIVE_VERSION:-}" ] && [ -z "${ALEXA_SKILL_ID:-}" ]; then
  echo "ALEXA_ACTIVE_VERSION requires a real ALEXA_SKILL_ID" >&2
  exit 65
fi
echo "production configuration shape is valid; secret values were not printed"
