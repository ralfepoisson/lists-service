# Documentation

This directory is the documentation entry point for `lists-service`.

## Status

The checkout contains the TypeScript service, REST and Alexa adapters, current
Todoist API v1 adapter, Terraform, tests, interaction model, and documentation.
Static/local validation and the 8 August 2026 production REST/AWS/Todoist read
acceptance are recorded in the implementation log. Alexa and CI remain
unverified real boundaries until separately exercised.

## Read before implementation

1. [Requirements](requirements.md) — stable requirement identifiers and the
   evidence needed to accept each requirement.
2. [Implementation guidelines](implementation/implementation_guidelines.md) —
   the mandatory engineering and documentation methodology.
3. [Architecture](architecture.md) — proposed boundaries, runtime flows, and
   verification status.
4. [Solution architecture diagram](architecture/solution-architecture.puml) —
   proposed package and dependency structure.
5. [Logical data model](architecture/erd.puml) — Todoist-backed logical entities;
   no application database is proposed.
6. [Implementation log](implementation/implementation_log.md) — newest-first
   record of changes, decisions, commands, and evidence.
7. [REST and Todoist API guide](api.md) — channel contract and dated provider
   assumptions.
8. [Alexa setup](alexa-setup.md) — private development-skill configuration.

## Architecture decisions

- [ADR 0001: Separate Lambda entry points](decisions/0001-separate-lambda-entry-points.md)
- [ADR 0002: Todoist as the system of record](decisions/0002-todoist-system-of-record.md)
- [ADR 0003: Versioned production release](decisions/0003-versioned-production-release.md)

## Source specification

- [Initial Todoist/Alexa implementation prompt](implementation/prompts/codex-prompt-todoist-alexa-shopping-list.md)

The source prompt is retained as received. Requirements and decisions in this
directory make it easier to implement and verify that prompt; they do not
silently amend it.

## Documentation maintenance

Every behavior or structural change must update the applicable requirements,
architecture text, PlantUML diagrams, ADRs, setup/API documentation, and the
implementation log in the same change. Documents must distinguish:

- **design intent** — what is planned or required;
- **implemented** — what is present in the active checkout; and
- **verified** — what has fresh, reproducible evidence.
