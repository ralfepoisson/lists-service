# Architecture

## Status

This document describes the implemented version 1 architecture. Source,
component tests, build output, and static infrastructure contracts are present
in the active checkout. After an earlier configured credential returned HTTP
403, the deployed local boundary accepted nine real Todoist item mutations and
returned all nine through a confirming active-list read. Production REST
Lambda version 2, canonical API Gateway TLS/authentication, and real persisted
Todoist reads were verified on 8 August 2026. Alexa invocation and CI remain
unverified.

The package structure is visualized in
[`architecture/solution-architecture.puml`](architecture/solution-architecture.puml).
The logical provider-backed data model is visualized in
[`architecture/erd.puml`](architecture/erd.puml).

## Context

`lists-service` provides two private channels over one household shopping list:

- an Alexa custom skill for voice operations; and
- an authenticated REST API for the Life2 webapp and personal automations.

Todoist is the sole system of record. Each active task in one configured Todoist
project represents an active shopping-list item. Todoist's native completion
state represents a purchased/completed item. No application database or native
Alexa-list synchronization is proposed.

## Runtime structure

Two Lambda entry points provide explicit channel separation:

1. **REST Lambda** receives API Gateway HTTP API events, authenticates requests,
   validates transport data, invokes shared application use cases, and serializes
   response envelopes.
2. **Alexa Lambda** verifies Alexa requests and configured skill identity,
   translates intents/dialog state, invokes the same application use cases, and
   renders concise speech.

Both composition roots construct shared domain/application objects and the same
Todoist-backed repository adapter. This choice is recorded in
[ADR 0001](decisions/0001-separate-lambda-entry-points.md).

When configuration supplies only `TODOIST_PROJECT_NAME`, composition uses the
`TodoistProjectResolver` as a provisioner: it reuses one exact project, creates
one if none exists, and refuses multiple exact matches. The resulting stable ID
is injected into the repository, so item operations never search projects.

```text
Alexa custom skill ---> Alexa Lambda adapter --\
                                                 > Shared use-case objects
API Gateway HTTP API -> REST Lambda adapter ----/          |
                                                            v
                                             ShoppingListRepository port
                                                            |
                                                            v
                                         Todoist repository + typed client
                                                            |
                                                            v
                                                Official Todoist REST API
```

## Object boundaries

### Domain

The domain owns shopping-list concepts and deterministic policy without knowing
about Lambda, Alexa, API Gateway, Secrets Manager, or Todoist transport:

- `ShoppingListItem` entity/read model;
- normalized item-content value object;
- deterministic matcher and match-result types;
- domain/application error types.

### Application

Use-case objects coordinate behavior through narrow ports:

- list items;
- add item with duplicate policy;
- remove item;
- complete item;
- reopen item where the current provider contract supports it;
- clear completed items with explicit confirmation;
- check readiness.

The principal outbound port is `ShoppingListRepository`. Replaceable security,
secret, identity-resolution, logging, clock, and delay behavior should also be
expressed through focused interfaces when necessary for testability and
separation.

### Adapters

- `TodoistShoppingListRepository` maps the application port to a typed Todoist
  client.
- The typed client centralizes authentication, timeouts, bounded transient
  retries, pagination, response validation, and upstream error translation.
- REST objects map HTTP input/authentication to use cases and serialize stable
  envelopes/error codes.
- Alexa handler objects map request types and intents to use cases, elicit
  missing slots, manage destructive confirmation, and produce speech.
- AWS and read-only-file secret-provider adapters plus the structured logger
  isolate operational details. File-backed secrets are restricted to the local
  Compose runtime; Lambda continues to use AWS Secrets Manager.

### Composition and deployment

REST and Alexa composition roots build the object graph separately. Shared
packages are bundled into both deployable artifacts. Terraform publishes
immutable function versions, preserves the accepted versions behind `active`
aliases, and provisions API Gateway, the canonical regional custom domain,
Route53 aliases, least-privilege roles, log retention, secret reads, access
logs, alarms, integrations, permissions, and outputs. A candidate can be
invoked directly before alias activation; rollback is an explicit alias move
to a retained accepted version. Alexa resources remain absent until the real
private skill ID is configured.

The local REST executable has a distinct composition root that imports only the
file secret adapter; AWS Secrets Manager is excluded from its bundle. Its
CommonJS bundle accommodates the JWT dependency's runtime module format, while
the Lambda bundles remain ESM. On macOS, the root launcher copies the required
mode-600 files into private Docker-readable storage before mounting them
read-only; source files remain ignored and never enter images or logs.

## Key flows

### Add item

1. A channel adapter validates input and creates/propagates a request ID.
2. The add use case normalizes content and lists active items through the port.
3. An exact normalized duplicate returns the existing item without mutation.
4. Otherwise the repository creates a Todoist task in the configured project.
5. The channel adapter returns either the REST envelope/status or Alexa speech.

### Remove or complete by Alexa text

1. The adapter obtains the item phrase, eliciting it when absent.
2. The use case retrieves eligible items and applies deterministic matching.
3. No match yields not-found; several plausible matches yield ambiguity.
4. Only one unambiguous match may be mutated automatically.
5. Bulk destructive behavior requires a separate confirmation state.

### Authentication and secrets

`GET /health` is public and proves only that the Lambda responds. Other REST
routes, including readiness, require bearer-token validation. A composite
authentication strategy accepts either the constant-time opaque automation
token or a Life2 JWT whose signature, algorithm, issuer, audience, time claims,
identity claims, and configured account are verified. Runtime secret adapters
retrieve the REST token, Life2 verification key, and Todoist token from an
authorized secret store; configuration contains identifiers, not secret
values. Alexa requests are
checked against the configured skill ID. These mechanisms are implemented and
locally tested where deterministic; their deployed behavior remains unverified.

## Trust boundaries and privacy

- Internet/API Gateway to REST Lambda
- Alexa service to Alexa Lambda
- Lambda runtime to AWS secret store
- Lambda runtime to Todoist
- Runtime logs to CloudWatch
- Life2 Webapp through the same-origin `/api/lists` proxy to API Gateway
- Life2 local Webapp through Nginx to the optional `lists-api` Compose service

Untrusted transport/provider payloads must be validated before entering the
domain. Tokens, full Alexa payloads, and sensitive item content must not appear
in normal logs. Structured logs retain correlation and operational status
without exposing credentials.

## Data ownership

Todoist owns task identity, content, project association, creation timestamps,
completion state, and any available completion timestamps. The application
exposes a stable logical representation but does not persist a shadow copy.
ADR 0002 records the decision.

## Architecture verification

Implementation must add evidence for:

- dependency direction (domain independent of adapters);
- both adapters using the same application objects;
- port/adapter contract behavior;
- separate deployable entry points;
- official current Todoist API semantics;
- Terraform validation and deployed AWS topology; and
- real Todoist and private Alexa smoke tests.

Until that evidence is recorded, the diagrams and flows are design intent only.
