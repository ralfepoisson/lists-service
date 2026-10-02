# Guarded EC2 Lists 0.9.0 candidate

This source package prepares a **candidate only** on the existing production
EC2 host. It never changes Route 53, the API Gateway custom domain, the REST
Lambda `active` alias, ALB/WAF, or Apache. It has not been installed or run on
the production host. The current canonical `lists.life-sqrd.com` origin stays
on Lists 0.8.0 until an independently reviewed ingress handoff.

## Exact release contract

`scripts/ci-ec2-candidate.sh` requires clean local `main` and runs format,
lint, typecheck, a disposable real PostgreSQL migration and backup/restore
test, full Vitest coverage, build-artifact check, high-severity dependency
audit, Python release tests and PlantUML syntax. The host publisher additionally
requires the canonical external Colima profile and the reviewed AWS account.
`APPROVE_ECR_PUSH=YES scripts/publish-ec2-candidate.sh` builds Linux ARM64
from that clean commit, tags `git-<full-sha>`, pushes to the **exact**
`life2-lists` ECR repository, resolves its immutable digest, and writes
`release-output/<sha>/release.json` without credentials. The manifest binds
component, 0.9.0 version, full revision, exact digest, migration filename and
SHA-256 of `001_loops.sql`. The production ECR repository is currently absent;
publication fails closed until it has been reviewed and created.

The host candidate helper must be separately installed from reviewed,
root-controlled source using `deploy/ec2/install-host-tools.sh`. Installation
places fixed root-owned tools under `/usr/local/libexec/life2-lists/`, an
entrypoint at `/usr/local/sbin/life2-lists-candidate`, and root-owned app
directories under `/srv/apps/life2-lists/`. Installing those tools is a live
host mutation and is not part of source verification. Uploaded release data is
only a mode-0600 JSON manifest in an uploader-owned mode-0700 staging directory.
The installed helper takes a no-follow snapshot, validates exact fields and
identity, and never executes uploaded code.
Run `bash deploy/ec2/install-host-tools.sh --check-source` before staging;
it compiles only the Python helpers and syntax-checks both shell scripts without
requiring root or changing the host.

## Protected inputs and identities

Before candidate staging, provision a **dedicated, initially empty**
`lists_service` database on the already existing
`personal-projects-postgresql` network, with four separate roles: restricted
runtime DML, schema migrator, read-only backup, and scratch-database restore.
The existing PostgreSQL host binding stays `127.0.0.1:5432`; no new public
database listener is needed. The restore role needs PostgreSQL `CREATEDB`
privilege and owns its uniquely named scratch database. `CREATEDB` is a
cluster-level grant, so review its breadth, role separation, capacity,
database backup retention and recovery before provisioning. No Lists database
or role has yet been created on the host.

Place these exact root-owned, single-link mode-0600 files in the root-only
`/srv/apps/life2-lists/shared/` directory. The candidate validator parses
literal `KEY=value` lines; it never sources them as shell code or logs values.

| File                                     | Required keys                                                                                                                                                           | Consumer                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `runtime.env`                            | `SECRET_PROVIDER=aws`, `AWS_REGION=eu-west-1`, `HOST=0.0.0.0`, `PORT=3000`, runtime `DATABASE_URL`, existing REST/JWT/catalogue secret ARNs, `LIFE2_ALLOWED_ACCOUNT_ID` | API container only                |
| `migration.env`                          | migrator `DATABASE_URL`                                                                                                                                                 | One-shot migration container only |
| `backup.env`                             | `PGHOST_HELPER=127.0.0.1`, `PGDATABASE=lists_service`, backup/restore usernames and passwords                                                                           | Trusted host backup helper only   |
| `smoke-primary.jwt`, `smoke-foreign.jwt` | Two distinct, unexpired, real Auth-issued Life2 application tokens for separate tenants                                                                                 | Trusted host smoke helper only    |

The database URLs must target `postgres:5432/lists_service` from inside the
internal Docker network; the runtime and migrator URLs must use different
users. The helper rejects shell expansions, Compose interpolation characters,
extra fields, links, open modes,
foreign AWS regions/accounts, mismatched database names and an expiring smoke
JWT. Files must be renewed through a private operator channel, never chat or
logs. The production host instance role currently lacks `secretsmanager`
permission for the Lists token catalogue and tokens; add a reviewed, narrowly
scoped policy before candidate staging. It also needs pull rights to the new
Lists ECR repository. The host has IMDSv2 enabled with hop limit 2; confirm
the candidate container actually resolves credentials during genuine smoke.

## Candidate sequence

1. Confirm clean `main`, the full CI gate, immutable manifest, root-installed
   host tools, free loopback candidate port 43240 or 43241, sufficient `/srv`
   capacity, protected inputs and expected AWS account. The uploader invokes
   `APPROVE_LIVE_CANDIDATE=YES scripts/stage-ec2-candidate.sh`; the fixed host
   helper performs the rest. No host step runs from the uploaded checkout.
2. Re-read the active REST Lambda alias version and preserve it in the release
   result. Pull by ECR digest; verify Linux ARM64, OCI version/revision labels,
   `RepoDigests` and the migration bytes inside the image.
3. Take an exclusive mode-0600 PostgreSQL custom archive through the backup
   role. Validate its `PGDMP` header and `pg_restore --list`, restore it into a
   unique scratch database, compare public table counts and Loop row counts,
   then drop the scratch database. The first 0.9.0 release requires an empty
   target and rejects pre-existing public tables or Loop rows. Preserve the
   verified archive and its SHA-256.
4. Run the one-shot migration service on the PostgreSQL network using only
   `migration.env`. Start the API by exact digest using only `runtime.env` on
   the PostgreSQL and ingress bridge networks. Publish port 3000 solely to
   `127.0.0.1:43240` or `:43241` on the host; the migration service has no
   host port or ingress network. An unsuccessful candidate is stopped; its
   database backup is preserved. The additive migration is not silently
   reversed.
5. Run real loopback acceptance: exact `/version` revision, public heartbeat,
   authenticated ready and Todoist Task Lists reads, invalid-token 401,
   persisted Loop create/read/update/confirmed close, and cross-tenant 404
   using the second Auth token. The smoke leaves one uniquely labelled closed
   Loop as release evidence. The helper repeats the Lambda alias read and
   records `candidate-validated` only if it is unchanged. It does not select
   production ingress.

This package is intentionally limited to the first 0.9.0 migration into an
empty Lists database. A later upgrade requires a separate migration checksum
and rollback compatibility design; the current name-only migration ledger is
not sufficient to prove the SQL already applied by a previous release.

## Ingress handoff and exact rollback

There is **no automated ingress activation** in this candidate package. The
current API Gateway custom domain, A/AAAA Route 53 aliases, Lambda `active`
alias and published 0.8.0 version are the retained rollback route. Before any
future switch, capture the exact Route 53 A/AAAA record sets, API Gateway
domain/mapping, Lambda alias target, ALB listener rules/priority, wildcard ACM
certificate attachment, Apache site, WAF association and current canonical
TLS/authenticated responses in a protected change record. Terraform currently
owns the API Gateway domain and DNS aliases, so review state ownership before
changing records. Stage and validate an Apache candidate vhost and ALB host
rule without selecting DNS; verify the canonical host through a controlled
Host-header route first. Only then move A/AAAA together and prove signed-in
Loops, Shopping and Task Lists through public HTTPS.

If the public path fails, restore the **captured exact** A/AAAA aliases to the
API Gateway regional target and hosted-zone IDs, remove the Lists ALB host
rule and Apache vhost introduced by the switch, and verify the preserved REST
Lambda `active` alias still serves the previously accepted version. Recheck
canonical TLS, authenticated Todoist reads and negative authorization. Do not
drop the Lists database, undo the additive migration, delete the verified
backup, or retire the candidate as part of an ingress rollback.

Production blockers today: no Lists ECR repository, protected EC2 secret
permission, Lists database/roles, reviewed host-tool installation, dual-tenant
smoke tokens, Lists ALB/Apache host route, or approved Terraform/DNS handoff.
The canonical `/srv` filesystem had 6.9 GB free at 97% use on 2 October 2026;
recheck capacity before storing image, backup and rollback artifacts.
