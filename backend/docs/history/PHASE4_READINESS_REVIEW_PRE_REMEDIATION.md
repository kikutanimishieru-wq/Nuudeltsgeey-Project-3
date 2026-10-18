# Phase 4 final validation — BLOCKED

This is a fresh static safety review, not a completed Neon validation. No explicitly identified safe disposable Neon project/branch was found in the supplied context or reviewed repository documentation. The owner instruction in final-validation item 3 requires stopping before any database connection or modification without approval. No database URL/credentials were inspected, no database was contacted, and no migration was applied in this review.

Only this report was added. Application code, schemas, migrations, historical records, NR formulas, emblems and designs were not changed. No push, deployment or Phase 5 work occurred.

## Requirement results

PASS below means the stated static review was completed; it does not certify the deployed database. FAIL identifies a concrete constraint-coverage gap. BLOCKED means the required current execution evidence is unavailable.

| Requirement | Result | Evidence and limit |
| --- | --- | --- |
| 1. Review pending Phase 4 migration for data loss, FKs and compatibility | PASS | Reviewed both Phase 4 SQL migrations and their application usage. No row deletion, truncation, backfill or ranking rewrite. Compatibility is conditional on exact prerequisite schema and constraint names; live compatibility is not certified. |
| 2. Rehearse on explicitly safe disposable Neon branch | BLOCKED | No project/branch was explicitly identified as disposable and safe. No connection attempted. |
| 3. Stop and request approval if no safe branch exists | PASS | Database work stopped. Approval and target identity are required before continuing. |
| 4a. Separate-connection simultaneous registrations | BLOCKED | No authorized PostgreSQL/Neon target. Existing PGlite adapter is single-connection. |
| 4b. Separate-connection duplicate self-check-ins | BLOCKED | Same restriction; no new execution evidence. |
| 4c. Separate-connection Floor 2 incident consumption | BLOCKED | Same restriction. Partial unique indexes and conditional update exist, but contention was not exercised through native Prisma/PostgreSQL connections. |
| 4d. Roster locking racing with protected check-in | BLOCKED | Same restriction; real blocking order, deadlocks and transaction timeouts remain unverified. |
| 4e. Real PostgreSQL 63/64-player classification | BLOCKED | No authorized target; earlier fixture results are not a fresh live PostgreSQL validation. |
| 5. Critical invariants independently enforced by database constraints | FAIL | Important constraints/triggers exist, but capacity and player uniqueness across active entrants are application checks. Snapshot classification is checked against its stored count, not independently against verified roster contents. Full independent database enforcement cannot be confirmed. |
| 6. Prove migration preserves existing historical records | BLOCKED | Static SQL has no destructive data rewrite; actual existing-record preservation requires an approved isolated schema/data clone and before/after comparisons. Earlier fixture results are historical evidence only. |
| 7. Re-run tests, TypeScript, Prisma, builds and dependency audits | BLOCKED | Not rerun in this review after the stop condition. The complete suite creates in-memory databases; executing it would require resolving the explicit any-database approval boundary. Non-database checks are also deferred rather than presenting a partial run as full validation. |
| 8. Produce readiness report with statuses | PASS | This report. Overall readiness remains BLOCKED; requirement 5 also has a static FAIL. |

The previous implementation reported 235 passing tests, successful TypeScript/Prisma/build checks and zero advisories. Those are previous-run results, not rerun or reconfirmed by this review.

## Migration safety findings

### `20261016150000_registration_lock`

This prerequisite Phase 4 migration relaxes `TournamentRegistration.teamId` nullability and adds a solo-player reference with `ON DELETE RESTRICT ON UPDATE CASCADE`. It adds an exclusive entrant-kind check, a per-tournament solo-entry unique index, nullable withdrawal/disqualification fields, and individual roster attendance fields.

It adds policy, lateness-incident and immutable-snapshot tables with restrictive foreign keys. Existing team registrations should satisfy the entrant-kind check because teamId was previously mandatory. No user/team/registration IDs are reassigned or removed. Existing team foreign keys are not replaced. Nullable team references nevertheless expand the application contract: downstream integrations that assume every entrant has a team need compatibility checks.

Roster/policy/registration triggers serialize writes on the parent tournament and block changes after a snapshot; snapshot updates/deletes and locked setting changes are rejected. These change future write/delete behavior, including cascaded maintenance operations, while preserving existing rows at migration time. On populated tables, ALTER TABLE and constraint/index creation can acquire blocking locks or scan existing data. This earlier migration has no explicit transaction wrapper in its SQL; verify migration-runner transaction behavior and partial-failure recovery on the approved clone rather than assuming atomic execution.

### `20261016170000_final_attendance_governance`

The final migration is explicitly wrapped in BEGIN/COMMIT. It replaces two CHECK constraints with version-aware expanded checks, adds nullable incident policyVersion and adds request history. It contains no UPDATE/DELETE/TRUNCATE or destructive table/column drop. Dropped objects are named CHECK constraints that are recreated in the same transaction.

The prior configuration check should remain valid for existing null-policy and older-rule rows. Existing pending-only lateness rows should remain valid with the new nullable version because the new null-version branch retains the prior restrictions. These conclusions assume the live schema/data conform to the prerequisite migrations; this review did not inspect live data or drift.

The new request table references incident, tournament and optional match with restrictive deletes and cascading ID updates. It does not remove or alter existing foreign keys. Request history, incident history and consumed incident facts acquire new mutation/deletion restrictions. These may intentionally block future administrative corrections and parent deletion/cascades; no exceptional correction workflow is silently authorized.

Partial unique indexes limit pending and completed requests per shared incident. Checks enforce a 15-minute request interval, non-empty reason, state/timestamp consistency, and completed arrivals within their protected interval. Triggers check request/incident tournament and version scope, freeze request facts/final decisions, prevent consumed-incident reset and reject history deletion. Nullable SQL comparisons and scoped parent relationships still warrant direct adversarial SQL tests on the approved target; declarations alone are not an execution proof.

Exact prerequisite constraint/function names, privileges, PostgreSQL behavior and deployed Prisma migration history must be verified before application. DDL locks and scans, migration failure recovery and network-latency transaction budgets remain rehearsal risks.

## Constraint coverage gap

The application takes a tournament row lock before counting registrations and rejecting duplicate active players. Registration/roster triggers also take that lock. However, those triggers do not themselves count capacity or check a player across different active entrant registrations. A direct writer can take the lock and still insert a logically invalid row if it satisfies the narrower existing unique/FK constraints.

The existing roster unique key is `(registrationId, playerId)`, not tournament-wide active participation. Solo/team entrant unique keys prevent duplicate entrant records but do not prevent the same player appearing on two different team entrant rosters. The capacity whitelist constrains the configured capacity value; it does not cap actual registrations.

Likewise, the snapshot CHECK enforces `classification = GRAND_BATTLE` when its stored count is at least 64. It does not independently derive that count from the eligible locked roster, validate the JSON count against attendance/identity, or enforce that every protected state mutation has its matching audit row. The services perform those operations transactionally. These are real service protections, but they do not satisfy a claim that every critical invariant is independently database-enforced.

No vulnerability was exercised against a database during this review. Fixes were not authorized or applied as part of this validation-only task. Resolve the intended database enforcement scope before declaring requirement 5 PASS.

## Concrete continuation requiring approval

Identify the Neon project ID and exact branch ID/name, explicitly confirm that it is isolated and disposable, and authorize connecting, applying pending migrations, inserting synthetic test fixtures and cleanup only on that branch. Supply any connection credentials through a secure local environment or secret configuration, not chat. Existing production/configured DATABASE_URL must not be used as an implicit test target.

On that approved target, first verify identity and migration history, record schema and historical-row/ID/rating baselines, then rehearse the pending migrations. Use independent Prisma clients/connections with coordinated barriers and bounded timeouts for all five requested race/boundary cases. Attempt direct SQL violations to distinguish database enforcement from application enforcement, and compare the historical baseline after migration/testing. Synthetic records should be separate from historical records.

The full automated suite additionally needs permission to create its existing disposable in-memory PGlite test databases. Then rerun TypeScript, Prisma validation, both builds and dependency audits, reporting exact outcomes and remaining failures. No approval for production access, production migration, Phase 5, push or deployment is implied.
