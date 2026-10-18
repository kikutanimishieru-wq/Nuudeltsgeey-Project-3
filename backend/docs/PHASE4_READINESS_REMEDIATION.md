# Phase 4 readiness remediation

The missing capacity, cross-entrant duplicate-participation and snapshot-count protections are now enforced by a new additive PostgreSQL migration. No existing migration, persistent database, application behavior, ranking formula, emblem or design was rewritten. All database execution in this task used authorized disposable in-memory engines; no Neon control-plane or database connection occurred. Phase 5, push and deployment remain unstarted.

## Missing constraints and remediation

| Prior gap | New database protection |
| --- | --- |
| Capacity checked only by the service | AFTER triggers on registrations, roster members and tournament settings lock the parent tournament and reject occupancy above capacity, including direct writes, reactivation and capacity reduction. Nonwithdrawn/nondisqualified entrants reserve capacity, consistent with the service. |
| Same player could appear on different active entrant rosters via direct writes | The same parent-serialized guards reject duplicate player IDs across nonwithdrawn/nondisqualified registrations, including unused substitutes and reactivation. Existing within-registration and entrant unique keys remain. |
| Count/classification CHECK could accept a fabricated stored count | Snapshot insertion independently derives the active count from complete locked entrants and current relational membership, floor, identity and self-check-in/protected-arrival facts. It rejects count mismatches even when the proposed classification agrees with that fabricated count. |
| Snapshot JSON could omit entrants or alter active flags | Exact entrant ID and roster player/active-flag sets are compared against relational rows; duplicates, omissions and mismatches fail. Unused bench players are included in roster integrity checks but excluded from the active count. |
| Concurrent changes could invalidate the snapshot facts | Snapshot insertion takes the tournament lock and ordered user/profile/team locks plus shared identity/membership locks. Existing write/immutability guards serialize original-roster/settings changes and reject post-lock edits. |
| Protected events could be downgraded to avoid the new guards | A policy-scope trigger rejects changes away from the existing S5 managed policy/version. Historical other-version events are not silently opted in. |

New migration: `backend/prisma/migrations/20261016190000_phase4_database_invariants/migration.sql`. It adds functions/triggers in one explicit transaction; no data backfill, table/column/check removal, new extension or Prisma model change is needed. Existing snapshot update/delete protection remains intact, including for snapshots inserted before this migration.

The invariant triggers support READ COMMITTED and SERIALIZABLE, and deliberately reject stale-snapshot isolation for protected mutations. PostgreSQL documents fresh per-query snapshots for volatile functions and the transaction-isolation differences; the parent lock/fresh command reads underpin this design. This is a design basis, not a substitute for native contention testing. [PostgreSQL function volatility](https://www.postgresql.org/docs/current/xfunc-volatility.html), [transaction isolation](https://www.postgresql.org/docs/16/transaction-iso.html).

## Validation

The existing service tests still cover simultaneous registration, duplicate/idempotent check-ins, concurrent protected consumption, locking races, immutable snapshots and persisted 63/64 classification. New direct-SQL cases reject overflow, capacity shrink, cross-team participation, conflicting reactivation, policy downgrade, unsupported isolation, fabricated counts, omitted entrants, changed active flags and attendance-free snapshots.

Migration replay also creates an S5 roster/locked snapshot before the remediation and verifies that its IDs, attendance rule reference, count, classification and historical digest remain unchanged afterwards. Existing legacy format/capacity, user/NR, registration and pending-claim preservation cases still pass.

Fresh final validation results are recorded below. The in-memory engine uses one connection and a test Prisma adapter. Overlapping callers are not proof of native separate-session lock behavior. No live Neon, real-provider callback, production-like load test or authenticated browser journey was run. The DB-backed demo smoke script remains blocked without an approved isolated running server/database.

## Migration risks and remaining boundaries

- Protections apply prospectively to the managed final S5 policy. Historical other-version rows and existing snapshots are not reclassified or rewritten.
- Existing inconsistent S5 data is not repaired or scanned into a backfill by migration. Preflight must detect over-capacity, duplicate participation or inconsistent snapshots on the approved clone; future protected writes fail closed until a separately reviewed correction is approved.
- Parent serialization trades concurrency within an event for integrity. Aggregate checks add write cost; snapshot validation reads/locks all participating identity/profile/membership facts. Rehearse worst-case fields, indexes, network latency, timeouts and deadlocks on the actual target.
- Repeatable Read/Read Uncommitted protected mutations intentionally fail rather than use a stale view. Serializable may require full-transaction retries after serialization failure. Do not count aborted work as success or retry a non-idempotent operation blindly.
- Existing locked history is immutable, so cleanup must use the authorized disposable branch lifecycle rather than deleting protected records or disabling guards on a shared database.
- These checks validate stored relational identity/attendance facts; they do not perform provider callbacks or independently prove physical presence. Authentication, evidence permissions, canonical digest generation and state/audit transaction coupling remain service responsibilities. Privileged owners capable of disabling triggers are outside ordinary runtime-role enforcement.
- Actual Neon compatibility and separate-session race results remain BLOCKED. No remaining FAIL is known for the specifically remediated invariants in isolated tests; overall readiness remains BLOCKED pending native validation and migration approval.

The exact branch authorization, identity verification, baseline preservation, migration rehearsal and independent-session test schedules are in [the prepared Neon procedure](PHASE4_NEON_VALIDATION_PROCEDURE.md). It is a procedure, not an executed or certified native test harness.

## Required approval to continue Neon validation

Supply the exact project ID, disposable branch ID/name, endpoint ID/hostname, database/role, protected target identifiers and explicit permission for metadata verification, migration rehearsal, synthetic writes and cleanup/disposal on that branch only. Use secure local secret configuration for credentials. Before connecting, verify branch/endpoint identity through approved control-plane metadata; a configured DATABASE_URL is never implicit authorization. No additional approval is needed for the already authorized disposable in-memory suite.

## Fresh check results

| Check | Result |
| --- | --- |
| Full backend automated suite | PASS — 242 tests in 25 files, including 37 Phase 4 database tests |
| Backend and frontend TypeScript | PASS |
| Prisma schema validation/client generation | PASS; nonconnecting placeholder database URL used for validation/build |
| Backend and frontend production builds | PASS |
| Backend npm audit | PASS — zero advisories |
| Frontend npm audit | PASS — zero advisories |
| Migration replay/preservation and direct SQL rejection tests | PASS in disposable in-memory databases |
| Native separate-session PostgreSQL/Neon concurrency | BLOCKED — no authorized branch |
| Actual Neon schema/data compatibility and migration rehearsal | BLOCKED — no authorized branch |
| Configured or production database access | Not attempted |

## Changed files

- `backend/docs/PHASE4_NEON_VALIDATION_PROCEDURE.md`
- `backend/docs/PHASE4_READINESS_REMEDIATION.md`
- `backend/docs/PHASE4_READINESS_REVIEW.md`
- `backend/docs/history/PHASE4_READINESS_REVIEW_PRE_REMEDIATION.md`
- `backend/prisma/migrations/20261016190000_phase4_database_invariants/migration.sql`
- `backend/tests/phase4-database.test.ts`
