# Guarded EC2 Lists release and upgrade

## Current 0.10.2 upgrade contract

The accepted 0.9.0 service already serves the canonical origin through the
existing EC2 Apache route. The upgrade preserves ALB, DNS, API Gateway and
Lambda aliases. No new credentials or provider schedule is created.

Publication requires the full CI gate below and a clean committed main. The
schema-2 manifest binds version 0.10.2, immutable ARM64 image, source revision
and the exact SHA-256 of all five migrations. The fixed host helper verifies
image labels and each migration inside the image. It reuses the retained Lists
bridge only after checking its Docker Compose ownership labels.

Before live migration the helper creates and restore-verifies a protected
PostgreSQL archive, compares existing Loop/reference counts and schema tables,
then runs the candidate's migrations twice against that restored scratch database.
The accepted three-table 0.9 schema is required. The migration ledger gains
SHA-256 checksums and an advisory lock. Only the known original 001 checksum
may bridge its legacy name-only ledger row; changed or unknown applied SQL
fails closed. All later checksums must match exactly.

The candidate starts on the unused fixed loopback port while the accepted 0.9
container remains available. Two distinct genuine Auth-issued tokens must have
more than ten minutes left at validation; mint fresh transient acceptance tokens
through the canonical issuer into the existing protected root-only files.
Acceptance includes actual Todoist Task Lists reads, persisted Loop create,
update and confirmed close, comment create/read, tags read, invalid-token 401,
foreign-tenant 404 and rejection of comments on a closed Loop. The uniquely
labelled closed Loop remains as release evidence. Approved source Loop seeding
is a separate identity-aware reconciliation step; the release never runs it.

After candidate acceptance, the installed helper supports the explicit upgrade:

```sh
sudo /usr/local/sbin/life2-lists-candidate --activate <full-committed-sha>
```

It requires the matching root-owned candidate receipt and restored rehearsal,
rechecks loopback identity and authenticated access, validates retained 0.9
public and manifest identity, captures the exact current Apache site, and changes
only its two matching fixed loopback target ports. Apache syntax must pass before
reload. Public HTTPS must then prove exact revision, heartbeat, tenant-owned
Loops/tags/Task Lists reads and negative authorization. Any failure restores the
captured site and reloads Apache. Additive schema, data, backups and the retained
0.9 container remain. A successful root-only activation receipt records both
revisions, immutable image and selected port. Further upgrades require a new
reviewed baseline contract.

The historical initial-deployment procedure below documents the retained
bootstrap and original ingress handoff; its empty database requirement applies
only to schema-1/version-0.9 manifests.

## Historical 0.9 bootstrap

This source package prepared a **candidate only** on the existing production
EC2 host. The initial bootstrap never changes Route 53, the API Gateway custom domain, the REST
Lambda `active` alias, ALB/WAF, or Apache. Installing host tools does not run
the candidate or select production ingress. The original canonical Lists 0.8.0 origin remained on Lambda until the separately accepted ingress handoff.

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
SHA-256 of `001_loops.sql`. Publication fails closed if the reviewed immutable
ECR repository is unavailable.

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
database backup retention and recovery before provisioning. The dedicated
production Lists database and four roles were provisioned on 2026-10-03; the
database was initially empty; current upgrades require the accepted 0.9 schema. Check the
dated implementation entries and inspect live state before staging.

The reviewed host-tool installer also installs `database_provision.py`. Its
fixed first-use procedure requires a root-owned, single-link mode-0600
`/srv/apps/life2-lists/shared/provision.env` under the root-owned mode-0700
`shared` directory. Supply exactly the three in-account Secrets Manager ARN
references named below, `LIFE2_ALLOWED_ACCOUNT_ID`, and four **distinct**
cryptographically generated, URL-safe database passwords of 40–128 characters:

```text
REST_API_TOKEN_SECRET_ARN=<reviewed ARN>
LIFE2_JWT_SIGNING_KEY_SECRET_ARN=<reviewed ARN>
TODOIST_TENANT_CATALOG_SECRET_ARN=<reviewed ARN>
LIFE2_ALLOWED_ACCOUNT_ID=<reviewed account identifier>
PGPASSWORD_RUNTIME=<private value>
PGPASSWORD_MIGRATOR=<private value>
PGPASSWORD_BACKUP=<private value>
PGPASSWORD_RESTORE=<private value>
```

Populate this file through a private operator channel. Never place values in
Git, a command argument, shell history, chat, or a test fixture; keep the
protected input for recovery. After separately installing reviewed host tools,
run the source syntax gate and the non-mutating plan first:

```sh
bash deploy/ec2/install-host-tools.sh --check-source
sudo /usr/bin/python3 /usr/local/libexec/life2-lists/database_provision.py \
  /srv/apps/life2-lists/shared/provision.env
```

Only after reviewing the fixed four-role grant plan and the cluster-wide
`CREATEDB` exposure, apply exactly once:

```sh
sudo /usr/bin/python3 /usr/local/libexec/life2-lists/database_provision.py \
  /srv/apps/life2-lists/shared/provision.env \
  --apply --acknowledge-restore-createdb
```

The command refuses any pre-existing Lists database, role, or output file. It
creates `lists_migrator` as database/schema owner, `lists_runtime` with only
table SELECT/INSERT/UPDATE/DELETE, `lists_backup` with table SELECT, and
`lists_restore` with no connection to the production Lists database. The
migrator's default privileges cover tables created by `001_loops.sql`.
PostgreSQL cannot scope `CREATEDB` to a database-name prefix: the restore
role receives that cluster privilege solely so the fixed host helper can
create and drop an unpredictable `lists_restore_*` scratch database. Keep its
credential only in `backup.env`, execute the helper as installed root-owned
code, and review this grant and database capacity before staging. The tool
then writes `runtime.env`, `migration.env`, and `backup.env` as separate
root-owned mode-0600 files without printing their values. A partial failure
requires private operator reconciliation; never rerun by dropping an existing
database or rotating a password blindly. The real isolated role and archive
test is `./scripts/test-postgres-integration.sh --roles-only`.

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
logs. Confirm the host instance role still has narrowly scoped Secrets Manager
reads for these Lists references and ECR pull rights for the exact repository
before candidate staging. The host has IMDSv2 enabled with hop limit 2; confirm
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

The original schema-1 path is limited to the first 0.9.0 migration into an empty
Lists database. The schema-2 upgrade described above supplies migration
checksums and an exact captured-route rollback.

## Ingress handoff and exact rollback

The original schema-1 package had no automated ingress activation. The
current API Gateway custom domain, A/AAAA Route 53 aliases, Lambda `active`
alias and published 0.8.0 version are the retained rollback route. Before any
future switch, capture the exact Route 53 A/AAAA record sets, API Gateway
domain/mapping, Lambda alias target, ALB listener rules/priority, wildcard ACM
certificate attachment, Apache site, WAF association and current canonical
TLS/authenticated responses in a protected change record. Terraform owns the
API Gateway domain and DNS aliases. Its explicit `rest_ingress_target`
selector changes only the A/AAAA alias targets while retaining the API Gateway
domain/mapping and REST Lambda `active` alias. Use the
[guarded ingress handoff](ingress-handoff.md), including its saved-plan
validator, to review ownership and limit the change to both DNS records.
Render and validate the [Apache vhost template](../deploy/ec2/apache/life2-lists.conf.template)
with the actual accepted candidate port; stage it with an ALB host rule without
selecting DNS. Verify the canonical host through a controlled Host-header
route first. Only then move A/AAAA together and prove signed-in Loops,
Shopping and Task Lists through public HTTPS.

If the public path fails, restore the **captured exact** A/AAAA aliases to the
API Gateway regional target and hosted-zone IDs, remove the Lists ALB host
rule and Apache vhost introduced by the switch, and verify the preserved REST
Lambda `active` alias still serves the previously accepted version. Recheck
canonical TLS, authenticated Todoist reads and negative authorization. Do not
drop the Lists database, undo the additive migration, delete the verified
backup, or retire the candidate as part of an ingress rollback.

Read the latest dated implementation entries for the current release state.
Before activation, recheck database roles, protected inputs, exact image and
host-tool revisions, dual-tenant smoke, Lists ALB/Apache routing, Terraform/DNS
ownership, and `/srv` capacity for image, backup, and rollback artifacts.

Production publication supports the bounded `REGISTRY_LOGIN_HOST=ssh://personal-projects` for registry authentication with an existing remote Buildx builder when the canonical developer VM cannot reach ECR. Other endpoints are rejected. Local development orchestration retains the canonical socket.

The 0.10.2 durability patch declares `restart: unless-stopped` on the API only.
Its reviewed repeat-upgrade baseline accepts exact 0.10.1 provenance, all five
matching migration checksums and the six-table schema. The restored migrations
remain idempotent and add no business rows. Existing tagged/comment release
fixtures and imported source Loops remain preserved. Before staging the patch,
stop only the retained 0.9 API to free its port; retain its container, image,
release and backup artifacts. Active 0.10.1 remains live throughout candidate
validation and is the captured-route rollback target for the patch.
