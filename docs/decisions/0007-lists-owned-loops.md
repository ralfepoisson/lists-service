# ADR 0007: Persist Loops in Lists-owned PostgreSQL tables

## Status

Accepted in source on 30 September 2026. The local migration and signed-in
runtime were verified on 2 October 2026. Production migration and network
acceptance remain pending.

## Context

An ongoing obligation can outlive any one task. It needs an outcome required for
closure and references to related tasks, entities, assets, appointments, emails, documents, and
other records. An external AI agent may independently read Plaud notes, but
Life2 must not hold a Plaud credential or call Plaud directly.

## Decision

- Lists owns a tenant-scoped `loops` table and ordered `loop_related_records`
  references in the native `lists_service` PostgreSQL database.
- Todoist remains authoritative for Shopping and Task List content; Loop record
  references are opaque pointers and never duplicate source records.
- Only a verified Life2 JWT supplies `accountId` and `sub`. Static automation
  credentials are forbidden from Loop routes.
- An agent can create or update a Loop through allowlisted Life2 MCP operations.
  Closing requires `{ "confirmed": true }` to record an explicit outcome
  confirmation.
- The Lists service has no Plaud SDK, endpoint, token, or direct integration.

## Consequences

Loop availability depends on the Lists migration and PostgreSQL readiness, while
its referenced records remain independently available from their owning
services. A source record can be absent or inaccessible without changing the
Loop; the UI and agent preserve the supplied reference rather than inventing
its state.

The existing production REST Lambda is outside a VPC and the Lists Terraform
release has no PostgreSQL credential or migration path. A release of this
revision must first add private database connectivity and a protected migration
gate; the existing Shopping/Task Lists production alias must remain selected
until direct candidate acceptance includes real Loop persistence.
