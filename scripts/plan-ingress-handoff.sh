#!/bin/sh
set -eu

config_file=${1:-}
plan_file=${2:-}
before_name=${3:-}
before_zone=${4:-}
after_name=${5:-}
after_zone=${6:-}
if [ "$#" -ne 6 ]; then
  echo "usage: $0 protected-production.env /absolute/new.tfplan BEFORE_NAME BEFORE_ZONE AFTER_NAME AFTER_ZONE" >&2
  exit 64
fi
case "$plan_file" in /*) ;; *) echo "plan file path must be absolute" >&2; exit 64 ;; esac
if [ -e "$plan_file" ] || [ -e "$plan_file.json" ]; then
  echo "plan file already exists; preserve prior review evidence" >&2
  exit 65
fi

script_directory=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
repository_root=$(CDPATH= cd -- "$script_directory/.." && pwd)
if [ "$(git -C "$repository_root" branch --show-current)" != main ] || \
   [ -n "$(git -C "$repository_root" status --porcelain)" ]; then
  echo "ingress plan requires clean local main" >&2
  exit 65
fi
"$script_directory/validate-production-config.sh" "$config_file" >/dev/null
set -a
. "$config_file"
set +a
if [ -z "${REST_ACTIVE_VERSION:-}" ] || { [ "$before_name" = "$after_name" ] && [ "$before_zone" = "$after_zone" ]; }; then
  echo "handoff requires an active Lambda alias and distinct captured DNS targets" >&2
  exit 65
fi
case "$REST_INGRESS_TARGET" in
  alb)
    [ "$after_name" = "$REST_ALB_DNS_NAME" ] && [ "$after_zone" = "$REST_ALB_ZONE_ID" ] || {
      echo "captured ALB target differs from protected configuration" >&2; exit 65;
    } ;;
  api_gateway)
    [ "$before_name" = "${REST_ALB_DNS_NAME:-}" ] && [ "$before_zone" = "${REST_ALB_ZONE_ID:-}" ] || {
      echo "rollback origin differs from protected ALB configuration" >&2; exit 65;
    } ;;
esac

for command in aws terraform python3 git curl; do
  command -v "$command" >/dev/null || { echo "$command is required" >&2; exit 69; }
done
[ "$(aws sts get-caller-identity --query Account --output text)" = "154596858576" ] || {
  echo "unexpected AWS account" >&2; exit 65;
}
live_alias=$(aws lambda get-alias --region "$AWS_REGION" \
  --function-name life2-lists-service-prod-rest --name active \
  --query FunctionVersion --output text)
[ "$live_alias" = "$REST_ACTIVE_VERSION" ] || {
  echo "live Lambda alias differs from protected configuration" >&2; exit 65;
}
if [ "$REST_INGRESS_TARGET" = alb ]; then
  public_version=$(curl --fail --silent --show-error --max-time 8 \
    "https://$REST_DOMAIN_NAME/version" | \
    python3 -c 'import json,sys; print(json.load(sys.stdin).get("version", ""))')
  [ "$public_version" = 0.8.0 ] || {
    echo "public Lists version is not the retained 0.8.0 release" >&2; exit 65;
  }
fi

umask 077
export TF_VAR_aws_region="$AWS_REGION"
export TF_VAR_environment=prod
export TF_VAR_route53_zone_id="$ROUTE53_ZONE_ID"
export TF_VAR_rest_certificate_arn="$REST_CERTIFICATE_ARN"
export TF_VAR_rest_domain_name="$REST_DOMAIN_NAME"
export TF_VAR_rest_ingress_target="$REST_INGRESS_TARGET"
export TF_VAR_rest_alb_dns_name="${REST_ALB_DNS_NAME:-}"
export TF_VAR_rest_alb_zone_id="${REST_ALB_ZONE_ID:-}"
export TF_VAR_todoist_tenant_catalog_secret_arn="$TODOIST_TENANT_CATALOG_SECRET_ARN"
export TF_VAR_todoist_tenant_token_secret_arns="$(printf '%s' "$TODOIST_TENANT_TOKEN_SECRET_ARNS" | awk -F, '{printf "["; for(i=1;i<=NF;i++){gsub(/^[[:space:]]+|[[:space:]]+$/, "", $i); printf "%s\"%s\"", (i>1?",":""), $i} printf "]"}')"
export TF_VAR_rest_api_token_secret_arn="$REST_API_TOKEN_SECRET_ARN"
export TF_VAR_life2_jwt_signing_key_secret_arn="$LIFE2_JWT_SIGNING_KEY_SECRET_ARN"
export TF_VAR_life2_allowed_account_id="$LIFE2_ALLOWED_ACCOUNT_ID"
export TF_VAR_alexa_skill_id="${ALEXA_SKILL_ID:-}"
export TF_VAR_rest_active_version="$REST_ACTIVE_VERSION"
export TF_VAR_alexa_active_version="${ALEXA_ACTIVE_VERSION:-}"
export TF_VAR_release_git_commit="$(git -C "$repository_root" rev-parse HEAD)"

terraform -chdir="$repository_root/terraform" init -reconfigure \
  -backend-config="bucket=$TF_STATE_BUCKET" \
  -backend-config="key=$TF_STATE_KEY" \
  -backend-config="region=$AWS_REGION" \
  -backend-config="encrypt=true" \
  -backend-config="use_lockfile=true" >/dev/null
terraform -chdir="$repository_root/terraform" plan \
  -target='aws_route53_record.rest_ipv4[0]' \
  -target='aws_route53_record.rest_ipv6[0]' \
  -out="$plan_file" >/dev/null
terraform -chdir="$repository_root/terraform" show -json "$plan_file" > "$plan_file.json"
python3 "$repository_root/deploy/ec2/ingress_plan.py" \
  "$plan_file.json" "$before_name" "$before_zone" "$after_name" "$after_zone"
echo "lists_ingress_plan_saved=$plan_file; apply_requires_separate_review"
