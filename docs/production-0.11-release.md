# Lists0.11 guarded release

This release deploys the committed Todoist connection-management implementation,
preserving the existing tenant catalogue and provider tokens. Calendar0.12 source
work is separate and is not part of this release.

The immutable publisher and schema-2 manifest bind version0.11.0 and all six
committed migrations. Historical0.10.1/0.10.3/0.10.4/0.10.5/0.10.6 manifests
retain exactly their five original migration checksums; the accepted six-table
production baseline must match those five before any transition. Migration006
adds an empty encrypted override/tombstone store. No server-catalogue credential
is copied into it. Current0.11 manifests bind all six and expect seven tables.

Provision a fresh32-byte Base64 service encryption key in the existing Secrets
Manager boundary, grant only that exact ARN to the existing runtime role, and
add its ARN as `TODOIST_CONNECTION_KEY_SECRET_ARN` to the protected root-owned
`runtime.env`. Preserve all earlier config/secret versions and take a protected
configuration/policy backup before the additive update. Do not rotate a key if
the override store already has encrypted records: that requires separate recovery
coordination. The key belongs to the recovery unit for future saved overrides.

The trusted host config validator permits the bounded in-account key ARN and
preflights `GetSecretValue` while printing only its ARN. Candidate and canonical
acceptance require real readiness, exact metadata, existing Todoist task-list
reads, credential-free management status with `canManageConnection=true`,
browser CORS, persisted Loop/comment writes/close and foreign-tenant denial.
No owner token Save/Disconnect is performed for release acceptance.

Run the existing full `scripts/ci-ec2-candidate.sh` with pinned Node24.18.0 and
npm11.16.0. Its PostgreSQL runner provisions an isolated native Postgres.app
cluster; no replacement Docker VM is needed. Publish through an already-existing
ARM64 remote Buildx builder with `REGISTRY_LOGIN_HOST=ssh://personal-projects`
when canonical local Docker is unavailable. Source the canonical runtime helper
for laptop Docker operations. Install the separately reviewed host tools, stage
the immutable candidate, pass the actual backup/isolated restore and double
migration rehearsal, then select the candidate through the existing Apache-only
upgrade boundary. Preserve ALB/DNS/Lambda, prior images and exact ingress rollback.

## Credential-state-safe cutover and rollback

The0.10 predecessor cannot interpret006 overrides or disconnect tombstones.
The canonical route switch therefore holds a real PostgreSQL SHARE lock only
on the new override table, first requiring that it is empty. Task/Loop reads
and unrelated writes remain available; new credential writes wait briefly.
The lock has bounded acquisition and an owned fifteen-minute idle lease. The
activator rechecks fence ownership before committing acceptance or recovery.

On successful acceptance the fence releases and the new runtime admits pending
credential writes. On failure the candidate API is stopped while the fence is
still owned, aborting pending writes before restoring the exact old Apache
route. If the fence is lost or pre-existing override/tombstone rows exist, do
not select old code. Preserve the new runtime/data and require explicit recovery
coordination. Later application rollback must preserve006 and its exact managed
key and must not ignore a saved replacement or disconnection state.
