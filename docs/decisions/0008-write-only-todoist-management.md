# ADR 0008 — Encrypted Todoist credential overrides and durable disconnection

Status: implemented locally; production rollout requires separate authorization.

Ralfe explicitly requested Todoist Manage with credential editing/disconnection
on the approved Profile standardization card. The existing read-only catalogue
and secret mounts cannot safely be mutated through a browser. Keep that catalogue
and existing token files unchanged, add an encrypted per-tenant PostgreSQL override
and dedicated secret key, and use a null ciphertext tombstone for disconnect.

This avoids copying existing tokens and prevents an old catalogue credential from
silently restoring access after disconnect. Optimistic versions reject stale edits.
AES-GCM additional data binds ciphertext to the verified account. No token or
provider response is read back; saving performs no provider request and truthfully
reports unverified. Retained clients resolve current tokens before every request
and retry. Both REST and Alexa must use the same overlay configuration when released.

Alternatives rejected: editing read-only catalogue/token files; browser-owned keys;
removing the catalogue mapping or provider tasks; automatic OAuth/provider calls;
falling back after disconnect; coupling credential encryption to JWT signing keys.
