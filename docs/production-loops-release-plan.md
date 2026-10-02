# Production Loops release plan (review required)

This plan describes the missing production boundary for the 0.9.0 Lists
checkout. It changes neither infrastructure nor the active 0.8.0 REST alias.
The current `lists.life-sqrd.com` route is Route 53 → API Gateway HTTP API →
REST Lambda `active` alias. The REST Lambda has no VPC attachment and no
`DATABASE_URL`; `AppConfig.fromRestEnvironment` now requires that value before
the controller starts. Terraform also omits the five Loop API Gateway routes.
The repository has no production Lists database, migration runner, or protected
database credential delivery path.

## Option A: keep Lambda and API Gateway

1. Provision a dedicated, backed-up Lists PostgreSQL database and role on a
   reviewed private endpoint. The existing production PostgreSQL host, if
   selected, currently exposes its database only to its local Docker network
   and loopback; a private VPC route, listener, TLS and narrowly scoped security
   group would need explicit design. An RDS database would be new paid
   infrastructure.
2. Attach only the REST Lambda to private subnets. Supply the database endpoint
   and credential at runtime from a protected secret, without a plaintext
   Terraform variable, Lambda environment value, state value, or log line.
   Give the Lambda role permission only for that secret and its own existing
   secrets. Keep Alexa independent of the database.
3. Establish Lambda egress to Todoist and AWS Secrets Manager from those
   subnets. A NAT path or reviewed private AWS endpoints plus outbound Todoist
   path is required. VPC attachment without that egress would break existing
   Shopping and Task Lists.
4. Run `001_loops.sql` with a separate migrator identity and captured backup
   and checksum evidence before publishing the candidate. Add the exact Loop
   API Gateway routes: `GET/POST /v1/loops`, `GET/PATCH /v1/loops/{loopId}`,
   `POST /v1/loops/{loopId}/close`.
5. Keep the `active` alias unchanged while invoking the published candidate
   directly with valid and invalid Life2 JWTs. Exercise persisted create,
   update, list, close and cross-tenant denial, plus existing authenticated
   Todoist reads. Only then select the accepted alias version.

This preserves the public API Gateway route and its alias rollback contract,
but adds private networking, managed egress, database access and a migration
mechanism. It is not a configuration-only change.

## Option B: use the existing EC2 PostgreSQL network

1. Create a dedicated `lists_service` database and least-privilege runtime
   role on the existing production PostgreSQL instance, with separate
   migration credentials. Keep its host binding loopback-only. Take and
   restore-test a database backup before migration.
2. Build an immutable Linux ARM64 Lists image from clean `main`. Run the REST
   entrypoint as a candidate container on the existing internal
   `personal-projects-postgresql` Docker network and a separate ingress
   network. Its PostgreSQL URL and tenant/Todoist/JWT secrets need root-owned,
   mode-0600 protected delivery, a non-logging parser, and explicit startup
   validation. Use only the tenant-bound production secrets already authorized
   for this service; verify the instance's AWS secret access before relying on
   `SECRET_PROVIDER=aws`, or use reviewed file-backed equivalents.
3. Run `001_loops.sql` through a separately scoped, one-shot migrator before
   starting the candidate. Reject unexpected schema/migration checksums and
   capture backup, migration and image digest evidence.
4. Give the candidate a loopback-only host port. Prove readiness, authenticated
   persisted Loop CRUD and isolation, existing Shopping/Task Lists reads,
   negative authorization and outbound Todoist access through that port.
5. Review a dedicated ALB/WAF/Apache host route, certificate coverage and
   Route 53 ownership for `lists.life-sqrd.com`. Terraform currently owns the
   API Gateway domain and A/AAAA aliases, so its ownership must be reconciled
   before any DNS change. Stage and test the new host route without selecting
   it; then perform a guarded ingress handoff with an exact rollback to the
   still-healthy API Gateway alias. Verify canonical HTTPS and signed-in UI
   behavior after handoff.

This uses an existing private database network and avoids a new VPC database
or NAT path. It requires a new guarded EC2 release contract and a public
ingress handoff. Do not reuse Master Data's activator, credentials or tables.

### Read-only host and AWS assessment on 2 October 2026

- The production host reports PostgreSQL accepting connections at
  `127.0.0.1:5432`; the Master Data release contract identifies its internal
  network as `personal-projects-postgresql`. This establishes a possible
  co-located database path, not a Lists database or a right to share Master
  Data's database role.
- The consolidated ALB's HTTPS listener already has an issued
  `*.life-sqrd.com` certificate. Its host rules and the production Apache
  `:8080` vhosts contain no `lists.life-sqrd.com` route. The existing Lists
  Route 53 A/AAAA records and custom domain are managed by this repository's
  API Gateway Terraform state.
- The production host instance role has no `secretsmanager` action in its
  reviewed inline policies or attached container-runtime policy. The
  file-secret REST entrypoint can run on EC2, but the current AWS tenant
  catalogue cannot simply be copied into its file mode: it references
  Secrets Manager token ARNs rather than mounted absolute file paths. A
  reviewed least-privilege role policy plus an AWS-capable HTTP composition,
  or a protected file catalogue and token delivery/rotation procedure, is
  required before candidate startup.
- ECR currently has no Lists repository, and the host has no Lists release
  activator, candidate environment, Apache site, ALB rule, or verified Lists
  PostgreSQL role/database. `/srv` has 6.9 GB free at 97% use; capacity for
  image plus retained rollback and backups must be checked during staging.

Option B now has a source-side, candidate-only release package, described in
[`ec2-candidate-runbook.md`](ec2-candidate-runbook.md). It binds an immutable
image digest and migration checksum, uses separately installed host tooling
and protected credentials, restore-tests a database backup, and requires real
loopback tenant acceptance. It has not been installed or run in production.
Host provisioning, real candidate acceptance and an independently reviewed
ingress handoff are still required before the DNS/ALB switch.

## Decision and release gates

Option B is the narrower infrastructure change **if** the existing production
PostgreSQL capacity, protected secret delivery, certificate and ALB/WAF/Apache
route can be verified. It still has a significant ingress change. Option A is
preferable if preserving the current API Gateway route outweighs the new
private network, egress and database infrastructure. Neither can yet serve
production Loops from the current checkout.

For either option, require a reviewed owner and rollback for the database and
ingress, protected credentials, a restore-tested backup, migration result,
immutable candidate identity, all source and real PostgreSQL integration
gates, direct authenticated candidate acceptance (including denial across
tenants), and a post-activation signed-in Loop flow. Preserve the 0.8.0 Lambda
alias until those gates pass. A public heartbeat or anonymous 401 alone does
not establish Loops persistence or tenant safety.
