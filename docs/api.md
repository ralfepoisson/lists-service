# REST API and Todoist Provider Contract

The formal Life2-facing contract is [`../openapi.yaml`](../openapi.yaml). This
guide explains operational semantics and the external Todoist assumptions
verified on 2026-07-31.

## REST behavior

- `GET /health` proves only Lambda/process liveness and is public.
- `GET /health/ready` calls Todoist for the configured project and requires the
  REST bearer token.
- `GET /v1/items?status=active|completed|all` defaults to `active`.
- `GET /v1/items.pdf` reads the current active items and returns a transient A4
  PDF attachment named `shopping-list.pdf`; the generated document is not stored.
- `POST /v1/items` returns `201` for a created task and `200` with
  `meta.alreadyExists=true` for an exact normalized active duplicate.
- `DELETE /v1/items/{itemId}` permanently deletes one task.
- `POST /v1/items/{itemId}/complete` closes one task.
- `POST /v1/items/{itemId}/reopen` reopens one completed task.
- `DELETE /v1/items?status=completed` deletes all completed tasks returned
  inside the configured rolling history window and requires
  `X-Confirm-Destructive-Action: true`.
- `GET|POST /v1/task-lists` lists or creates section-backed named lists.
- `GET|POST /v1/task-lists/{listId}/tasks` lists or creates scoped tasks;
  `PATCH`, `DELETE`, and `/complete` provide edit, removal, and completion.
- `PUT /v1/task-lists/{listId}/tasks/order` requires an exact active-task ID
  permutation and sends one Todoist `item_reorder` sync command.
- `DELETE /v1/task-lists/{listId}` requires destructive confirmation, closes
  every active task, and archives the section only after all closes succeed.

Nested mutations verify section-to-configured-project and task-to-section scope.
Legacy `/v1/items*` behavior remains unchanged.

All protected routes require `Authorization: Bearer <token>`. The token may be
the configured opaque automation credential or a Life2 JWT. JWT verification
pins `HS256`, issuer `life2.ralfe.me`, audience `account`, expiry/time claims,
non-empty `sub` and `email`, and the single configured `accountId`. JSON
responses use `data`/`meta` or `error`/`meta` envelopes with a correlation
request ID. The successful PDF route instead returns `application/pdf` with a
download content disposition; its errors retain the standard JSON envelope.

## Todoist provider contract

The implementation was checked against the
[official Todoist API v1 reference](https://developer.todoist.com/api/v1/) on
2026-07-31:

- base URL: `https://api.todoist.com/api/v1`;
- authentication: `Authorization: Bearer <token>`;
- active project tasks: `GET /tasks?project_id=...`, cursor-paginated as
  `results` plus `next_cursor`;
- task creation: `POST /tasks` with `content` and `project_id`;
- completion: `POST /tasks/{task_id}/close`;
- reopening: `POST /tasks/{task_id}/reopen`;
- deletion: `DELETE /tasks/{task_id}`;
- completed history:
  `GET /tasks/completed/by_completion_date`, cursor-paginated as `items` plus
  `next_cursor`, with `since`/`until` intervals no longer than three months;
- project-name resolution: `GET /projects/search`, followed by an exact
  case-insensitive match enforced by this service; and
- project creation: `POST /projects` with the configured `name`, returning the
  created project. Initialization calls this mutation only when the exact-name
  search returns zero projects and refuses to choose when more than one matches.

The current task-creation schema says content must be non-empty but does not
publish a maximum. This service chooses 500 Unicode code points as a
conservative, documented product-aligned limit; it never truncates.

Ordinary REST rate-limit quantities are not published. Reads retry only
`429`, `500`, `502`, `503`, and `504`, with bounded exponential backoff,
jitter, and `Retry-After` support. Permanent `400`/`401`/`403`/`404` failures
are not retried. Mutations are not blindly retried because the current REST
task-creation contract does not document an idempotency key; an ambiguous
network failure could otherwise create a duplicate or hide a completed delete.
Project provisioning follows the same no-blind-retry rule.

## Completed-history limitation

`COMPLETED_LOOKBACK_DAYS` defaults to 90 and accepts 1–90. Therefore
`status=completed`, `status=all`, reopen discovery by clients, and clear
completed cover only that rolling window. Archive access can also depend on the
Todoist account plan. These constraints are reported as limitations, never as
an empty-list success for history outside the supported window.

## Stable error codes

The implementation can return:

- `AUTHENTICATION_REQUIRED`
- `VALIDATION_ERROR`
- `ITEM_NOT_FOUND`
- `AMBIGUOUS_ITEM`
- `DESTRUCTIVE_ACTION_NOT_CONFIRMED`
- `ROUTE_NOT_FOUND`
- `UPSTREAM_AUTHENTICATION_FAILED`
- `UPSTREAM_RATE_LIMITED`
- `UPSTREAM_UNAVAILABLE`
- `INTERNAL_ERROR`

Provider bodies, tokens, and stack traces are not returned.
