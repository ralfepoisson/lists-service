# Codex Implementation Prompt: Todoist-Backed Alexa Shopping List

## Role

Act as a senior TypeScript, AWS serverless, Alexa Skills Kit, REST API, security, and test-automation engineer.

Build a production-quality but deliberately small system in which:

1. **Todoist is the authoritative shopping-list datastore.**
2. A private **Alexa custom skill** lets a user add, remove, complete, and hear shopping-list items by voice.
3. A documented **REST API** exposes the same operations for other personal automations.
4. Printing is explicitly out of scope for this version.

Do not merely produce a design. Implement the working code, infrastructure, tests, documentation, and Alexa interaction model in this repository.

---

## Product objective

The user should be able to say commands similar to:

- “Alexa, ask Household List to add milk.”
- “Alexa, ask Household List to add two bottles of sparkling water.”
- “Alexa, ask Household List what is on my list.”
- “Alexa, ask Household List to remove milk.”
- “Alexa, ask Household List to mark milk as bought.”
- “Alexa, ask Household List to clear completed items.”

The exact invocation name must be configurable because Amazon may reject or reserve some names. Use `household list` as the default unless Alexa’s rules make it invalid.

The same list must be accessible through authenticated REST endpoints.

---

## Required technology choices

Use the following stack unless the repository already establishes an equivalent compatible standard:

- **Language:** TypeScript with strict compiler settings
- **Runtime:** Current AWS-supported Node.js LTS runtime
- **Package manager:** npm
- **Alexa SDK:** ASK SDK for Node.js
- **Hosting:** AWS Lambda
- **HTTP entry point:** Amazon API Gateway HTTP API
- **Infrastructure as code:** Terraform
- **Todoist integration:** Official Todoist REST API
- **Secret storage:** AWS Secrets Manager or encrypted SSM Parameter Store
- **Logging:** Structured JSON logs through CloudWatch
- **Tests:** Vitest or Jest
- **Linting/formatting:** ESLint and Prettier
- **API specification:** OpenAPI 3.1
- **CI:** GitHub Actions

Keep third-party dependencies limited and justify any non-obvious dependency in the README.

---

## Architectural principles

Follow these boundaries:

- The **domain layer** must not depend on Alexa, API Gateway, Lambda, or Todoist-specific transport details.
- Define a `ShoppingListRepository` port/interface.
- Implement a `TodoistShoppingListRepository` adapter.
- Both Alexa handlers and REST handlers must call the same application services.
- Do not duplicate list-management logic between the Alexa and REST channels.
- Keep modules small, typed, testable, and cohesive.
- Prefer explicit code over unnecessary framework abstraction.
- Do not introduce a separate database unless a technically unavoidable requirement emerges.
- Todoist remains the system of record.

Target architecture:

```text
Alexa Custom Skill ─┐
                    ├─> Lambda application services ─> Todoist REST API
REST API Gateway ───┘
```

It is acceptable to use either:

1. one Lambda with separate request adapters; or
2. separate Alexa and REST Lambdas sharing a common package.

Choose the simpler deployment that still provides clear separation and good testability. Document the decision.

---

## Todoist data model

Represent the shopping list as a dedicated Todoist project.

Configuration must support either:

- `TODOIST_PROJECT_ID`, preferred; or
- `TODOIST_PROJECT_NAME`, with a startup/deployment utility that resolves and persists the corresponding ID.

Do not repeatedly search all Todoist projects during every request.

Each active Todoist task in this project represents an active shopping-list item.

Use Todoist’s native completion state for purchased/completed items.

A shopping-list item exposed by the application should have this logical shape:

```typescript
interface ShoppingListItem {
  id: string;
  content: string;
  description?: string;
  isCompleted: boolean;
  createdAt?: string;
  completedAt?: string;
}
```

Adapt the exact Todoist response fields as required by the current official API.

---

## Functional requirements

### 1. List active items

Return all active items in the configured project.

Alexa behaviour:

- When empty: “Your shopping list is empty.”
- For up to five items, read all items.
- For more than five items, read the first five and say how many additional items remain.
- Keep the spoken response concise.
- Ask a useful follow-up question only when it improves the interaction.

REST endpoint:

- `GET /v1/items`
- Optional query parameter: `status=active|completed|all`
- Default: `active`

### 2. Add an item

Create a Todoist task in the configured project.

Alexa intent slot should accept natural product phrases, including quantities, such as:

- milk
- two bottles of sparkling water
- cat food
- dishwasher tablets

REST endpoint:

- `POST /v1/items`

Request:

```json
{
  "content": "two bottles of sparkling water"
}
```

Response: `201 Created` with the created logical item.

Validation:

- Trim whitespace.
- Reject empty values.
- Enforce a reasonable maximum length aligned with Todoist limits.
- Do not silently truncate.
- Preserve meaningful quantities and descriptors.

### 3. Remove an item

Deletion is destructive and must be distinct from completion.

REST endpoint:

- `DELETE /v1/items/{itemId}`

Alexa should support removal by spoken item text rather than requiring an ID.

Matching rules for Alexa removal:

1. Normalise case and surrounding whitespace.
2. Prefer exact case-insensitive content match.
3. Otherwise permit a conservative normalised match.
4. Do not delete an item when several plausible matches exist.
5. When ambiguous, ask the user which item they mean.
6. When no match exists, say that the item was not found.
7. Require confirmation before deleting more than one item.

For the first version, do not implement probabilistic or LLM-based matching.

### 4. Complete an item

REST endpoint:

- `POST /v1/items/{itemId}/complete`

Alexa examples:

- “mark milk as bought”
- “complete milk”
- “cross milk off”

Use the same deterministic matching and ambiguity rules as removal.

### 5. Reopen a completed item

REST endpoint:

- `POST /v1/items/{itemId}/reopen`

Alexa support is desirable but may be omitted from the first voice interaction model if the official Todoist API makes completed-task retrieval or reopening materially more complex. If omitted, document the limitation precisely and still implement the REST operation if supported.

### 6. Clear completed items

REST endpoint:

- `DELETE /v1/items?status=completed`

This operation must require an explicit confirmation mechanism:

- REST: require header `X-Confirm-Destructive-Action: true`
- Alexa: use a confirmation turn before deleting

Return the number of deleted items.

### 7. Health endpoint

- `GET /health`

It must confirm that the Lambda is running without exposing secrets.

A deeper Todoist connectivity check may be exposed separately as:

- `GET /health/ready`

Protect the readiness endpoint with the same API authentication as other REST endpoints.

---

## REST API security

This is a personal system, but do not leave the REST API public.

Implement one of these approaches:

### Preferred initial approach

API Gateway Lambda authoriser or application middleware validating a strong bearer token stored as a secret.

Expected header:

```text
Authorization: Bearer <token>
```

Requirements:

- Constant-time token comparison where practical.
- Never log the token.
- Return `401` for missing or invalid authentication.
- Keep `/health` unauthenticated.
- Protect all other endpoints.

Design the authentication adapter so it can later be replaced by OAuth or JWT validation without changing domain services.

Generate and document a secure token setup process. Do not commit a real token.

---

## Alexa skill requirements

### Skill type

Build a **custom Alexa skill**, not a deprecated Alexa List Skill.

Do not use Amazon’s discontinued Alexa List Management API.

The skill owns no list state. It calls the shared application services, which call Todoist.

### Locale

Provide an interaction model for:

- `en-GB` as the primary locale

Structure the model so `en-US` can be added easily. An `en-US` model may also be provided if it requires little duplication.

### Required intents

Implement:

- `AMAZON.LaunchRequest`
- `AMAZON.HelpIntent`
- `AMAZON.CancelIntent`
- `AMAZON.StopIntent`
- `AddItemIntent`
- `ListItemsIntent`
- `RemoveItemIntent`
- `CompleteItemIntent`
- `ClearCompletedIntent`

Optionally implement:

- `ReopenItemIntent`

### Slots

Use a slot such as:

- `item`

Choose the most suitable built-in slot type for broad free-form shopping item phrases, or define a custom slot strategy where necessary.

Do not hard-code a small grocery vocabulary that prevents arbitrary products from being captured.

### Example utterances

Include multiple natural utterances for each intent.

Examples:

```text
AddItemIntent:
  add {item}
  put {item} on my list
  add {item} to the shopping list
  I need {item}

ListItemsIntent:
  what is on my list
  read my shopping list
  tell me what I need
  list my items

RemoveItemIntent:
  remove {item}
  delete {item}
  take {item} off my list

CompleteItemIntent:
  mark {item} as bought
  complete {item}
  cross {item} off
  I bought {item}

ClearCompletedIntent:
  clear completed items
  delete bought items
  remove everything I have completed
```

### Dialog behaviour

- Handle missing slots gracefully.
- Use Alexa dialog elicitation when the item is absent.
- Confirm destructive bulk actions.
- Keep replies short enough for voice interaction.
- Never expose raw Todoist or AWS errors to the user.
- On temporary upstream failure, apologise briefly and ask the user to try again.
- Include a request/error handler that logs a correlation ID.

### Skill access restrictions

This is intended initially as a private development skill for one household.

The README must explain how to:

1. create the skill in the Alexa Developer Console;
2. import or paste the interaction model;
3. configure the Lambda ARN or HTTPS endpoint;
4. enable testing in development mode;
5. test it on Echo devices associated with the developer account;
6. configure environment variables and secrets.

Do not implement account linking for version 1 unless it is technically required.

However, isolate user resolution behind an interface so multi-user account linking can be introduced later.

---

## Todoist API integration requirements

Before implementation, inspect the **current official Todoist developer documentation** and verify:

- base URL;
- current stable API version;
- authentication header format;
- project task filtering;
- task creation;
- task closing/completion;
- task reopening;
- task deletion;
- pagination;
- completed-task retrieval;
- rate-limit or retry guidance.

Do not rely on outdated Todoist endpoint assumptions.

Implementation requirements:

- Centralise HTTP logic in a typed Todoist client.
- Use request timeouts.
- Retry only transient failures such as `429`, `502`, `503`, and `504`.
- Use bounded exponential backoff with jitter.
- Respect `Retry-After` when present.
- Do not retry validation, authentication, or other permanent errors.
- Map upstream errors into application-level error types.
- Never log the Todoist API token.
- Add a descriptive `User-Agent` header if permitted.
- Correctly handle pagination.

---

## Duplicate handling

By default, adding an item that already exists should not silently create uncontrolled duplicates.

Implement this policy:

- Compare active item content using trimmed, case-insensitive normalisation.
- When an exact normalised duplicate exists, return the existing item and report `alreadyExists: true`.
- Alexa should say, for example: “Milk is already on your shopping list.”
- REST may return `200 OK` for an existing item and `201 Created` for a new item.
- Do not merge semantically different items such as “milk” and “two litres of milk”.

Keep duplicate detection deterministic and conservative.

---

## API response design

Use a consistent JSON envelope.

Successful single-item example:

```json
{
  "data": {
    "id": "123",
    "content": "milk",
    "isCompleted": false
  },
  "meta": {
    "requestId": "..."
  }
}
```

Collection example:

```json
{
  "data": [
    {
      "id": "123",
      "content": "milk",
      "isCompleted": false
    }
  ],
  "meta": {
    "requestId": "...",
    "count": 1
  }
}
```

Error example:

```json
{
  "error": {
    "code": "ITEM_NOT_FOUND",
    "message": "The requested shopping-list item was not found."
  },
  "meta": {
    "requestId": "..."
  }
}
```

Define stable application error codes.

---

## Observability

Implement structured logging with fields such as:

- `level`
- `message`
- `requestId`
- `channel` (`alexa` or `rest`)
- `intentName` where applicable
- `operation`
- `durationMs`
- `status`
- `upstreamStatus` where applicable

Privacy requirements:

- Do not log authentication tokens or secrets.
- Avoid logging full Alexa request payloads.
- Shopping item names may contain personal information; log them only at debug level and make debug logging disabled by default.
- Do not log Alexa access tokens.
- Include enough information to diagnose failures without exposing credentials.

Add CloudWatch alarm examples or Terraform resources for:

- Lambda errors
- Lambda throttles
- elevated duration
- API Gateway 5xx responses

Keep alarms practical; do not over-engineer an observability platform.

---

## Configuration

Support at least these environment variables:

```text
TODOIST_TOKEN_SECRET_ARN=
TODOIST_PROJECT_ID=
TODOIST_PROJECT_NAME=
REST_API_TOKEN_SECRET_ARN=
LOG_LEVEL=info
ALEXA_SKILL_ID=
```

Requirements:

- Validate configuration at cold start.
- Fail clearly when mandatory configuration is absent.
- Verify the incoming Alexa application/skill ID against `ALEXA_SKILL_ID`.
- Provide `.env.example` for local development with placeholders only.
- Do not put secrets in Terraform state as plaintext input variables where avoidable.
- Document safe secret provisioning commands.

---

## Infrastructure as code

Create Terraform that provisions, at minimum:

- Lambda execution role with least-privilege permissions
- Lambda function or functions
- API Gateway HTTP API
- Lambda integration and routes
- CloudWatch log groups with retention
- permissions for reading only the required secrets
- API Gateway access logs where supported
- CloudWatch alarms
- outputs needed to configure Alexa

Do not provision the Todoist token itself as a Terraform plaintext variable.

Make environment separation possible using Terraform variables or workspaces, but keep the initial implementation simple.

Document:

- prerequisites;
- initialisation;
- plan;
- apply;
- secret creation;
- deployment package build;
- how to obtain the deployed REST base URL and Alexa endpoint/ARN.

---

## Local development

Provide practical local tooling.

At minimum:

- a command to run unit tests;
- a command to lint;
- a command to type-check;
- a command to build;
- a command to run the REST application locally;
- a way to invoke Alexa handlers using representative fixture JSON;
- example cURL calls for every REST endpoint.

A Dockerfile is optional. Do not add Docker unless it materially improves reproducibility.

---

## Testing requirements

Use test-driven development for domain and application logic.

### Unit tests

Cover:

- item normalisation;
- duplicate detection;
- exact item matching;
- ambiguous item matching;
- not-found behaviour;
- list truncation for spoken Alexa responses;
- empty-list responses;
- destructive-action confirmation;
- error mapping;
- REST authentication;
- Alexa skill-ID validation;
- configuration validation.

### Todoist adapter tests

Use mocked HTTP interactions and cover:

- successful list retrieval;
- pagination;
- creation;
- completion;
- reopening if supported;
- deletion;
- `401`/`403`;
- `404`;
- `429` with `Retry-After`;
- transient `5xx`;
- timeout;
- malformed upstream response.

### REST integration tests

Exercise the HTTP routing and application services without calling live Todoist.

### Alexa handler tests

Use Alexa request fixtures for:

- launch;
- add;
- duplicate add;
- list empty;
- list populated;
- remove exact match;
- ambiguous remove;
- complete exact match;
- missing slot;
- confirmation accepted;
- confirmation denied;
- upstream failure;
- stop/cancel/help.

### Optional live smoke test

Provide an opt-in script that uses a dedicated Todoist test project.

It must:

- require an explicit environment flag;
- never run in normal CI;
- create a uniquely named item;
- verify retrieval;
- complete or delete it;
- clean up even after partial failure.

---

## CI requirements

Create a GitHub Actions workflow that runs on pull requests and pushes:

1. dependency installation with lockfile enforcement;
2. formatting check;
3. lint;
4. TypeScript type-check;
5. unit and integration tests;
6. build;
7. Terraform formatting and validation;
8. dependency/security audit with a sensible failure policy.

Do not deploy automatically in the initial workflow.

---

## Documentation deliverables

Create a comprehensive `README.md` containing:

1. purpose and scope;
2. architecture diagram;
3. prerequisites;
4. Todoist project setup;
5. Todoist API token setup;
6. AWS secret setup;
7. local development;
8. test commands;
9. Terraform deployment;
10. Alexa Developer Console configuration;
11. interaction-model installation;
12. example voice commands;
13. REST API examples;
14. security model;
15. known limitations;
16. troubleshooting;
17. future extensions, including printing.

Also create:

- `docs/architecture.md`
- `docs/alexa-setup.md`
- `docs/api.md`
- `openapi.yaml`
- an Alexa interaction model JSON file under a clearly named directory
- an example Alexa skill manifest if useful
- an ADR explaining the chosen Lambda structure
- an ADR explaining why Todoist is the system of record

---

## Explicit non-goals

Do not implement the following in this version:

- printing;
- Amazon’s native Alexa shopping-list integration;
- discontinued Alexa List Management APIs;
- scraping or reverse-engineering Amazon;
- synchronisation with Alexa’s built-in list;
- a web or mobile user interface;
- multi-household tenancy;
- public Alexa skill certification;
- LLM-based item interpretation;
- product lookup or purchasing;
- barcode scanning;
- meal planning;
- inventory management.

Leave clean extension points, but do not add speculative infrastructure for these features.

---

## Security acceptance criteria

The implementation is not complete unless all of the following are true:

- No real secrets appear in source code, fixtures, documentation, Terraform, or Git history.
- Todoist and REST API tokens are retrieved securely at runtime.
- Alexa skill ID is verified.
- REST endpoints except `/health` require authentication.
- Logs do not expose credentials.
- IAM permissions are least-privilege.
- HTTP inputs are validated.
- Destructive bulk operations require confirmation.
- Error responses do not disclose stack traces.
- Dependencies have no unresolved critical vulnerabilities, or any exception is documented.

---

## Functional acceptance criteria

The implementation is complete when:

1. A REST caller can add an item.
2. The item appears in the configured Todoist project.
3. The REST caller can list active items.
4. Alexa can add an item through the custom skill.
5. Alexa can read the list.
6. Alexa can remove or complete an unambiguous item by name.
7. Ambiguous item names do not cause an unintended mutation.
8. Duplicate adds are handled deterministically.
9. Completed items can be cleared only after confirmation.
10. Automated tests pass.
11. Terraform validates.
12. A developer can deploy and configure the system using the README alone.

---

## Implementation workflow

Work in these phases and keep the repository buildable after each phase:

### Phase 1: Repository assessment and design

- Inspect the existing repository.
- Identify existing conventions.
- Verify current official Todoist and Alexa SDK documentation.
- Write a concise implementation plan.
- Record material assumptions.
- Do not begin with large speculative abstractions.

### Phase 2: Domain and application services

- Define domain models, repository port, matching, normalisation, and use cases.
- Write tests first.
- Implement until tests pass.

### Phase 3: Todoist adapter

- Implement the typed Todoist client and repository adapter.
- Add mocked adapter tests.
- Verify pagination and current API semantics.

### Phase 4: REST adapter

- Implement routing, validation, authentication, error mapping, OpenAPI, and integration tests.

### Phase 5: Alexa adapter

- Implement intents, slot/dialog handling, confirmation flow, interaction model, fixtures, and tests.

### Phase 6: AWS infrastructure

- Add Terraform, IAM, API Gateway, Lambda packaging, secrets access, logging, and alarms.

### Phase 7: Documentation and CI

- Complete setup guides, examples, ADRs, and GitHub Actions.

### Phase 8: Final verification

Run and report:

- formatting;
- lint;
- type-check;
- tests;
- build;
- Terraform validation;
- security audit.

---

## Rules for execution

- Make the changes directly in the repository.
- Do not stop after drafting files or pseudocode.
- Do not claim success without running the relevant commands.
- Do not suppress failing tests merely to obtain a green build.
- Do not weaken TypeScript strictness.
- Do not use `any` except where an external untyped boundary makes it unavoidable; isolate and document each occurrence.
- Do not hard-code Todoist project IDs, tokens, Alexa skill IDs, AWS account IDs, or regions.
- Do not use deprecated Alexa list APIs.
- Do not add printing in this change.
- Prefer a small, maintainable solution over a generic platform.
- When official documentation conflicts with assumptions in this prompt, follow the current official documentation and record the deviation.

---

## Final response required from Codex

At completion, provide:

1. a concise summary of the implemented architecture;
2. the important files added or changed;
3. exact local test/build commands run;
4. exact results of those commands;
5. Terraform validation result;
6. deployment and Alexa setup steps still requiring manual user action;
7. any limitations or unresolved risks;
8. any deviations from this prompt and the reason for each.

Do not state that the system is production-ready unless all acceptance criteria have been verified.
