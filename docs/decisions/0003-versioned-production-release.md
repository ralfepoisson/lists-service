# ADR 0003: Versioned Production Release

## Status

Accepted — 8 August 2026.

## Context

Production must prove a candidate against real Secrets Manager and Todoist
before changing the public route. A raw API Gateway URL, unversioned `$LATEST`
deployment, local Terraform state, or an invented Alexa skill ID cannot provide
safe provenance or rollback.

## Decision

- Store Terraform state in a dedicated encrypted, versioned S3 bucket using
  native S3 lock files.
- Build from clean local `main` under digest-pinned Node 24.18.0/npm 11.16.0.
- Put the full Git commit in each Lambda environment and publish immutable
  Lambda versions.
- Keep API Gateway and Alexa permissions on an explicit `active` alias. A
  candidate apply preserves the current alias; activation and rollback each
  select an already-published numeric version.
- Disable the raw API Gateway endpoint. Expose REST only through the regional
  `lists.life-sqrd.com` API Gateway custom domain and Route53 A/AAAA aliases.
- Provision no Alexa Lambda, permission, or alias until the actual private
  Developer Console skill ID is supplied.
- Keep secret values in Secrets Manager and outside Terraform state.

## Consequences

An initial release has two applies: candidate publication, followed by accepted
alias/custom-domain activation. Later candidates can coexist with the active
version. Rollback is fast and does not rebuild code. Todoist remains the sole
data store, so service rollback never restores or overwrites provider data.
