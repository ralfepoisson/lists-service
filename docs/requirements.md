# Requirements and Acceptance Evidence

## Purpose and status

This document translates the initial implementation prompt into stable,
traceable requirements. The identifiers are durable: do not renumber or reuse
them. Retired requirements remain recorded with their disposition.

As of 2026-07-31, these requirements map to implementation and local/static
evidence recorded in the implementation log. Real Todoist, AWS, Alexa, and CI
acceptance remains pending and is not implied by passing local tests.

## Evidence convention

For each requirement, acceptance requires all applicable evidence types:

- **Code**: the implementing production path in the active checkout.
- **Automated**: a focused test and its passing command/result.
- **Contract**: OpenAPI, Alexa model, configuration, or infrastructure contract.
- **Real boundary**: an opt-in call through the real provider or deployed
  boundary when provider behavior is material.
- **Documentation**: operator/developer instructions sufficient to reproduce
  the behavior without hidden knowledge.

Mocks may isolate a boundary in unit or integration tests, but mocked results
are not evidence that Todoist, Alexa, API Gateway, Secrets Manager, Lambda, or
CloudWatch works in reality.

## Product and scope

| ID          | Requirement                                                                                                                                                                                                 | Acceptance evidence                                                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| LST-SCP-001 | Provide one shopping list shared by a private Alexa custom skill and an authenticated REST API.                                                                                                             | Code for both adapters using shared services; REST integration and Alexa fixture tests; deployed smoke evidence for each channel. |
| LST-SCP-002 | Todoist is the authoritative datastore, using one configured Todoist project; no separate application database is introduced without a superseding ADR.                                                     | Repository adapter and configuration code; ADR 0002; real Todoist project smoke test.                                             |
| LST-SCP-003 | Printing, native Alexa-list synchronisation, public certification, UI, multi-household tenancy, LLM matching, purchasing, scanning, meal planning, and inventory management are out of scope for version 1. | Repository review; README limitations; no contradicting infrastructure or runtime path.                                           |

## Architecture and implementation method

| ID          | Requirement                                                                                                                                                                  | Acceptance evidence                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| LST-ARC-001 | Domain code has no dependency on Alexa, Lambda, API Gateway, or Todoist transport details.                                                                                   | Dependency review or architecture test; solution diagram aligned with code.               |
| LST-ARC-002 | Define a `ShoppingListRepository` port and a Todoist adapter implementing it.                                                                                                | Interface, adapter, contract tests, and architecture documentation.                       |
| LST-ARC-003 | Alexa and REST adapters invoke the same application services and do not duplicate list-management rules.                                                                     | Code review; service tests reused by both adapter suites.                                 |
| LST-ARC-004 | Use strict TypeScript, npm, the ASK SDK, AWS-supported Node.js LTS, Lambda, API Gateway HTTP API, Terraform, OpenAPI 3.1, structured JSON logging, and GitHub Actions.       | Compiler/package/IaC/spec/workflow files; CI and Terraform validation results.            |
| LST-ARC-005 | Production code follows object-oriented design with cohesive objects, dependency inversion, and pragmatic SOLID/design-pattern use; avoid function-only script architecture. | Code review against implementation guidelines; architecture and implementation-log entry. |
| LST-ARC-006 | Use separate REST and Alexa Lambda entry points sharing common domain/application packages, unless a later ADR supersedes this decision.                                     | ADR 0001; Terraform/package structure; build and adapter tests.                           |

## Shopping-list behavior

| ID          | Requirement                                                                                                                                                                | Acceptance evidence                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| LST-FUN-001 | List items with `status=active                                                                                                                                             | completed                                                                                                    | all`, defaulting to active; expose the logical item fields specified by the prompt. | `GET /v1/items` OpenAPI contract and REST tests; adapter mapping tests; real Todoist retrieval smoke. |
| LST-FUN-002 | Alexa says the list is empty when appropriate, reads all items up to five, and for longer lists reads the first five plus the remaining count.                             | Application speech-policy unit tests and Alexa fixture tests.                                                |
| LST-FUN-003 | Add a trimmed, non-empty item without silent truncation and enforce a documented maximum aligned with the current Todoist limit.                                           | Validation tests; OpenAPI constraint; official-API research record; real creation smoke.                     |
| LST-FUN-004 | Detect exact normalized active duplicates conservatively; return the existing item with `alreadyExists: true`, using REST 200 for an existing item and 201 for a new item. | Normalization/duplicate unit tests, REST and Alexa tests, real Todoist smoke.                                |
| LST-FUN-005 | Remove an item by ID over REST and by deterministic text matching over Alexa; distinguish deletion from completion.                                                        | `DELETE /v1/items/{itemId}` contract; matching/service/adapter tests; real deletion smoke.                   |
| LST-FUN-006 | Complete an item by ID over REST and by deterministic text matching over Alexa.                                                                                            | Complete endpoint contract; service and Alexa tests; real Todoist completion smoke.                          |
| LST-FUN-007 | Reopen a completed item over REST when supported by the current official Todoist API; any omitted voice support is documented precisely.                                   | Current official API evidence; endpoint and adapter tests; real reopen smoke or explicit documented blocker. |
| LST-FUN-008 | Clear completed items only with explicit confirmation: REST header `X-Confirm-Destructive-Action: true` and an Alexa confirmation turn; return the deletion count.         | OpenAPI header contract; confirmation unit/adapter tests; real controlled smoke.                             |
| LST-FUN-009 | Exact case-insensitive matching is preferred; conservative normalized matching may follow; ambiguous or absent matches never mutate data.                                  | Matching unit tests covering exact, normalized, ambiguous, and not-found outcomes.                           |
| LST-FUN-010 | Provide unauthenticated `GET /health` without secret disclosure and authenticated `GET /health/ready` for Todoist connectivity.                                            | OpenAPI; auth/routing tests; deployed health and readiness calls.                                            |

## REST contract and security

| ID          | Requirement                                                                                                                                                                                            | Acceptance evidence                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| LST-API-001 | Use consistent success/error JSON envelopes with `meta.requestId` and stable application error codes.                                                                                                  | OpenAPI schemas; serialization and integration tests.                                   |
| LST-SEC-001 | All REST routes except `/health` require either the safely compared strong automation bearer token or a fully verified Life2 JWT; authentication remains replaceable behind adapters.                  | Auth strategy/code tests; secret IAM/Terraform; deployed unauthorized/authorized calls. |
| LST-SEC-002 | Retrieve Todoist, REST, and Life2 verification secrets securely at runtime; commit no real tokens or populated environment files and avoid plaintext secret values in Terraform state.                 | Secret scan; Terraform review; deployment instructions and runtime smoke.               |
| LST-SEC-003 | Verify incoming Alexa requests against configured `ALEXA_SKILL_ID`; isolate household/user resolution behind an interface.                                                                             | Configuration and Alexa adapter tests; real development-skill invocation.               |
| LST-SEC-004 | Validate HTTP inputs, require destructive confirmation, return 401 for invalid authentication, and expose neither stack traces nor raw upstream errors.                                                | Unit/integration/security tests and deployed negative calls.                            |
| LST-SEC-005 | Apply least-privilege IAM and grant only required secret reads.                                                                                                                                        | Terraform plan review and deployed IAM inspection.                                      |
| LST-SEC-006 | No unresolved critical dependency vulnerability is accepted without a documented exception.                                                                                                            | Lockfile audit command/result and exception record if applicable.                       |
| LST-SEC-007 | Life2 JWT verification pins HS256, issuer `life2.ralfe.me`, audience `account`, time and identity claims, and the one configured allowed `accountId`; the signing key is never exposed to the browser. | JWT positive/negative tests, composition review, and deployed webapp/API call.          |

## Todoist integration

| ID          | Requirement                                                                                                                                                                                                                                        | Acceptance evidence                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| LST-TOD-001 | Before coding the adapter, verify the current official Todoist base URL, stable API version, authentication, filtering, create/complete/reopen/delete operations, pagination, completed retrieval, and retry guidance.                             | Dated official-source references in API/implementation documentation.               |
| LST-TOD-002 | Centralize Todoist HTTP behavior in a typed client with timeouts, pagination, descriptive permitted user agent, response validation, and application-level error mapping.                                                                          | Client code and tests for pagination, malformed responses, timeout, and errors.     |
| LST-TOD-003 | Retry idempotent reads only for 429/500/502/503/504 using bounded exponential backoff with jitter and respect `Retry-After`; do not retry permanent failures or blindly retry mutations whose outcome may be ambiguous.                            | Deterministic client tests for status/retry bounds; API limitation documentation.   |
| LST-TOD-004 | Support `TODOIST_PROJECT_ID` preferentially. When configured by `TODOIST_PROJECT_NAME`, initialize once by reusing the one exact match or creating the project when none exists; refuse ambiguity and never scan projects on every item operation. | Configuration/provisioner tests; deployed configuration and real-provider evidence. |

## Alexa behavior

| ID          | Requirement                                                                                                                                                                            | Acceptance evidence                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| LST-ALX-001 | Implement an en-GB custom skill with configurable invocation name defaulting to `household list`; structure locales for easy en-US addition.                                           | Interaction-model JSON validation and Developer Console import.           |
| LST-ALX-002 | Implement launch, help, cancel, stop, add, list, remove, complete, and clear-completed handling with the prompt's natural utterance coverage.                                          | Alexa model and handler fixture tests for every request/intent.           |
| LST-ALX-003 | Accept arbitrary shopping phrases, including quantities, elicit a missing item slot, and confirm bulk destructive action.                                                              | Interaction model, dialog configuration, and fixture tests.               |
| LST-ALX-004 | Keep speech concise, conceal raw provider errors, provide a brief retry response for temporary failures, and correlate safely logged failures.                                         | Speech-policy/error-handler tests and log assertions.                     |
| LST-ALX-005 | Document private development-skill creation, model installation, endpoint setup, testing, Echo-device access, environment, and secrets; account linking is not required for version 1. | Alexa setup guide followed successfully by a developer; real skill smoke. |

## Configuration, observability, and infrastructure

| ID          | Requirement                                                                                                                                                                                                      | Acceptance evidence                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| LST-OPS-001 | Validate required configuration at cold start, including the prompt-specified environment variables; provide placeholders only in `.env.example`.                                                                | Configuration tests and cold-start failure test; secret scan.                                        |
| LST-OPS-002 | Emit structured JSON logs with correlation, channel, operation, duration, status, and safe upstream status; never log credentials/full Alexa payloads, and keep item content at disabled-by-default debug level. | Logger/redaction tests and inspected CloudWatch samples.                                             |
| LST-OPS-003 | Terraform provisions Lambda roles/functions, HTTP API integration/routes, retained log groups, required secret-read permissions, access logging, practical alarms, and Alexa configuration outputs.              | `terraform fmt -check` and `terraform validate`; plan review; deployed-resource evidence.            |
| LST-OPS-004 | Make environments separable without unnecessary platform abstraction and document build, package, secret provisioning, plan, apply, REST URL, and Alexa endpoint procedures.                                     | Terraform variables/workspace contract and README deployment rehearsal.                              |
| LST-OPS-005 | Publish immutable candidates, activate only accepted Lambda versions through aliases, retain explicit rollback, and expose REST only at the canonical TLS custom domain with a locked remote state backend.      | Release asset tests; candidate acceptance; alias, DNS, TLS, state-versioning, and rollback evidence. |

## Development, testing, CI, and documentation

| ID          | Requirement                                                                                                                                                                        | Acceptance evidence                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| LST-DEV-001 | Provide commands for format, lint, strict type-check, test, build, local REST execution, and representative Alexa fixture invocation.                                              | Commands documented and run successfully from a clean checkout.            |
| LST-DEV-002 | Provide example curl calls for every REST endpoint.                                                                                                                                | API/README examples checked against OpenAPI and local/deployed responses.  |
| LST-TST-001 | Use test-driven development for domain and application behavior, recording red-green-refactor evidence in the implementation log.                                                  | Chronological log entries and focused passing tests covering prompt cases. |
| LST-TST-002 | Todoist adapter tests cover success, pagination, create, complete, supported reopen, delete, 401/403/404/429, transient 5xx, timeout, and malformed response.                      | Adapter suite and command result.                                          |
| LST-TST-003 | REST integration and Alexa fixture suites exercise routing/handlers through application services without calling live Todoist.                                                     | Passing integration suites; architecture boundary review.                  |
| LST-TST-004 | Any live Todoist smoke tool is opt-in, requires an explicit flag and dedicated project, uses a unique item, and cleans up after partial failure.                                   | Tool code/tests plus a separately authorized real run result.              |
| LST-CI-001  | Pull requests and pushes run lockfile install, format check, lint, type-check, tests, build, Terraform format/validation, and a sensible security audit; CI does not deploy.       | Workflow review and successful GitHub Actions run.                         |
| LST-DOC-001 | Maintain a comprehensive root README and dedicated architecture, Alexa, API, OpenAPI, interaction-model, ADR, PlantUML, guidelines, and newest-first implementation-log artifacts. | Documentation link/diagram validation and manual completeness review.      |
| LST-DOC-002 | A developer can deploy and configure the system using the README alone.                                                                                                            | Fresh-environment documentation rehearsal with recorded gaps resolved.     |

## Completion gate

The service must not be described as production-ready until every applicable
security criterion and functional acceptance criterion has current evidence.
Passing tests alone does not prove external integrations or deployment.
