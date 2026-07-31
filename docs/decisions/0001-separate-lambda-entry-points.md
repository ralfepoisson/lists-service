# ADR 0001: Separate Lambda entry points

- **Status:** Accepted and implemented; deployment not yet verified
- **Date:** 2026-07-31
- **Requirements:** `LST-ARC-001`, `LST-ARC-003`, `LST-ARC-006`

## Context

The service has two materially different inbound protocols: API Gateway HTTP
events and Alexa custom-skill requests. Both must use identical shopping-list
policy and the same Todoist repository port. The prompt permits either one
Lambda with separate request adapters or separate Alexa and REST Lambdas sharing
a common package.

## Decision

Use separate Alexa and REST Lambda entry points. Each has its own composition
root and transport adapters, while both depend on shared domain, application,
and infrastructure packages.

Channel-specific authentication, request parsing, dialog state, serialization,
permissions, alarms, and deployment configuration remain separate. Shared
shopping-list rules remain in application/domain objects.

## Rationale

- Preserves explicit protocol and security boundaries.
- Allows independent IAM, configuration, monitoring, and deployment tuning.
- Keeps each Lambda handler small and independently testable.
- Avoids branching one handler across unrelated event shapes.
- Retains one implementation of list-management behavior.

The small amount of additional Terraform and packaging is acceptable for the
clarity gained.

## Consequences

- Two deployment artifacts or two handlers built from shared packages are
  required.
- Shared-package changes must be validated against both channel suites.
- Terraform must provision and expose the distinct Alexa and REST integrations.
- Cold-start object construction occurs independently per Lambda environment.
- No shared mutable in-memory state may be assumed between channels.

## Alternatives considered

### One Lambda handling both event types

This reduces function count but combines trust boundaries, event dispatch, IAM,
configuration, and operational metrics. It was rejected for version 1 because
the deployment simplicity does not outweigh the loss of separation.

### Separate services with duplicated business logic

Rejected because it violates the requirement that Alexa and REST use the same
application services.

## Verification

Separate `rest-lambda` and `alexa-lambda` entry points, shared application
objects, adapter suites, build bundles, and Terraform resources implement the
decision. A deployed topology check remains pending.
