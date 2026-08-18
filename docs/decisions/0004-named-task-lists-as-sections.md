# ADR 0004: Model named task lists as Todoist sections

## Status

Superseded on 18 August 2026 by
[ADR 0005](0005-tenant-todoist-projects-as-task-lists.md). This file remains the
historical record of the earlier implemented section-based slice; it is not the
current Task Lists runtime model.

## Decision

The configured Todoist project remains the service boundary. Each named Life2
task list is a section in that project and each task is scoped to the section.
Legacy `/v1/items*` operations remain unchanged for shopping-list compatibility.

Mutations verify section-to-project and task-to-section ownership. Reordering
requires an exact permutation of active task IDs and sends one Todoist
`item_reorder` sync command. Deleting a Life2 list closes every active task and
archives the section only after all closes succeed. Provider section deletion
is not used because it destroys tasks rather than retaining completion state.

## Consequences

No database or unrelated-project discovery is introduced. Close-and-archive is
retry-recoverable but not atomic; real Todoist acceptance must verify archived
section completion history before production behavior is claimed.
