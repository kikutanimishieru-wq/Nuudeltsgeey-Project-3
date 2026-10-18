# Phase 4 isolated Neon validation procedure — NOT EXECUTED

This is an execution procedure, not evidence that a branch exists or that native concurrency has passed. The current authorization permits in-memory test databases only. Do not contact Neon, inspect its control plane, connect to a configured database or execute these steps until the owner explicitly identifies and authorizes a disposable branch.

## Exact authorization needed

Record approval containing:

- Neon project ID, disposable branch ID and branch name.
- Allowed endpoint ID/hostname, database name and database role; the endpoint must belong to that exact branch.
- Confirmation that the branch is isolated and disposable and is not a protected production/staging/default branch.
- Permission for read-only branch identity/schema checks, migration rehearsal, synthetic fixtures, separate-connection concurrency tests and cleanup/disposal on this target only.
- Whether to use an authorized isolated clone containing historical records for preservation comparisons. Do not read/copy production data without separate approval.
- Explicit protected project/branch/endpoint identifiers that must never be used. Credentials must be placed in secure local configuration, never pasted into chat or printed.

A URL, a branch name containing “test”, or a configured DATABASE_URL is not sufficient authorization. No branch creation or production cloning is authorized by this document.

## Verify identity before database operations

After approval, obtain read-only control-plane metadata using the Neon console or approved administrative tooling. Match project, branch ID/name, endpoint ID and hostname against the owner's approval and confirm they are not protected identifiers. Do this before database connection, migration or fixture writes. Stop on any mismatch, ambiguous endpoint or inability to verify ownership of the endpoint by the exact branch.

Pass the approved disposable URL explicitly to a dedicated test process; never fall back to the application's configured DATABASE_URL. Do not print URLs, usernames/passwords, environment dumps, Prisma configuration dumps or raw exception objects containing credentials. Log only approved nonsecret project/branch/endpoint identifiers and sanitized outcomes. Disable shell tracing and verbose connection diagnostics.

On the verified endpoint, confirm database/role, PostgreSQL version, UTC timestamp contract, migration history, expected constraint/function names and intended migration privileges. Reconfirm the target before migration and before destructive cleanup. Use migration privileges only for rehearsal; perform application/direct-write tests with an ordinary role that cannot disable triggers or rewrite schema.

## Preflight and migration rehearsal

1. Save schema/migration checksums and approved historical baselines: IDs, row counts, relevant row hashes, NR/rating/result history, provider links, policy versions, pending lateness facts and existing locked snapshots/digests. Store comparisons privately without printing identity/evidence data.
2. For existing S5 managed events, query over-capacity registrations and duplicate nonwithdrawn/nondisqualified roster players. The new triggers do not backfill, repair or retroactively validate old rows. Existing inconsistent current-policy data requires a separately reviewed correction; do not delete/reclassify it to make tests pass.
3. Compare pending migration checksums and exact existing constraint names with the repository. Confirm prerequisite migrations through `20261016170000_final_attendance_governance`; the remediation is `20261016190000_phase4_database_invariants`.
4. Rehearse migration application only on the verified target. Record DDL timing/locks and transaction outcome. The remediation is transactional and adds functions/triggers only; earlier migrations contain their separately documented schema expansions.
5. Compare every approved baseline after migration. Existing IDs, NR, ratings, historical policies and snapshots must be unchanged. Verify that a failed migration rolls back new DDL on a separate disposable rehearsal target if failure testing is authorized.
6. Exercise direct writes with triggers enabled. Passing a service test alone is insufficient.

## Native concurrency harness requirements

Use real Prisma/PostgreSQL connections, not the PGlite SQL adapter. Coordinate at least two independent interactive transactions with barriers before the competing operation. Within each transaction record a distinct `pg_backend_pid()` to establish that the two operations use different database sessions. Do not merely issue Promise.all on a single serialized connection.

Use bounded lock/statement/transaction timeouts, deterministic fixture IDs/names per run and a separately labelled synthetic dataset. Test READ COMMITTED, and separately test SERIALIZABLE if intended for runtime. The new guards deliberately reject REPEATABLE READ and READ UNCOMMITTED for protected mutations. Serialization/deadlock failures must abort the whole operation and be reported; they must never be counted as successful mutations. Audit rows must correspond only to committed service changes.

| Scenario | Coordinated schedule | Required assertions |
| --- | --- | --- |
| Registration at capacity | Leave one entrant place; release two distinct verified entrants together. Hold one transaction before commit so the other genuinely waits. Repeat with direct SQL. | Exactly one new entrant commits; no over-capacity state; losing service operation creates no registration/roster/audit residue. Database direct write also rejects overflow. |
| Duplicate player across teams | Two team entrants try to add the same player simultaneously. Reverse the winning order in another run; also test withdrawn-entrant reactivation. | At most one active roster contains the player; duplicate insert/update/reactivation is rejected by PostgreSQL independently of service validation. |
| Duplicate ordinary check-in | Release two requests for the same authenticated player's ordinary attendance. | One stable receipt and one successful attendance audit; both retries may return the same success, without timestamp replacement. |
| Floor 2 protection consumption | One valid personal pending request; release two protected check-ins before the deadline. Also attempt a second completed request directly. | One completed request/used incident, one approval audit, one receipt; retries are idempotent. The partial unique index/consumed-incident guard rejects another consumption/reset. |
| Lock versus protected arrival | Race an independent finalizer with the eligible player's late check-in. Exercise both lock acquisition orders, at a valid time and after expiry. | Before deadline, either attendance commits first and is included, or finalization returns pending. Never premature disqualification or stale successful classification. After expiry, no new protected attendance is accepted. |
| Concurrent finalizers | Release two authorized independent finalizers together. | Exactly one immutable snapshot; loser does not create partial locks or duplicate audits. |
| 63 versus 64 | Register 64 solo entrants; confirm 63 and resolve the remaining absence, then repeat in another event with 64 confirmed. Race the final arrival/withdrawal with finalization where timing permits. | Ordinary/count63 versus Grand/count64; exact relational/JSON entrant and active-player sets; post-lock withdrawal does not alter the snapshot. No brackets or rewards generated. |
| Snapshot bypass/immutability | Directly insert a count of 64 against a smaller valid roster; omit entrants, alter active flags, include absent/ineligible starters; then update/delete a valid snapshot or edit locked settings/rosters. | PostgreSQL rejects each mismatch/change. A self-consistent stored count/classification pair alone must not bypass relational validation. |

Repeat contention schedules sufficiently to cover both arrival orders; preserve sanitized test artifacts showing session IDs, acquisition/commit order, SQLSTATE/outcomes, counts and baseline comparisons. The harness must call actual services and direct SQL in separate cases. No native harness was executed or certified during the current in-memory remediation.

## Cleanup and completion

Compare historical baselines before cleanup, and again after removal of synthetic data if selective cleanup is authorized. Snapshot/history delete guards intentionally prevent ordinary row-by-row deletion of immutable records: prefer disposal of the explicitly authorized disposable branch after retaining sanitized results. Never disable guards to clean a shared database. Branch disposal needs the owner's explicit cleanup authorization and a fresh exact identity check.

Re-run automated tests, TypeScript, Prisma validation, builds and dependency audits. Report native concurrency and preservation independently from in-memory results. A production migration, push, deployment or Phase 5 still requires separate explicit authorization.
