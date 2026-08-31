# ADR 0005: Select tenant Todoist projects through a server-side catalogue

> Shopping/Alexa identity details in this decision are superseded by
> [ADR 0006](0006-bind-all-shopping-channels-to-tenant-catalogue.md).

## Status

Accepted and implemented on 18 August 2026. This decision supersedes ADR 0004
for Task Lists and supersedes the single-project restriction in ADR 0002 only
for the REST Task Lists surface. Live multitenant provider acceptance and
production deployment remain separate evidence boundaries.

## Context

Life2 Task Lists must show the existing lists available in each connected
tenant's Todoist account. A Todoist project is the provider's list boundary.
The earlier section model could expose only sections inside one operator-owned
project and therefore could not represent each tenant's existing projects.

This release does not implement Todoist OAuth, browser onboarding, disconnect,
or token refresh. Credentials are provisioned by an operator through protected
server-side configuration.

## Decision

- A Todoist project is a Life2 `TaskList`; a Todoist task belongs to the project
  identified by the list ID.
- A verified Life2 JWT supplies the only tenant selector: its non-empty
  `accountId`. Request data cannot select another account.
- A protected catalogue maps each unique `accountId` to a token-secret
  reference. The catalogue stores no token value; each token is held in a
  separate protected secret.
- Task Lists and connection routes require the Life2 JWT principal and reject
  the static automation principal.
- `GET /v1/todoist/connection` reveals only `connected` or `not_connected` and
  always returns `canManageConnection: false`.
- Browser authorization-start and disconnect requests are rejected. Catalogue
  changes remain an operator-controlled deployment action.
- Legacy Shopping, its PDF/automation routes, and Alexa retain the original
  owner token and configured project. Their identity boundary is not reused to
  select a tenant Task Lists connection.
- Deleting a Task List completes active project tasks and archives the project
  only after all completions succeed. Inbox is never archived.

## Consequences

Todoist remains authoritative for projects, tasks, order, and completion; Lists
adds no database or shadow copy. Multitenancy is account-scoped rather than
user-`sub`-scoped, and connections cannot be self-serviced in this release.
Catalogue and referenced-secret IAM must be updated together. A missing entry
is a visible `not_connected` state and Task Lists operations fail closed without
falling back to the legacy token.
