# ADR 0006: Bind every Shopping channel to the tenant catalogue

## Status

Accepted and implemented.

## Decision

Shopping REST, Alexa, and automation authenticate as either a verified Life2
principal or an explicitly configured deployment service principal. Both carry
an `accountId`; the application resolves that account through the protected
tenant connection catalogue and constructs Shopping services using only the
referenced tenant token.

The automation token and Alexa deployment cannot accept an account identifier
from a request. They are bound to `LIFE2_ALLOWED_ACCOUNT_ID`. Task Lists and
connection-management routes continue to require a verified Life2 JWT because
those capabilities are broader than the deployment-bound Shopping contract.

There is no global Todoist runtime-token fallback. The former
`TODOIST_TOKEN_SECRET_ARN` setting remains only for explicit operator utilities.

## Consequences

- Every runtime provider call has an explicit tenant authority.
- A missing catalogue entry fails closed instead of falling back to an owner.
- Local and AWS runtimes must mount or authorize every referenced token secret.
- Each Alexa or automation deployment represents exactly one configured
  account, while the REST JWT path remains multitenant.
