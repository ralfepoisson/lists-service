# ADR 0002: Todoist as the system of record

- **Status:** Accepted and implemented; real provider not yet verified
- **Date:** 2026-07-31
- **Requirements:** `LST-SCP-002`, `LST-TOD-004`

## Context

The product objective is a Todoist-backed household shopping list exposed
through Alexa and REST. Introducing application persistence would create
synchronization, conflict, recovery, security, cost, and operational concerns
that the version 1 scope does not require.

The prompt requires one dedicated Todoist project. Each task represents an item,
and Todoist's native completion state represents purchase/completion.

## Decision

Todoist is the sole authoritative datastore for version 1.

- One configured Todoist project contains the shopping-list tasks.
- Todoist task IDs are exposed as shopping-list item IDs.
- Active and completed state is mapped from Todoist's supported task semantics.
- The service persists no shadow item database or event ledger.
- `TODOIST_PROJECT_ID` is preferred. If only a project name is supplied, a
  startup/deployment utility may resolve it and persist/configure the ID so
  requests do not repeatedly scan projects.

## Rationale

- Maintains one source of truth across voice and REST channels.
- Avoids synchronization and conflict-resolution behavior.
- Keeps the deliberately small service within its product scope.
- Uses Todoist's native task lifecycle rather than recreating it.

## Consequences

- Todoist availability and rate limits affect list operations.
- Provider capabilities constrain completed-item retrieval and reopening.
- The adapter must handle pagination, timeouts, transient retry, validation, and
  application-level error translation.
- Real provider smoke evidence is needed; mocked HTTP tests alone are
  insufficient.
- Migration away from Todoist would require another repository adapter and a
  deliberate data-migration plan.

## Alternatives considered

### Application database plus Todoist synchronization

Rejected because it creates two writers/sources of truth and speculative
infrastructure.

### Alexa built-in list as authority

Rejected because the prompt requires a custom skill, explicitly excludes native
Alexa-list synchronization and discontinued list-management APIs, and requires
Todoist authority.

### In-memory or file persistence

Rejected because Lambda execution environments are ephemeral and neither option
is an appropriate shared durable store.

## Verification

The adapter contract was checked against official Todoist API v1 documentation
on 2026-07-31 and is covered by intercepted HTTP tests. A secret-safe,
explicitly authorized smoke test against a dedicated Todoist project remains
required for real-boundary acceptance.
