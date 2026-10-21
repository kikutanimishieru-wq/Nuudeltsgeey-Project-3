# Sprint 2D — prepared adapter, runtime disabled

Source preparation only. No database connections, migrations, providers or servers.

## Prepared source

- prisma/schema.prisma: User.authGeneration default 0; AuthSession enum/model,
  restrictive owner FK, unique tuple and indexes; nullable generation/creation
  fields on historical login grants. No passwordless or linking schema changes.
- lib/session-prisma-adapter.ts: explicitly injected Prisma transaction/client;
  fixed public parameterized SQL, public-schema guard and transaction-local UTC;
  2s lock, 5s statement, 2s pool wait and 10s interactive transaction deadlines.
  User locks precede Session or grant locks. A grant is locked before fresh DB time
  is sampled; identity validation follows the grant lock. Conditional consumption
  uses one materialized DB clock sample after identity-lock waits. No provider I/O.
  Session insert, grant consumption and sanitized audit share the caller's
  transaction. Revocation is a conditional one-way update. Errors propagate with
  no retries; uncertain commit stays uncertain through the existing session core.
- tests/session-prisma-adapter.test.ts: fake query/transaction boundaries only.

The separate store factory does not instantiate Prisma, import lib/prisma.ts or
connect itself to any entry point. session-runtime.ts is unchanged: hard false,
unavailable store, rejecting transaction adapter. No environment flag enables this
preparation. Trusted server code must not wire the factory without separate review.

## Readiness limitations

The installed generated client is not regenerated and does not expose AuthSession
model delegates. The adapter uses supported raw-query methods available on that
client; typed raw result declarations do not prove the live schema is compatible.
No Prisma/schema validation command was run; no database schema was inspected.

A separate additive migration must provide CHECKs and immutability triggers listed
in proposals/SPRINT2C_SESSION_CORE_SCHEMA.md. Existing timestamp-without-time-zone
grant columns are treated as UTC, matching Prisma DateTime conventions; future
migration review must confirm stored conventions rather than silently reinterpret
historical timestamps. New session times use timestamptz(3).

Grant generation capture in issuance, all generation-changing security writers,
incident-domain lock ordering, cookie transport and approved legacy cutover remain
unimplemented prerequisites. The adapter relies on identity/security writers taking
the User lock before changing identity authority. It cannot enforce that convention
on existing writers. No linking or provisioning gate is changed.

Offline tests simulate transaction rollback and expiry races. They do not prove
PostgreSQL SQL execution, rollback, locking, trigger behavior, deadlock freedom,
concurrent commits or deployment readiness. These require separate approval for an
isolated test database. Real authentication is not operational.

Verification: 27 adapter mock tests plus 34 existing session-core tests passed
(61 total). TypeScript (`tsc --noEmit --incremental false`) and whitespace checks
passed. Initial two failures were test query-classification errors corrected before
the passing run; no live SQL or database behavior was tested.
