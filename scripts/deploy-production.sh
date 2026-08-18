#!/bin/sh
set -eu

config_file=${1:-}
operation=${2:-}
requested_version=${3:-}
case "$operation" in
  --candidate|--plan) [ -z "$requested_version" ] || { echo "$operation takes no version" >&2; exit 64; } ;;
  --activate-rest|--rollback-rest|--activate-alexa|--rollback-alexa)
    case "$requested_version" in ''|*[!0-9]*) echo "$operation requires a published numeric version" >&2; exit 64 ;; esac ;;
  *) echo "usage: $0 config [--plan|--candidate|--activate-rest VERSION|--rollback-rest VERSION|--activate-alexa VERSION|--rollback-alexa VERSION]" >&2; exit 64 ;;
esac

script_directory=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
repository_root=$(CDPATH= cd -- "$script_directory/.." && pwd)
"$script_directory/validate-production-config.sh" "$config_file"
set -a
. "$config_file"
set +a

cd "$repository_root"
if [ "$(git branch --show-current)" != "main" ] || [ -n "$(git status --porcelain)" ]; then
  echo "production deployment requires clean local main" >&2
  exit 65
fi
release_commit=$(git rev-parse HEAD)
build_container="life2-lists-release-$$"
cleanup() {
  docker rm -f "$build_container" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

for command in aws docker terraform git; do command -v "$command" >/dev/null || { echo "$command is required" >&2; exit 69; }; done
aws sts get-caller-identity >/dev/null
aws s3api head-bucket --bucket "$TF_STATE_BUCKET" >/dev/null

export TF_VAR_aws_region="$AWS_REGION"
export TF_VAR_environment=prod
export TF_VAR_route53_zone_id="$ROUTE53_ZONE_ID"
export TF_VAR_rest_certificate_arn="$REST_CERTIFICATE_ARN"
export TF_VAR_rest_domain_name="$REST_DOMAIN_NAME"
export TF_VAR_todoist_token_secret_arn="$TODOIST_TOKEN_SECRET_ARN"
export TF_VAR_todoist_tenant_catalog_secret_arn="$TODOIST_TENANT_CATALOG_SECRET_ARN"
export TF_VAR_todoist_tenant_token_secret_arns="$(printf '%s' "$TODOIST_TENANT_TOKEN_SECRET_ARNS" | awk -F, '{printf "["; for(i=1;i<=NF;i++){gsub(/^[[:space:]]+|[[:space:]]+$/, "", $i); printf "%s\"%s\"", (i>1?",":""), $i} printf "]"}')"
export TF_VAR_rest_api_token_secret_arn="$REST_API_TOKEN_SECRET_ARN"
export TF_VAR_life2_jwt_signing_key_secret_arn="$LIFE2_JWT_SIGNING_KEY_SECRET_ARN"
export TF_VAR_life2_allowed_account_id="$LIFE2_ALLOWED_ACCOUNT_ID"
export TF_VAR_todoist_project_id="$TODOIST_PROJECT_ID"
export TF_VAR_alexa_skill_id="${ALEXA_SKILL_ID:-}"
export TF_VAR_rest_active_version="${REST_ACTIVE_VERSION:-}"
export TF_VAR_alexa_active_version="${ALEXA_ACTIVE_VERSION:-}"
export TF_VAR_release_git_commit="$release_commit"

case "$operation" in
  --activate-rest|--rollback-rest)
    aws lambda get-function --region "$AWS_REGION" --function-name life2-lists-service-prod-rest \
      --qualifier "$requested_version" >/dev/null
    export TF_VAR_rest_active_version="$requested_version"
    ;;
  --activate-alexa|--rollback-alexa)
    [ -n "${ALEXA_SKILL_ID:-}" ] || { echo "Alexa has no real configured skill ID" >&2; exit 65; }
    aws lambda get-function --region "$AWS_REGION" --function-name life2-lists-service-prod-alexa \
      --qualifier "$requested_version" >/dev/null
    export TF_VAR_alexa_active_version="$requested_version"
    ;;
esac

docker create \
  --name "$build_container" \
  --env HOME=/tmp \
  --workdir /app \
  node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d \
  sh -c 'node --version && npm --version && npm ci && npm run validate && npm audit --audit-level=high' \
  >/dev/null
git archive HEAD | docker cp - "$build_container:/app"
docker start --attach "$build_container"
mkdir -p "$repository_root/dist"
rm -rf "$repository_root/dist/rest-package"
docker cp "$build_container:/app/dist/rest-package" "$repository_root/dist/rest-package"
docker cp "$build_container:/app/dist/alexa-lambda.mjs" "$repository_root/dist/alexa-lambda.mjs"
terraform -chdir=terraform init -reconfigure \
  -backend-config="bucket=$TF_STATE_BUCKET" \
  -backend-config="key=$TF_STATE_KEY" \
  -backend-config="region=$AWS_REGION" \
  -backend-config="encrypt=true" \
  -backend-config="use_lockfile=true"

if [ "$operation" = "--plan" ]; then
  terraform -chdir=terraform plan
  exit 0
fi
terraform -chdir=terraform apply
terraform -chdir=terraform output
echo "production operation completed for commit $release_commit"
