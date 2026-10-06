#!/usr/bin/env bash
set -euo pipefail
umask 077

[[ "${APPROVE_ECR_PUSH:-}" == YES ]] || { echo 'set APPROVE_ECR_PUSH=YES' >&2; exit 64; }
repo="$(cd "$(dirname "$0")/.." && pwd -P)"
[[ "$(basename "$repo")" == lists-service ]] || { echo 'repository mismatch' >&2; exit 65; }
[[ "$(git -C "$repo" branch --show-current)" == main && -z "$(git -C "$repo" status --porcelain)" ]] || {
  echo 'candidate publication requires clean local main' >&2; exit 65;
}
source "$repo/../scripts/life2-colima-runtime.sh"
life2_require_canonical_colima_home
if [[ "$(uname -s)" == Darwin && ! -S "$LIFE2_CANONICAL_DOCKER_SOCKET" ]]; then
  echo 'canonical Docker socket unavailable' >&2; exit 69
fi
for executable in aws docker git node npm python3; do
  command -v "$executable" >/dev/null || { echo "missing $executable" >&2; exit 69; }
done
account=154596858576
region=eu-west-1
repository=life2-lists
registry="$account.dkr.ecr.$region.amazonaws.com"
export AWS_REGION="$region" AWS_DEFAULT_REGION="$region" AWS_PAGER=''
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$account" ]] || {
  echo 'AWS account mismatch' >&2; exit 65;
}
aws ecr describe-repositories --region "$region" --repository-names "$repository" >/dev/null || {
  echo 'reviewed Lists ECR repository is absent' >&2; exit 65;
}
"$repo/scripts/ci-ec2-candidate.sh"
sha="$(git -C "$repo" rev-parse HEAD)"
tag="$registry/$repository:git-$sha"
builder="${BUILDX_BUILDER:-life2-lists-release}"
[[ "$builder" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$ ]] || { echo 'invalid builder' >&2; exit 65; }
docker buildx inspect "$builder" >/dev/null 2>&1 || docker buildx create --name "$builder" --driver docker-container >/dev/null
[[ "$(docker buildx inspect "$builder" | awk -F: '$1=="Driver" {gsub(/^[[:space:]]+/, "", $2);print $2;exit}')" == docker-container ]] || {
  echo 'attesting Buildx builder required' >&2; exit 65;
}
login_host="${REGISTRY_LOGIN_HOST:-}"
if [[ -n "$login_host" && "$login_host" != ssh://personal-projects ]]; then
  echo 'registry login host must be the existing production release host' >&2; exit 65
fi
if [[ -n "$login_host" ]]; then
  aws ecr get-login-password --region "$region" | docker --host "$login_host" login --username AWS --password-stdin "$registry" >/dev/null
else
  aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "$registry" >/dev/null
fi
docker buildx build --builder "$builder" --platform linux/arm64 \
  --build-arg "LIFE2_RELEASE_REVISION=$sha" --build-arg COMPONENT_VERSION=0.10.3 \
  --provenance=true --sbom=true --push -t "$tag" "$repo"
digest="$(aws ecr describe-images --region "$region" --repository-name "$repository" \
  --image-ids "imageTag=git-$sha" --query 'imageDetails[0].imageDigest' --output text)"
image="$registry/$repository@$digest"
output="$repo/release-output/$sha"
mkdir -p "$output"
python3 "$repo/deploy/ec2/release_contract.py" emit-upgrade-manifest "$sha" "$image" \
  "$repo/migrations" "$output/release.json"
python3 "$repo/deploy/ec2/release_contract.py" validate-manifest "$output/release.json"
printf 'lists_candidate_published=%s\n' "$sha"
printf 'manifest=%s\n' "$output/release.json"
