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
