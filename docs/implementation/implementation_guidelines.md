# Implementation Guidelines

## Authority and mandatory pre-flight

These guidelines govern all implementation in `lists-service`. Before changing
production code, tests, infrastructure, API contracts, or interaction models:

1. Read the root `README.md`, this document, `docs/requirements.md`,
   `docs/architecture.md`, both PlantUML diagrams, applicable ADRs, and the
   source prompt.
2. Inspect the active checkout and preserve unrelated work.
3. Select the requirement IDs affected by the change.
4. Record assumptions and identify which external facts require current
   official-documentation verification.
5. Define the failing test or other acceptance evidence before implementation.

If the root `README.md` is absent, report the failure and stop unless the user's
explicit task is to create or restore that README.

## Object-oriented design

Production TypeScript must be organized around cohesive objects with explicit
responsibilities. Do not build the service as function-only scripts or bags of
unrelated utility functions.

- Model domain behavior through value objects, entities, domain services, and
  application use-case objects where each is justified.
- Depend on ports/interfaces at architectural boundaries. Inject adapters into
  application objects rather than importing infrastructure into domain code.
- Keep construction in composition roots for REST and Alexa Lambda entry points.
- Encapsulate invariants such as item normalization, matching, confirmation,
  authentication, retry policy, and configuration validation.
- Prefer immutable values and narrow public methods.
- Use explicit error types and translate them at adapter boundaries.
- A small pure function may exist when it is the clearest implementation detail
  of an object; it must not become the architectural substitute for cohesive
  objects.

Apply SOLID and design patterns pragmatically:

- **Single Responsibility**: one reason to change per class/module.
- **Open/Closed**: extend replaceable boundaries through ports, not speculative
  inheritance frameworks.
- **Liskov Substitution**: adapters honor the behavioral contract of their port.
- **Interface Segregation**: expose narrow consumer-focused interfaces.
- **Dependency Inversion**: domain/application policy owns abstractions;
  transport/provider code implements them.
- Use Repository, Adapter, Strategy, Factory/composition root, and typed error
  translation patterns where they clarify the required boundary.
- Avoid pattern ceremony, service locators, global mutable state, deep
  inheritance, and abstractions without a second concrete reason to exist.

## Test-driven development

Use red-green-refactor for domain, application, adapter, and security behavior:

1. **Red**: add the smallest focused test expressing one requirement and run it
   to demonstrate the expected failure.
2. **Green**: implement the smallest production change that satisfies it.
3. **Refactor**: improve names and structure without changing behavior.
4. Run the focused suite after each meaningful edit, then all relevant suites
   after a significant backend change.

Record the exact commands and results in the implementation log. Never weaken a
test, strictness setting, validation rule, or security gate merely to produce a
green result. Never use `any` except at an unavoidable untyped external boundary;
isolate and explain each occurrence.

Unit and integration tests may use fakes or controlled HTTP interception to
isolate external boundaries. Outside tests, do not simulate successful systems
or conceal unavailable provider behavior with fallback data.

## Real-boundary honesty

Evidence must be labeled accurately:

- A unit test verifies local logic.
- An intercepted HTTP test verifies adapter behavior against the encoded
  protocol assumption.
- A local integration test verifies in-process composition.
- A real provider smoke test verifies the actual Todoist boundary for the tested
  operation at the recorded time.
- A deployed invocation verifies the tested AWS/Alexa boundary, not every path.

Do not claim Todoist, Alexa, AWS, CI, or deployment success from mocks, fixtures,
static validation, or generated configuration. Real smoke tests must be opt-in,
secret-safe, scoped to a dedicated test resource, and clean up after failure.
Never print or log tokens, secret values, full Alexa payloads, or sensitive item
content.

Current external API claims must cite current official documentation. When
official documentation conflicts with the prompt, follow the official contract
and record the deviation and evidence.

## Documentation as part of implementation

Documentation is a completion requirement, not follow-up work. In the same
change as behavior:

- update affected rows in `docs/requirements.md` with evidence;
- update `docs/architecture.md` and both PlantUML diagrams for structural or
  data-model changes;
- add or supersede an ADR for material decisions;
- keep the root README, API/OpenAPI, Alexa setup/model, configuration, security,
  limitations, and troubleshooting guidance accurate;
- update `docs/README.md` when documents are added or moved; and
- prepend a complete implementation-log entry.

State must remain explicit: **proposed**, **implemented but unverified**, or
**verified with evidence**. Never draw a future component as current without a
clear proposed annotation.

## Implementation log methodology

`docs/implementation/implementation_log.md` is append-only in meaning and
newest-first in presentation.

- Prepend one dated entry per coherent work slice.
- Never silently rewrite prior evidence. Add a correction entry that links to
  the corrected record.
- Include scope, requirement IDs, design decisions, files, TDD evidence,
  validation commands/results, real-boundary status, documentation, deviations,
  risks, and next actions.
- Use absolute or repository-relative paths, exact commands, exact counts, and
  timestamps with timezone when they matter.
- Mark skipped, unavailable, failed, or pending checks plainly.
- Never include secrets, credentials, sensitive payloads, or personal shopping
  item content.

## Change and validation discipline

- Keep changes small, cohesive, and buildable after each phase.
- Preserve unrelated work and stage only reviewed paths if a commit is requested.
- Validate inputs and parse unknown external data before it enters typed code.
- Centralize provider HTTP, timeouts, retry policy, pagination, and error mapping.
- Use bounded retries only for documented transient conditions.
- Do not add a new database or speculative infrastructure without a superseding
  ADR and updated ERD.
- Consider adapter impacts across both REST and Alexa whenever shared backend
  behavior changes.
- Significant frontend work is currently out of scope; if a UI is later
  authorized, add automated UI tests and update the architecture contract.

## Definition of done

A change is done only when:

1. its requirement IDs and acceptance evidence are clear;
2. focused tests were written first and pass;
3. relevant broader tests, format, lint, type-check, and build pass;
4. affected infrastructure/specification validation passes;
5. applicable real boundaries are verified or explicitly pending;
6. security and secret-safety checks pass;
7. documentation and diagrams match the checkout; and
8. the newest-first implementation-log entry reports exact results and remaining
   limitations.
