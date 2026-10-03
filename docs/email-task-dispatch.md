# Email task dispatch

Task creation and comments accept an optional UUID Idempotency-Key, forwarded as Todoist X-Request-Id. POST /v1/task-lists/{listId}/tasks/{taskId}/comments accepts {content} after verified tenant/list membership. Email-agent delegations are restricted to task list reads and create/comment/complete operations. See Life2 Agents for durable plans and email/task links.
