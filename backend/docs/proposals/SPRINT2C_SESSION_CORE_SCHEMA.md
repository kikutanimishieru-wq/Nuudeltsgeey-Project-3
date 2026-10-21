# Sprint 2C session core — UNAPPLIED schema/client dependency

UNAPPLIED. Sprint 2D prepares the session-core additions in schema.prisma.
No generated client or migration has been changed or executed.
The approved-for-development source cannot persist sessions with the existing
models. `session-runtime.ts` hard-disables activation and has no environment toggle.
Its runtime transaction adapter still refuses with SESSION_SCHEMA_ADAPTER_REQUIRED.
The separate session-prisma-adapter.ts source is prepared but is not connected to
session-runtime.ts, Auth.js, identity routes or a live client.

## Required separate preparation

- User.authGeneration: bigint, nonnegative, default 0; only stable/increasing updates.
- AuthSession: idHash PK (SHA-256 hex), userId FK User RESTRICT, authGeneration,
  method DISCORD/LEGACY_PASSWORD, createdAt/authenticatedAt, expiresAt, revokedAt.
- Immutable owner/hash/generation/method/timestamps; one-way revokedAt. Exact eight
  hours absolute and nonnegative/finite timestamp/generation constraints as V1.1.
- Unique (idHash,userId,authGeneration); indexes (userId,revokedAt), expiresAt.
- IdentityLoginGrant: captured authGeneration and createdAt for NEW grants; existing
  rows remain preserved. Legacy grants must not mint versioned registry sessions.
  Single-use, provider/browser/account/generation/expiry invariants remain mandatory.
- FK generations must NOT reference current User.authGeneration: old records must
  survive generation advancement. Do not backfill active sessions from legacy JWTs.

This is the SESSION-CORE subset of SPRINT2B_SESSION_LINKING_V1.md. No Steam child or
reauthentication model is implemented here. Do not silently enable LINK by adding
session columns. Nullable email/password support stays its own proposal.

After independent schema review and separate approval, prepare Prisma model/client
source changes plus a new additive migration. Preserve original migration files,
checksum pins, accounts, NMD IDs, roles, identities and history. Do not run Prisma
commands or apply anything on the strength of this document. No automatic rollback
may delete sessions or lower generations.

## Missing production adapter contract

SessionStore.transaction must be a real database transaction, with bounded lock/
statement/interactive deadlines, supported public schema verification and rollback
on any thrown error. No Map or process-local object implements production storage.
Map/copy state in tests is ONLY a simulation.

SessionTransaction.lockAccount: User FOR UPDATE, return current generation/status/
role/public profile and private credential snapshot. lockSession: Session FOR UPDATE
only AFTER User, validate queried hash and account ownership. now: fresh DB time.
insertSession: preserve exact hash/generation/method/deadline with constraints.
lockDiscordGrant: AFTER User, lock grant. Sample fresh DB time afterward.
claimDiscordGrant: conditionally consume that already locked grant; require DISCORD, userId, browser hash,
captured generation, expiry and unconsumed state, then conditionally consume once.
Do not infer captured generation from current User generation. revokeSession:
conditional NULL -> timestamp, true only for exactly one affected row. audit:
transactional sanitized append, no secret/hash/credential metadata.

Issuance and grant consumption must be part of the SAME transaction. Unique errors,
timeouts, serialization failure and uncertain commit are surfaced without retries.
The raw SQL grant path from the earlier sprint remains LEGACY only; it is not a
substitute for this adapter. The future source schema/client change must also add
generation capture to grant issuance before any activation is considered.

Adopt generation advancement for credential/recovery/restriction writers and audit
incident-domain lock ordering before activation. Every callback, logout and public
session path needs independent review. No database connection is authorized here.

## Sprint 2D preparation status

Prisma source now includes User.authGeneration (BigInt, default 0), AuthSession
with RESTRICT owner relation, composite uniqueness, indexes, method enum and
millisecond timestamptz session fields. Grant generation/creation fields are
nullable with no defaults: historical grants remain unversioned. Existing
email/password fields, roles, identities and tournament models are unchanged.

Client regeneration is deferred. The prepared adapter uses Prisma's existing
parameterized raw-query interface, not invented model delegates or client casts.
SQL statements target fixed public relations. No SQL was sent to a database.
The production runtime gate and unavailable runtime adapters remain unchanged.

Prisma cannot express the required CHECK constraints and immutability triggers.
Their separately reviewed additive migration remains a mandatory blocker:
nonnegative/increasing User generation; session hash/method/time constraints;
immutable session owner/generation/method/timestamps and one-way revokedAt;
versioned grant shape/lifetime, immutable bindings and one-way consumption.
No migration is prepared/applied by 2D, no existing migration is edited, and no
historical grant/session backfill is authorized. Schema/client and constraint
validation are still required before any activation decision.
