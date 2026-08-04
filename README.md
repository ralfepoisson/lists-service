# Life2 Lists Service

`lists-service` is a private, single-household shopping-list service. Todoist is
the sole system of record. The same object-oriented application service powers:

- an authenticated REST API for the Life2 webapp and personal automations; and
- an `en-GB` Alexa custom skill for adding, reading, removing, completing, and
  clearing shopping-list items.

This project is not created by, affiliated with, or supported by Doist.

The implementation is complete for local/static verification. On 31 July 2026,
the deployed local Lists boundary used the configured Todoist project to accept
nine real item mutations and return all nine through a confirming active-list
read. AWS deployment, Alexa invocation, and CI remain unverified, so this README
does not claim production readiness.

## Production URL contract

The canonical production origin for the REST API is
`https://lists.life-sqrd.com`.

This hostname is the intended stable custom-domain contract; it does not prove
that API Gateway custom-domain routing, DNS, TLS, AWS deployment, Todoist, or
Alexa have been accepted in production. Terraform currently exposes the raw
API Gateway URL, so an actual release must provision and verify the canonical
custom domain separately before advertising it as available.

## Scope

The service repository itself deliberately excludes printing and an owned
web/mobile UI. The separate Life2 webapp now consumes its REST contract. Version
1 still excludes Alexa's built-in
shopping list, deprecated Alexa List Management APIs, account linking,
multi-household tenancy, LLM matching, product lookup, purchasing, scanning,
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
                                          Todoist API v1 + one project
```

The domain and application layers know nothing about Alexa, API Gateway,
Lambda, Secrets Manager, or Todoist transport. Separate REST and Alexa Lambda
entry points share the same domain, use cases, repository port, and Todoist
adapter. The two functions receive different IAM secret permissions: Alexa
reads only the Todoist token, while REST also reads its static bearer token and
the Life2 JWT verification secret.

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

## AWS secrets

Create three secrets:

- Todoist token: readable by both functions.
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
from the same local Auth signing key, and routes `/api/lists/` through Nginx.

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

`npm run build` creates `dist/rest-lambda.mjs` and
`dist/alexa-lambda.mjs`. Terraform packages that directory for both functions
and selects the applicable handler.

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

## Terraform deployment

Build before planning:

```bash
npm ci
npm run build
terraform -chdir=terraform init
terraform -chdir=terraform plan \
  -var='environment=dev' \
  -var='todoist_token_secret_arn=arn:aws:secretsmanager:REGION:ACCOUNT:secret:TODOIST' \
  -var='rest_api_token_secret_arn=arn:aws:secretsmanager:REGION:ACCOUNT:secret:REST' \
  -var='life2_jwt_signing_key_secret_arn=arn:aws:secretsmanager:REGION:ACCOUNT:secret:LIFE2-JWT' \
  -var='life2_allowed_account_id=ACCOUNT_ID' \
  -var='todoist_project_id=PROJECT_ID' \
  -var='alexa_skill_id=amzn1.ask.skill.SKILL_ID'
terraform -chdir=terraform apply
```

Review the plan, especially IAM and secret ARNs, before applying. Useful
outputs include the REST base URL, REST/Alexa Lambda ARNs, and log groups.
Terraform does not deploy automatically from CI.

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

`GET /health` is public. Every other route accepts either a strong static token
for personal automations or a verified Life2 JWT for the one configured account:

```text
Authorization: Bearer <REST_API_TOKEN>
```

Examples assume `LISTS_URL` and `LISTS_TOKEN` exist only in the current secure
shell environment:

```bash
curl "$LISTS_URL/health"

curl "$LISTS_URL/health/ready" \
  -H "Authorization: Bearer $LISTS_TOKEN"

curl "$LISTS_URL/v1/items" \
  -H "Authorization: Bearer $LISTS_TOKEN"

curl "$LISTS_URL/v1/items?status=completed" \
  -H "Authorization: Bearer $LISTS_TOKEN"

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
- REST token comparison uses equal-length constant-time comparison.
- Life2 JWT verification pins HS256, issuer `life2.ralfe.me`, audience
  `account`, time claims, non-empty subject/email claims, and the configured
  `accountId`. The signing key is backend-only and decoded from base64.
- `/health` reveals only process liveness; readiness is authenticated.
- Alexa skill ID is restricted in Lambda IAM permission and checked by ASK SDK.
- Inputs and provider responses are validated; raw upstream errors and stack
  traces are never returned.
- Logs are structured JSON and contain correlation/operation/timing metadata,
  not tokens, full Alexa requests, or item content at normal log levels.
- Bulk deletion needs an explicit REST header or Alexa confirmation status.
- Neither Terraform nor repository files contain real secret values.

## Troubleshooting

- **Cold-start configuration error:** check all required environment variables
  and ensure exactly one usable project ID/name is configured.
- **Named project is absent:** initialization creates it once. If multiple exact
  name matches exist, remove the ambiguity or configure a stable project ID.
- **401 from this API:** verify the `Bearer` scheme and either the REST token or
  Life2 token claims/signature. The
  response intentionally gives no credential detail.
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

- Real Todoist, deployed AWS, Alexa device, and CI execution remain to be
  verified.
- Completed reads and clearing cover only the configured rolling 1–90 day
  window.
- Reopening is exposed by REST but intentionally omitted from voice v1.
- Exact duplicate detection is a read-before-create policy and cannot eliminate
  every race between concurrent requests.
- Mutation retries are conservative to avoid duplicate/destructive ambiguity.
- One configured Life2 account/household and Todoist project are supported;
  Alexa account linking and multi-household routing are extension points, not
  implemented behavior.
- Printing may later consume the authenticated REST API, but no printing
  infrastructure is included now.

## Documentation map

Start at [docs/README.md](docs/README.md) for requirements, architecture, ADRs,
API/Alexa setup, implementation methodology, and the durable implementation
log. The source prompt is preserved unchanged under
`docs/implementation/prompts/`.
