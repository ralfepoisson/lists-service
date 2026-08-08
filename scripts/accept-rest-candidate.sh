#!/bin/sh
set -eu

config_file=${1:-}
candidate_version=${2:-}
rest_token_file=${3:-}
script_directory=$(CDPATH= cd -- "$(dirname "$0")" && pwd)

"$script_directory/validate-production-config.sh" "$config_file"
case "$candidate_version" in ''|0|*[!0-9]*) echo "candidate version must be a positive integer" >&2; exit 64 ;; esac
if [ ! -f "$rest_token_file" ] || [ -L "$rest_token_file" ]; then
  echo "REST token must be supplied as a protected regular file" >&2
  exit 65
fi
if metadata=$(stat -c '%u:%a' "$rest_token_file" 2>/dev/null); then :; else metadata=$(stat -f '%u:%Lp' "$rest_token_file"); fi
[ "$metadata" = "$(id -u):600" ] || { echo "REST token file must be owner-only mode 0600" >&2; exit 65; }

set -a
. "$config_file"
set +a
for command in aws jq; do command -v "$command" >/dev/null || { echo "$command is required" >&2; exit 69; }; done
aws lambda get-function --region "$AWS_REGION" --function-name life2-lists-service-prod-rest --qualifier "$candidate_version" >/dev/null

payload_file=$(mktemp /tmp/lists-candidate-payload.XXXXXX)
response_file=$(mktemp /tmp/lists-candidate-response.XXXXXX)
chmod 0600 "$payload_file" "$response_file"
cleanup() {
  rm -f "$payload_file" "$response_file"
}
trap cleanup EXIT HUP INT TERM

invoke_get() {
  path=$1
  token=$2
  if [ -n "$token" ]; then
    jq -n --arg path "$path" --arg token "$token" '{version:"2.0",routeKey:("GET " + $path),rawPath:$path,rawQueryString:"",headers:{authorization:("Bearer " + $token)},requestContext:{requestId:"production-candidate-acceptance",http:{method:"GET",path:$path}},isBase64Encoded:false}' >"$payload_file"
  else
    jq -n --arg path "$path" '{version:"2.0",routeKey:("GET " + $path),rawPath:$path,rawQueryString:"",headers:{},requestContext:{requestId:"production-candidate-acceptance",http:{method:"GET",path:$path}},isBase64Encoded:false}' >"$payload_file"
  fi
  aws lambda invoke --region "$AWS_REGION" --function-name life2-lists-service-prod-rest \
    --qualifier "$candidate_version" --cli-binary-format raw-in-base64-out \
    --payload "fileb://$payload_file" "$response_file" >/dev/null
  jq -er '.statusCode' "$response_file"
}

[ "$(invoke_get /health '')" = "200" ] || { echo "public health failed" >&2; exit 1; }
[ "$(invoke_get /health/ready invalid-production-acceptance-token)" = "401" ] || { echo "invalid bearer rejection failed" >&2; exit 1; }
rest_token=$(tr -d '\r\n' <"$rest_token_file")
[ "$(invoke_get /health/ready "$rest_token")" = "200" ] || { echo "authenticated readiness failed" >&2; exit 1; }
[ "$(invoke_get /v1/items "$rest_token")" = "200" ] || { echo "authenticated persisted list read failed" >&2; exit 1; }
item_count=$(jq -er '.body | fromjson | .meta.count' "$response_file")
unset rest_token
echo "candidate $candidate_version accepted: health=200 invalid-auth=401 readiness=200 persisted-list-read=200 item-count=$item_count"
