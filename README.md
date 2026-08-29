# Life2 Lists Service

Public `GET /version` publishes schema version `1`, the SemVer from
`package.json`, and the immutable Lambda/container release revision without
requiring Todoist access or authentication.

`lists-service` is a private shopping-list and tenant-scoped task-list service.
Todoist is the sole system of record for list and task content. For Task Lists,
each Todoist project visible through a tenant's server-managed connection is a
named list. The legacy Shopping/Alexa surface remains deliberately separate and
uses its original owner token and configured project. The same object-oriented
application layer powers:

- an authenticated REST API for the Life2 webapp and personal automations; and
- an `en-GB` Alexa custom skill for adding, reading, removing, completing, and
  clearing shopping-list items.

`POST /api/v1/search` supplies bounded workspace-search results over the acting
tenant's visible list names and active task content. It requires a verified
Life2 JWT, ignores caller-supplied tenant identifiers, and returns allowlisted
route targets rather than arbitrary URLs.

This project is not created by, affiliated with, or supported by Doist.

The implementation is complete for local/static verification. On 31 July 2026,
the deployed local Lists boundary used the configured Todoist project to accept
nine real item mutations and return all nine through a confirming active-list
read. On 8 August 2026, REST Lambda version 2 from commit `67e8ba7` passed
direct candidate acceptance and canonical TLS/authenticated read verification
in production. Alexa invocation and CI remain unverified.

## Production URL contract

The canonical production origin for the REST API is
`https://lists.life-sqrd.com`.

Terraform owns the API Gateway regional custom domain and Route53 aliases for
this hostname. They are created only after an immutable REST Lambda candidate
has passed direct authenticated acceptance and its published version is chosen
for the `active` alias. The raw API Gateway endpoint is disabled.

## Scope

The service repository includes authenticated transient PDF rendering but
deliberately excludes an owned web/mobile UI. The separate Life2 webapp consumes
its REST and PDF contracts. Version 1 still excludes Alexa's built-in
shopping list, deprecated Alexa List Management APIs, browser-managed Todoist
onboarding or disconnection, LLM matching, product lookup, purchasing, scanning,
meal planning, and inventory management.

Todoist completed-item operations cover the configured rolling history window,
which defaults to 90 days. The current official Todoist completed-history API
requires a bounded interval of no more than three months and archive access may
depend on the Todoist plan.

## Architecture

```text
Alexa custom skill ---> Alexa Lambda adapter --\
                                                 > ShoppingListService
API Gateway HTTP API -> REST Lambda adapter ----/           |
                                                             v
                                               ShoppingListRepository
                                                             |
                                                             v
                          tenant catalogue -> protected token -> Todoist API v1
```

The domain and application layers know nothing about Alexa, API Gateway,
Lambda, Secrets Manager, or Todoist transport. Separate REST and Alexa Lambda
entry points share domain and transport primitives while retaining distinct
identity boundaries. REST derives Task Lists tenancy only from a verified Life2
JWT `accountId`, resolves that account in a protected server-side catalogue,
then loads the separately protected Todoist token named by the catalogue entry.
Alexa and legacy Shopping continue to use the configured owner token/project.

See the [architecture guide](docs/architecture.md), authoritative
[package diagram](docs/architecture/solution-architecture.puml),
[logical ERD](docs/architecture/erd.puml), and
[architecture decisions](docs/README.md#architecture-decisions).

## Prerequisites

- Node.js `24.18.0` and npm `11.16.0`
- Terraform `1.10` or newer
- AWS CLI v2 with credentials for the target account
- an AWS region supported by Alexa-hosted Lambda endpoints, normally
  `eu-west-1` for an `en-GB` skill
- a Todoist account and dedicated shopping-list project
- an Amazon Developer account for Alexa testing

Install the exact JavaScript dependencies:

```bash
npm ci
```

## Todoist setup

### Legacy Shopping and Alexa

1. Choose a dedicated Todoist project name, for example `Household Shopping`.
2. Open Todoist **Settings → Integrations → Developer** and copy the personal
   API token.
3. Create an AWS Secrets Manager secret whose entire string value is that
   token. Do not put it in this repository, Terraform variables, shell history,
   or a populated `.env` file.
4. Prefer an existing project's stable ID in `TODOIST_PROJECT_ID`. When only
   `TODOIST_PROJECT_NAME` is configured, service initialization reuses the one
   exact match or creates the project if no exact match exists. Multiple exact
   matches remain a configuration error.

If only the exact project name is known, resolve it once:

```bash
TODOIST_TOKEN_SECRET_ARN=arn:aws:secretsmanager:REGION:ACCOUNT:secret:NAME \
TODOIST_PROJECT_NAME='Household Shopping' \
npm run resolve:project
```

The explicit utility prints only the resolved ID and never creates a project.
Persist that value as the Terraform `todoist_project_id` when stable-ID
operation is preferred. Name-based service initialization resolves or creates
once per process; normal item operations never scan all projects.

The implementation uses the current unified Todoist API v1 at
`https://api.todoist.com/api/v1`, bearer authentication, cursor pagination,
`POST /tasks/{id}/close`, `POST /tasks/{id}/reopen`, and bounded completed
history. See [Todoist contract notes](docs/api.md#todoist-provider-contract).

### Tenant Task Lists catalogue

Task Lists does not reuse the static automation identity or accept a provider
token from the browser. Provision a protected JSON catalogue whose only field
is `connections`; every entry must contain exactly one unique `accountId` and
one `tokenSecretRef`. Store each referenced token in its own protected secret
and grant the REST runtime access only to the catalogue and explicitly listed
tenant token secrets. A missing account entry is `not_connected`; it never
falls back to the legacy token.

Authenticated `/v1/task-lists` operations enumerate the connected tenant's
existing Todoist projects, create projects, and let callers list, add, edit,
remove, complete, and reorder their tasks. Deleting a list requires explicit
destructive confirmation, completes all remaining active tasks, and archives
the project only after every completion succeeds. Todoist Inbox cannot be
archived.

## AWS secrets

Create the legacy runtime secrets plus the tenant catalogue:

- Legacy Todoist token: retained for Shopping and Alexa only.
- Tenant connection catalogue: JSON containing only unique `accountId` and
  `tokenSecretRef` pairs; it contains no Todoist token values.
- One separately protected Todoist token secret for every catalogue entry.
- Strong REST bearer token: readable only by the REST function.
- Base64-encoded Life2 HS256 signing key: readable only by the REST function.

Use the AWS console's masked secret editor, or a secret-safe operational
workflow approved for the workstation. Terraform accepts only the two secret
ARNs and never provisions their values. The signing-key secret must contain the
same base64 text used by the Auth Service's `LIFE2_JWT_SIGNING_KEY_BASE64`;
never expose it to the browser. Generate the REST token with a
cryptographically secure password generator; do not reuse another credential.

Copy `.env.example` only as a reference. Never commit a populated `.env`.

## Local development

The local entry points use the real Todoist boundary. There is no pretend
provider mode. They default to AWS Secrets Manager; set `SECRET_PROVIDER=file`
to use absolute paths to read-only local secret files through the same
`SecretProvider` port. Export the placeholder configuration names shown in
`.env.example` through your normal secure environment mechanism, then run:

```bash
npm run dev:rest
npm run invoke:alexa -- tests/fixtures/alexa/launch-request.json
```

For the fixture invocation, set `ALEXA_SKILL_ID` to the fixture application ID
or update the placeholder in a private, uncommitted fixture.

The Life2 root launcher provides the supported container integration. It starts
the optional Lists API automatically when both ignored files exist:

- `.life2-local/secrets/lists-todoist-token`; and
- `.life2-local/config/lists-allowed-account-id`.

The launcher mounts secrets read-only, derives the JWT verification-key file
from the same local Auth signing key, generates a one-account local catalogue
whose token reference points at the existing mounted token, and routes
`/api/lists/` through Nginx.

Engineering work must follow the
[implementation guidelines](docs/implementation/implementation_guidelines.md)
and record completed slices in the
[implementation log](docs/implementation/implementation_log.md).

## Quality commands

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build
npm audit --audit-level=critical
terraform -chdir=terraform fmt -check -recursive
terraform -chdir=terraform init -backend=false
terraform -chdir=terraform validate
plantuml -checkonly docs/architecture/solution-architecture.puml docs/architecture/erd.puml
```

`npm run build` creates the local REST bundle, the Alexa Lambda bundle, and a
`dist/rest-package/` directory containing the REST Lambda plus PDFKit's
standard-font and colour-profile data. The local image copies the same data
beside `local-rest.cjs`; Terraform archives `rest-package/` so PDF generation
does not depend on build-time `node_modules`. `npm run verify:build` fails if a
required runtime asset is missing.

An opt-in live Todoist acceptance command requires an explicit flag and a
dedicated test project. It creates a uniquely named task, retrieves and
completes it, verifies completed retrieval, and deletes it in `finally`:

```bash
LIFE2_RUN_LIVE_TODOIST_SMOKE=1 \
TODOIST_TOKEN_SECRET_ARN=arn:aws:secretsmanager:REGION:ACCOUNT:secret:TEST \
TODOIST_LIVE_TEST_PROJECT_ID=DEDICATED_TEST_PROJECT_ID \
npm run test:live:todoist
```

It never runs in CI. Unit and component tests intercept only the provider
boundary and do not establish that real credentials, Todoist, AWS, or Alexa
work.

## Terraform production release

Production uses a versioned, encrypted S3 backend with native lock files and
published Lambda versions behind an explicit `active` alias. Never put secret
values in Terraform variables or state. Copy `deploy/production.env.example`
outside the repository, replace only identifiers/ARNs, and make it mode 0600.

Bootstrap the dedicated state bucket once and sync each protected local secret
into Secrets Manager without printing it:

```bash
./scripts/bootstrap-production-state.sh BUCKET eu-west-1
./scripts/sync-production-secret.sh SECRET_NAME /absolute/mode-0600/value eu-west-1
```

Then, from a clean local `main`, publish without changing the active alias:

```bash
./scripts/deploy-production.sh /absolute/mode-0600/production.env --plan
./scripts/deploy-production.sh /absolute/mode-0600/production.env --candidate
```

The script runs the complete quality gate under exact Node 24.18.0/npm 11.16.0
in the digest-pinned build container. Invoke the reported candidate version
directly with an API Gateway v2 event: require public `/health` 200,
authenticated `/health/ready` 200, authenticated persisted Todoist reads, and
401 for an invalid bearer. Do not use a provider mutation as readiness proof.
The maintained acceptance command performs those checks without printing the
token or item contents:

```bash
./scripts/accept-rest-candidate.sh /absolute/mode-0600/production.env VERSION /absolute/mode-0600/rest-token
```

Activate only the accepted numeric version; this is the step that creates or
updates the canonical DNS/custom-domain route:

```bash
./scripts/deploy-production.sh /absolute/mode-0600/production.env --activate-rest VERSION
```

Verify `https://lists.life-sqrd.com/health`, authenticated readiness/list reads,
TLS, and the alias target. Roll back by selecting a previously accepted,
still-published version and rerunning the same gates:

```bash
./scripts/deploy-production.sh /absolute/mode-0600/production.env --rollback-rest PRIOR_VERSION
```

Alexa remains absent until a real private skill ID exists. Its candidate and
alias use the analogous `--activate-alexa` and `--rollback-alexa` operations.
Terraform never deploys automatically from CI. See
[ADR 0003](docs/decisions/0003-versioned-production-release.md).

## Alexa Developer Console

The detailed walkthrough is in [Alexa setup](docs/alexa-setup.md). In summary:

1. Create a **Custom** skill with locale `English (UK)`.
2. Use `household list` as the initial invocation name, or change
   `invocationName` in
   [`alexa/interaction-models/en-GB.json`](alexa/interaction-models/en-GB.json)
   before importing it if Amazon rejects the name.
3. Import the JSON model and build it.
4. Copy the skill ID into Terraform and `ALEXA_SKILL_ID`.
5. Deploy in `eu-west-1` and select the Terraform Alexa Lambda ARN as the
   default endpoint.
6. Enable development testing.
7. Test with the simulator and an Echo signed into the same developer account.

Terraform restricts Alexa invocation permission to the configured skill ID, and
the ASK SDK verifies that ID again in the application.

Example utterances:

```text
Alexa, ask Household List to add two bottles of sparkling water
Alexa, ask Household List what is on my list
Alexa, ask Household List to remove milk
Alexa, ask Household List to mark milk as bought
Alexa, ask Household List to clear completed items
```

## REST API

`GET /health` is public. Protected legacy Shopping routes accept the strong
static automation token or the configured owner's verified Life2 JWT. Task
Lists and Todoist connection routes require a verified Life2 JWT; the static
automation token receives `403` and can never select a tenant connection.

```text
Authorization: Bearer <REST_API_TOKEN>
```

Examples assume `LISTS_URL` and `LISTS_TOKEN` exist only in the current secure
shell environment:

```bash
curl "$LISTS_URL/health"

curl "$LISTS_URL/health/ready" \
  -H "Authorization: Bearer $LISTS_TOKEN"

# The following connection response requires a Life2 JWT, not LISTS_TOKEN:
# {"status":"connected|not_connected","canManageConnection":false}
curl "$LISTS_URL/v1/todoist/connection" \
  -H "Authorization: Bearer $LIFE2_TOKEN"

curl "$LISTS_URL/v1/items" \
  -H "Authorization: Bearer $LISTS_TOKEN"

curl "$LISTS_URL/v1/items?status=completed" \
  -H "Authorization: Bearer $LISTS_TOKEN"

curl "$LISTS_URL/v1/items.pdf" \
  -H "Authorization: Bearer $LISTS_TOKEN" \
  --output shopping-list.pdf

curl -X POST "$LISTS_URL/v1/items" \
  -H "Authorization: Bearer $LISTS_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"content":"two bottles of sparkling water"}'

curl -X DELETE "$LISTS_URL/v1/items/ITEM_ID" \
  -H "Authorization: Bearer $LISTS_TOKEN"

curl -X POST "$LISTS_URL/v1/items/ITEM_ID/complete" \
  -H "Authorization: Bearer $LISTS_TOKEN"

curl -X POST "$LISTS_URL/v1/items/ITEM_ID/reopen" \
  -H "Authorization: Bearer $LISTS_TOKEN"

curl -X DELETE "$LISTS_URL/v1/items?status=completed" \
  -H "Authorization: Bearer $LISTS_TOKEN" \
  -H "X-Confirm-Destructive-Action: true"
```

The formal contract is [OpenAPI 3.1](openapi.yaml); narrative behavior and
status codes are in [the API guide](docs/api.md).

## Security model

- Todoist and REST tokens are loaded through the configured secret-provider
  adapter—AWS Secrets Manager in Lambda or read-only files in local Compose—and
  cached only inside the warm process.
- The tenant catalogue contains token references, never token values. It rejects
  malformed entries and duplicate `accountId` values before any tenant request.
- REST token comparison uses equal-length constant-time comparison.
- Life2 JWT verification pins HS256, issuer `life2.ralfe.me`, audience
  `account`, time claims, and non-empty `accountId`, subject, and email claims.
  The verified `accountId` exclusively selects the tenant catalogue entry; no
  request field can override it. The signing key is backend-only.
- `GET /v1/todoist/connection` reveals only `connected` or `not_connected` and
  `canManageConnection: false`. Authorization-start and disconnect requests are
  intentionally rejected because this release has no browser credential flow.
- `/health` reveals only process liveness; readiness is authenticated.
- Workspace search is read-only, capped at 30 hits, and sends
  `Cache-Control: private, no-store` because task text can be sensitive.
- Alexa skill ID is restricted in Lambda IAM permission and checked by ASK SDK.
- Inputs and provider responses are validated; raw upstream errors and stack
  traces are never returned.
- Logs are structured JSON and contain correlation/operation/timing metadata,
  not tokens, full Alexa requests, or item content at normal log levels.
- Bulk deletion needs an explicit REST header or Alexa confirmation status.
- Neither Terraform nor repository files contain real secret values.

## Troubleshooting

- **Cold-start configuration error:** check all required environment variables
  and ensure the legacy project plus tenant catalogue/token references are valid.
- **Named project is absent:** initialization creates it once. If multiple exact
  name matches exist, remove the ambiguity or configure a stable project ID.
- **401 from this API:** verify the `Bearer` scheme and Life2 token claims/signature.
  A static automation token is intentionally `403` on Task Lists. The
  response intentionally gives no credential detail.
- **Todoist not connected:** the verified JWT `accountId` has no catalogue entry.
  Browser onboarding is unavailable; an operator must provision the catalogue
  and separate token secret through the protected deployment process.
- **Todoist authentication failure:** rotate/check the Todoist secret and IAM
  access; credentials are never printed.
- **Completed items absent:** confirm the completion occurred inside
  `COMPLETED_LOOKBACK_DAYS` (1–90) and that the Todoist plan exposes archive
  search.
- **Alexa request rejected:** ensure the Developer Console skill ID, Terraform
  `alexa_skill_id`, Lambda permission, and `ALEXA_SKILL_ID` all match exactly.
- **Alexa model rejects the invocation name:** choose an allowed two-word name,
  update the JSON `invocationName`, rebuild the model, and use that phrase.
- **Terraform archive error:** run `npm run build` before `plan` or `apply`.
- **Provider throttling/unavailability:** reads retry bounded transient
  failures. Mutating requests are deliberately not blindly retried because the
  current Todoist REST API does not document create idempotency.

## Known limitations and future work

- The deployed REST/AWS/Todoist boundary is verified for non-mutating health,
  authentication, readiness, and persisted reads. Alexa simulator/device and
  CI execution remain unverified.
- Completed reads and clearing cover only the configured rolling 1–90 day
  window.
- Reopening is exposed by REST but intentionally omitted from voice v1.
- Exact duplicate detection is a read-before-create policy and cannot eliminate
  every race between concurrent requests.
- Mutation retries are conservative to avoid duplicate/destructive ambiguity.
- Task Lists supports multiple Life2 accounts through the server-side catalogue,
  with one Todoist connection per `accountId`. It does not provide browser
  onboarding, disconnect, token refresh, or per-user (`sub`) connections.
- Static automation and Alexa remain bound to the legacy owner/project and are
  not multitenant Task Lists identities.
- `GET /v1/items.pdf` renders the current active Todoist items as a transient
  A4 PDF download. The service stores no generated file and the webapp exposes
  it through the Shopping page's **Print** button.

## Documentation map

Start at [docs/README.md](docs/README.md) for requirements, architecture, ADRs,
API/Alexa setup, implementation methodology, and the durable implementation
log. The source prompt is preserved unchanged under
`docs/implementation/prompts/`.
