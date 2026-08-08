# Implementation Log

This is the durable, newest-first engineering record for `lists-service`.
Prepend new entries immediately below this introduction. Do not include secrets,
credentials, full Alexa payloads, or sensitive shopping-item content.

## Entry template

### YYYY-MM-DD HH:MM TZ — Short change title

- **Status:** proposed | in progress | implemented, validation pending | verified
- **Scope:** concise description of the work slice
- **Requirements:** `LST-...`
- **Design/decisions:** relevant object boundaries, patterns, and ADRs
- **Files:** added/changed paths
- **TDD evidence:**
  - Red: exact command and expected failure
  - Green: exact command and passing result
  - Refactor/regression: exact command and result
- **Other validation:** format, lint, type-check, build, Terraform, OpenAPI,
  diagrams, security audit, and documentation checks with exact results
- **Real-boundary evidence:** Todoist/AWS/Alexa/CI evidence, or explicitly pending
- **Documentation:** documents and diagrams updated
- **Deviations/risks:** prompt deviations, unavailable checks, or `None`
- **Next actions:** remaining work or `None`

---

## 2026-08-08 19:30 CEST — Versioned production release contract

- **Status:** deterministic implementation verified; production validation pending
- **Scope:** Added the maintained secret-safe production state, candidate,
  activation, canonical-domain, and rollback path.
- **Requirements:** `LST-OPS-001`–`LST-OPS-005`, `LST-SEC-002`,
  `LST-SEC-005`, `LST-DOC-001`
- **Design/decisions:** ADR 0003; separate REST/Alexa cold-start configuration;
  published Lambda versions behind explicit `active` aliases; no Alexa
  resources until a real skill ID exists; locked versioned S3 state; API
  Gateway regional custom domain with its raw endpoint disabled.
- **Files:** configuration/composition sources and tests, Terraform, production
  scripts/example configuration, README, ADR, requirements, architecture, and
  both PlantUML diagrams.
- **TDD evidence:**
  - Red: focused Vitest run failed 15 tests for missing channel-specific config,
    remote state, aliases, custom domain, and release scripts.
  - Green: the same focused run passed 15 tests in 2 files.
  - Refactor/regression: exact Node 24.18.0/npm 11.16.0 clean install, format,
    lint, strict type-check, 95 tests in 16 files, build, and high-severity audit
    passed; the audit reported zero vulnerabilities.
- **Other validation:** `terraform validate -json` reported valid with zero
  errors and warnings; shell syntax and both PlantUML checks passed. Production
  plan remains pending.
- **Real-boundary evidence:** Current Alexa Developer Console inspection found
  no Household Lists skill; no ID was invented and Alexa remains absent.
  AWS resource creation and authenticated production acceptance are pending.
- **Documentation:** Updated root/documentation indexes, architecture,
  requirements, ADR 0003, implementation log, and both PlantUML diagrams.
- **Deviations/risks:** None; no AWS resource has been mutated at this point.
- **Next actions:** Complete the full gate, commit clean main, review/apply the
  candidate, accept real reads, activate canonical HTTPS, and prove rollback.

## 2026-07-31 21:25 CEST — Alexa-list item migration

- **Status:** verified against the real local and Todoist boundaries
- **Scope:** Imported the nine active items supplied by the user from their
  Alexa Shopping List into the Life2 Shopping List.
- **Design/decisions:** Used the Lists Service authenticated REST add operation
  for every item so its normalization and exact-duplicate policy remained
  authoritative; no direct provider mutation or simulated response was used.
- **Files:** `docs/implementation/implementation_log.md` only; the operation
  changed provider data, not application source.
- **Validation:** All nine POST requests through the deployed Life2
  `/api/lists/v1/items` proxy returned HTTP 201 with `alreadyExists=false`. A
  subsequent authenticated active-list GET returned HTTP 200, count 9, and
  confirmed all nine expected entries with none missing.
- **Real-boundary evidence:** The Lists container was healthy with zero
  restarts before import, and the accepted mutations plus follow-up read prove
  the configured credential and Todoist project boundary are operational.
- **Security/privacy:** No credential was displayed. Item contents are omitted
  from this durable log; they remain only in the user-authorized provider data.
- **Next actions:** Refresh the Shopping page to view the migrated list.

## 2026-07-31 19:58 CEST — Local runtime repair and live token verification

- **Status:** deterministic implementation verified; operator credential rejected
- **Scope:** Repaired the local executable composition/bundle and the macOS
  Docker secret-mount boundary, then exercised startup against the configured
  Todoist credential without displaying it.
- **Requirements:** `LST-ARC-002`, `LST-SEC-002`, `LST-OPS-001`,
  `LST-TST-001`, `LST-DOC-001`
- **Design/decisions:** Provider-neutral factories now live outside the AWS
  composition root. `LocalRestApplicationComposition` imports only file-backed
  secrets, while Lambda composition remains AWS-specific. The local executable
  is CommonJS because its JWT dependency is CommonJS; Lambda artifacts remain
  ESM. The root launcher stages mode-600 copies under a private Docker-readable
  directory because Docker Desktop cannot bind-mount files from this checkout's
  `/Volumes` location.
- **Files:** `src/bootstrap/ApplicationFactories.ts`,
  `src/bootstrap/LocalApplicationComposition.ts`,
  `src/bootstrap/ApplicationComposition.ts`, `src/entrypoints/local-rest.ts`,
  `scripts/build.mjs`, `Dockerfile`,
  `tests/bootstrap/LocalApplicationComposition.test.ts`, plus root launcher,
  Compose contract, tests, and documentation.
- **TDD evidence:**
  - Red: the focused composition test initially failed because
    `LocalApplicationComposition` did not exist; after creation, its deliberately
    short test key exposed the 32-byte JWT-key invariant.
  - Green: the focused composition suite passed 1 test.
  - Refactor/regression: `npm run validate` passed before the final local-bundle
    format adjustment. After that adjustment, the equivalent format, lint,
    strict type-check, 88 tests in 14 files, and build gates passed separately.
    The root local-stack contract first failed on the absent secure staging
    behavior, then passed after implementation.
- **Other validation:** The CommonJS local bundle started on a loopback test
  port and returned `GET /health` status 200 with `data.status=ok`. The rebuilt
  container read all three private mounts without weakening their mode.
- **Real-boundary evidence:** The configured value reached Todoist's real API;
  project discovery returned HTTP 403 and the typed client translated it to
  `UPSTREAM_AUTHENTICATION_FAILED`. The value is therefore stored but is not an
  accepted Todoist API credential. The crash-looping container was stopped.
- **Documentation:** Updated service status/architecture/PlantUML and root
  local-runtime documentation/PlantUML.
- **Deviations/risks:** No token content was printed or logged. Provider-backed
  shopping operations remain unavailable until the operator replaces the file
  with a valid Todoist API token and reruns the launcher.
- **Next actions:** Replace only
  `.life2-local/secrets/lists-todoist-token` through a masked prompt, rerun
  `./run-life2.sh`, and repeat readiness plus signed-in Shopping acceptance.

## 2026-07-31 19:31 CEST — Live configuration follow-up

- **Status:** blocked only on operator-supplied Todoist credential
- **Scope:** Rechecked the authenticated Shopping failure after another browser
  refresh and reduced the outstanding local configuration to one private value.
- **Evidence:** The browser and direct route still returned the expected HTTP
  503 because no `lists-api` container was running. Both ignored configuration
  files were absent. PostgreSQL contained exactly one distinct non-empty local
  Auth `account_id`; that identifier was written without display to the
  mode-600 ignored file `.life2-local/config/lists-allowed-account-id`.
- **Security:** The Todoist token was not guessed, extracted, logged, or placed
  in chat. The user screenshot visibly exposed a bearer token in DevTools and a
  sign-out/sign-in rotation was recommended.
- **Next action:** The operator must create the mode-600 ignored
  `.life2-local/secrets/lists-todoist-token` through a masked local prompt. Then
  rerun the launcher and execute real-provider/browser acceptance.

## 2026-07-31 18:14 CEST — Named-project provisioning and local Compose boundary

- **Status:** implementation and deterministic local validation verified; real
  Todoist request pending private configuration
- **Scope:** Added one-time resolve-or-create behavior for a name-configured
  Todoist shopping project, a file-backed local secret adapter, a Node 24
  container runtime, and the root `/api/lists` Compose/Nginx integration.
- **Requirements:** `LST-SCP-001`, `LST-ARC-002`, `LST-ARC-005`, `LST-FUN-001`,
  `LST-SEC-001`, `LST-SEC-002`, `LST-SEC-007`, `LST-TOD-001`–`004`,
  `LST-OPS-001`, `LST-DEV-001`, `LST-TST-001`, `LST-DOC-001`
- **Design/decisions:** `TodoistProjectResolver.resolveOrCreate` runs only while
  constructing the repository: it reuses one exact match, creates on zero, and
  refuses ambiguity. Item reads therefore remain mutation-free and scoped by a
  stable injected project ID. `FileSecretProvider` implements the existing
  `SecretProvider` port for read-only Compose mounts; AWS remains the default.
  The Lists container is optional and starts only with real ignored local
  configuration. Nginx returns JSON `503` when it is absent instead of routing
  API requests to Angular's SPA fallback.
- **TDD evidence:**
  - Red: the first focused Vitest run failed all 4 provisioning tests because
    `resolveOrCreate` did not exist.
  - Red: the next focused run failed the file-provider suite at import and 3
    configuration assertions because no local secret strategy existed.
  - Green: the combined focused command passed 17 tests in 3 files.
  - Regression: `npm run validate` passed formatting, ESLint, strict TypeScript,
    87 tests in 13 files, and all three bundles including `local-rest.mjs`.
- **Other validation:** Both root stack contracts passed; the digest-pinned,
  unprivileged Lists image built from a 439 kB context; `./run-life2.sh up`
  rebuilt a healthy webapp; deployed Nginx configuration validation passed; and
  an unconfigured `/api/lists/v1/items` returned HTTP 503 JSON with stable code
  `LISTS_SERVICE_UNAVAILABLE` rather than HTTP 200 HTML. Playwright then loaded
  the deployed Shopping route, confirmed the signed-out guard and blank
  assistant pane, captured `webapp/output/playwright/shopping-unconfigured.png`,
  and reported zero browser errors or warnings.
- **Real-boundary evidence:** Pending. The checkout contains neither a Todoist
  token nor an allowed-account binding, so no provider project was searched or
  created and no item data was simulated.
- **Documentation:** Updated README, requirements, API/provider notes,
  architecture guide, ADR 0002, both service diagrams, root README/local
  runbook/diagrams, and the webapp implementation log.
- **Deviations/risks:** The user's screenshot was not a missing-project response;
  it was an unproxied SPA fallback. Project creation occurs during composition,
  which is triggered by the first request/health initialization, rather than
  inside every item GET. Creation is not blindly retried because the current
  official REST v1 project endpoint documents no idempotency mechanism.
- **Next actions:** Add the real Todoist token and allowed Life2 account ID to
  the documented ignored files, rerun the launcher, then execute signed-in
  browser add/list/complete/delete acceptance against Todoist.

## 2026-07-31 14:20 CEST — Life2 webapp JWT authentication boundary

- **Status:** implemented and locally verified; deployed validation pending
- **Scope:** Extended the REST boundary for the Life2 Shopping page while
  retaining the existing personal-automation credential.
- **Requirements:** `LST-SEC-001`, `LST-SEC-002`, `LST-SEC-005`,
  `LST-SEC-007`, `LST-OPS-001`, `LST-OPS-003`, `LST-DOC-001`
- **Design/decisions:** `CompositeRestAuthenticator` applies an any-strategy
  policy over the existing constant-time token adapter and a new
  `Life2JwtRestAuthenticator`. The JWT adapter pins HS256, issuer, audience,
  time and identity claims, and the single configured household account.
- **Files:** REST authentication adapters/tests, `AppConfig` tests/composition,
  package lock, `.env.example`, Terraform variables/IAM/environment, OpenAPI,
  README, requirements, API/architecture documentation, and PlantUML diagrams.
- **TDD evidence:** Red focused run failed with the two missing authenticator
  modules and three absent configuration behaviors. Green
  `npx vitest run tests/adapters/Life2JwtRestAuthenticator.test.ts tests/adapters/CompositeRestAuthenticator.test.ts tests/config/AppConfig.test.ts`
  passed 18 tests in 3 files.
- **Other validation:** Exact-toolchain `npm run validate` passed Prettier,
  ESLint, strict TypeScript, all 77 tests in 11 files, and both Lambda builds.
  Terraform initialized without a backend, formatted cleanly, and validated.
  Both service PlantUML files passed `plantuml -checkonly`. Redocly validated
  OpenAPI with only the pre-existing non-failing public-liveness 4xx warning.
- **Real-boundary evidence:** Pending. No deployed API Gateway, Auth Service
  signing key, Life2 browser session, AWS, or Todoist call is claimed.
- **Risks:** HS256 verification necessarily gives this backend secret the power
  to sign tokens. IAM therefore grants it only to the REST Lambda, and the
  value must never enter a browser, log, Terraform state, or repository file.
- **Next actions:** Run all service gates and verify a deployed Life2 JWT request
  after secure secret provisioning and reviewed Terraform apply.

## 2026-07-31 00:56 CEST — Initial Todoist, REST, Alexa, and AWS implementation

- **Status:** implemented and locally verified; real boundaries pending
- **Scope:** Implemented the initial object-oriented TypeScript service from the
  preserved prompt: shared domain/application policies, current Todoist API v1
  adapter, authenticated REST API, `en-GB` Alexa custom skill, secure AWS
  composition, Terraform, OpenAPI, CI, local tools, and complete setup/operations
  documentation.
- **Requirements:** `LST-SCP-001`–`003`, `LST-ARC-001`–`006`,
  `LST-FUN-001`–`010`, `LST-API-001`, `LST-SEC-001`–`006`,
  `LST-TOD-001`–`004`, `LST-ALX-001`–`005`, `LST-OPS-001`–`004`,
  `LST-DEV-001`–`002`, `LST-TST-001`–`003`, `LST-CI-001`,
  `LST-TST-004`, `LST-CI-001`, `LST-DOC-001`–`002`. The live-smoke tool is
  implemented; its real-provider run remains pending because no credentialed
  execution was authorized.
- **Design/decisions:** Separate REST and Alexa Lambda entry points share
  `ShoppingListService` and the `ShoppingListRepository` port. Cohesive policy,
  adapter, factory/composition, resolver, secret-provider, logger, and typed
  error objects implement the OO/SOLID guidelines. Todoist owns all item state;
  no database or UI was introduced. REST uses a replaceable constant-time bearer
  authenticator; Alexa uses ASK SDK skill-ID verification and a replaceable
  household resolver.
- **Files:** `src/`, `tests/`, `alexa/`, `terraform/`, `openapi.yaml`,
  `.github/workflows/ci.yml`, project/tooling configuration, root `README.md`,
  `docs/api.md`, `docs/alexa-setup.md`, requirements, architecture/ERD, ADRs,
  guidelines, and Life2 system-level README/PlantUML.
- **TDD evidence:**
  - Red: `npm test` failed with six missing implementation-module suites;
    focused Todoist and REST/Alexa adapter tests likewise failed before their
    modules existed.
  - Green: focused domain/application, Todoist, REST, and Alexa suites passed as
    each slice landed.
  - Refactor/regression: exact Node `24.18.0`/npm `11.16.0`
    `npm run validate` passed formatting, lint, strict type-check, 63 tests in 9
    files, and both Lambda bundles.
- **Other validation:** Exact-toolchain `npm run test:coverage` passed at 92.89%
  statements, 87.20% branches, 98.29% functions, and 92.72% lines.
  Production `npm audit --omit=dev --audit-level=critical` found 0
  vulnerabilities. `terraform fmt -check -recursive`, backend-free `init`, and
  `validate` passed. Redocly 2.43.1 validated OpenAPI with one non-failing
  warning that the intentionally public liveness operation has no fabricated
  4xx response. PlantUML `-checkonly` passed both service and both Life2
  system diagrams. Alexa model/fixture JSON parsed, 11 Markdown files had no
  missing local links, `git diff --check` passed, and the prompt SHA-256 remained
  `a92a8ce13f80bffee17cfcb59635ae91dd9f23f858feab7ddae6e3104f9aad7b`.
- **Real-boundary evidence:** Pending. No Todoist credential, AWS deployment,
  Alexa Developer Console/device, or GitHub Actions run was used; no real
  external success is claimed.
- **Documentation:** Root/service README, documentation index, requirements,
  API/provider notes, Alexa/deployment guidance, ADRs, service architecture/ERD,
  implementation guidelines, and Life2 system diagrams were synchronized.
- **UI impact:** No browser/mobile UI exists or is in scope. The user-facing
  Alexa voice adapter has 10 handler tests covering launch/help, arbitrary
  phrases, elicitation, list states, matching/mutation, ambiguity,
  confirmation, cancel/stop, and skill-ID rejection.
- **Deviations/risks:** Completed history and clear-completed are bounded to
  1–90 days because Todoist requires completion-date windows of at most three
  months and archive access may be plan-dependent. Mutations are not blindly
  retried because current REST v1 documents no create idempotency key.
  Read-before-create duplicate prevention cannot remove every concurrency race;
  clear-completed may partially succeed if Todoist fails mid-sequence. Reopen is
  REST-only in voice v1. These constraints are documented rather than hidden.
- **Next actions:** Provision real secrets/project, review and apply Terraform,
  import/build the Alexa model, run controlled Todoist and deployed REST/Alexa
  acceptance checks, and confirm the first GitHub Actions run.

## 2026-07-31 — Documentation contract bootstrap

- **Status:** implemented, validation pending
- **Scope:** Established the documentation entry point, traceable requirements,
  mandatory engineering methodology, proposed architecture/ERD, and initial
  architecture decisions from the unmodified implementation prompt.
- **Requirements:** `LST-ARC-005`, `LST-ARC-006`, `LST-DOC-001`
- **Design/decisions:** Object-oriented ports-and-adapters design; separate REST
  and Alexa Lambda entry points sharing domain/application objects; Todoist as
  the sole system of record.
- **Files:** `docs/README.md`, `docs/requirements.md`,
  `docs/implementation/implementation_guidelines.md`,
  `docs/implementation/implementation_log.md`, `docs/architecture.md`,
  `docs/architecture/solution-architecture.puml`,
  `docs/architecture/erd.puml`, `docs/decisions/0001-separate-lambda-entry-points.md`,
  and `docs/decisions/0002-todoist-system-of-record.md`.
- **TDD evidence:** Not applicable to this docs-only bootstrap; no runtime
  behavior was implemented.
- **Other validation:** A Node.js local-link check scanned 8 Markdown files and
  reported `missingLinks: []`. `plantuml -checkonly
docs/architecture/solution-architecture.puml
docs/architecture/erd.puml` exited 0. Runtime, package, test, build, Terraform,
  OpenAPI, and security-audit validation remain pending because those
  implementation artifacts are outside this docs-only bootstrap. Both diagrams
  were also rendered through PlantUML's SVG pipe and identified as valid SVG
  files; the temporary render artifacts were not added to the repository.
- **Real-boundary evidence:** Pending. Todoist, AWS, Alexa, and CI were not called;
  no external behavior is claimed.
- **Documentation:** Initial contract scaffold created. The root README remains
  outside this docs-only work slice.
- **Deviations/risks:** Official Todoist and AWS/Alexa API details have not yet
  been researched or verified. Architecture diagrams express design intent, not
  observed deployment.
- **Next actions:** Validate this scaffold, then implement from focused failing
  tests while recording current official-provider evidence and updating this log.
