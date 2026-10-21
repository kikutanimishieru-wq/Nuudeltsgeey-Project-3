# Phase 4 reusable native environment — design for review

Date: 2026-10-19. READ-ONLY INVESTIGATION AND DESIGN ONLY.

Decision: retain real, independently committed PostgreSQL transactions; introduce durable fixture ownership and a dedicated reusable database with exclusive test access. A new Neon branch is not needed per run. Existing V4 cleanup is **BLOCKED**: test-like data and relational linkage do not establish deletion ownership. No cleanup implementation or executable cleanup command is supplied here. The current empty-data guard remains unchanged.

## V4 provenance and its limits

Read-only queries explicitly targeted project `rough-snow-56584532`, branch `br-withered-mode-b528hnhk`, compute `ep-delicate-poetry-b5bbwllj`, database `neondb`. The earlier investigation verified endpoint attachment, hostname, expiry and migration checksum matches. This review re-enumerated all 37 public application tables from the database catalog, not a guessed fixture-table list. Seven migration records remain complete; sixteen noninternal triggers exist.

All 187 users match the native helper's ID shape, exact email derived from ID, public identity equal to ID, and disabled synthetic password marker. One run prefix exists. Creation timestamps span 2026-10-19 18:02:01–18:14:49 Asia/Ulaanbaatar, before the 18:22 early failure. The sanitized failure report contains neither a run ID nor a fixture inventory, so it cannot identify the earlier invocation, operator, source revision, authorization or individual transaction outcomes.

| Populated table | Rows | Evidence consistent with native fixture ownership |
| --- | ---: | --- |
| User | 187 | Exact helper markers, one run prefix |
| PlayerProfile | 187 | Prefixed ID/nickname; linked synthetic user; no home cafe/current team |
| ExternalIdentity | 374 | Linked synthetic user; STEAM/DISCORD provider |
| Team | 6 | Prefixed ID/name; synthetic captain; no cafe |
| TeamMembership | 23 | Both endpoints in synthetic graph |
| Tournament | 16 | Prefixed ID; synthetic host and venue; Phase 3 policy; no cafe |
| TournamentRegistration | 142 | Synthetic event; any team/solo endpoint in graph; 130 prefixed IDs |
| TournamentRosterMember | 151 | Synthetic registration/player; 131 prefixed IDs |
| TournamentRegistrationPolicy | 16 | Synthetic event and expected Phase 4 rules version |
| TournamentLatenessClaim | 2 | Synthetic event/player and optional decision actor; no match |
| TournamentLatenessRequest | 2 | Linked event/claim; no match |
| TournamentLockSnapshot | 3 | Synthetic event and referee; all 128 embedded entrant players resolve to the recorded user/profile and event registration |
| AuditEvent | 29 | Synthetic actor/event; all entity IDs resolve to event, registration, roster member or lateness request; no match |

All other 24 application tables are empty. Six roster-change audit rows have `entityType=TournamentRegistration`; treating every audit as `Tournament` would falsely classify them. Their metadata is expected to include prior/next roster JSON strings. The other observed actions are registration, lateness request/use, self-check-in, post-lock withdrawal and finalization. Default UUID child IDs are expected: the service does not use the native run prefix for every inserted record.

No positively identified real or shared record was found. Nevertheless, these are **candidate fixtures**, not a deletion allowlist. Any manually added row linked to a test event can look equally plausible; prefixes and timestamps are forgeable. The graph checks are not an exhaustive attestation of every field or embedded JSON reference, and there is no durable pre-write ownership manifest. Thus reliable attribution of every existing record to an authorized Phase 4 operation is **not proven**. All existing rows remain protected from cleanup, including the plausible synthetic graph. There is no safe automatic partition into deletable and protected V4 records under the proposed ownership policy. Do not retroactively grant ownership merely by scanning these markers.

## All thirteen test cases and their writes

All cases create committed helper fixtures: users/profiles/external identities, event hosts/events/policies, and sometimes teams/memberships. Helpers use independent autocommit/nested operations or batch transactions. Service calls use separate interactive transactions. Rejected writes roll back their transaction, not earlier helper commits.

| Case | Additional writes and concurrency | Retained state / cleanup consequence |
| --- | --- | --- |
| N01 last capacity slot | Registration/roster/audit; two service sessions compete; one commits | Successful entrant and earlier fixture commits survive loser rollback |
| N02 cross-team participation | Two teams, direct concurrent registrations, transaction-local setting and fixed DO wrapper inserting roster | Winner commits; loser aborts; settings are local and wrapper creates no schema object |
| N03 identity/substitutes | Identity administrative hold; team registrations; roster additions/removals and audits for 2v2/3v3/5v5 | Includes service deleteMany during valid pre-lock roster editing; cannot identify all rows solely by ID prefix |
| N04 self-check-in | Reschedule event/policy; concurrent roster receipt update and audit | Idempotent committed receipt must remain visible across sessions |
| N05 Floor 2 lateness | Two entrants; reschedule; racing claim/request and consumption; roster/audits | Committed lateness history is deliberately undeletable by normal DELETE |
| N06 expired protection | Entrant and schedule changes; late request rejected | Setup survives rejection; deny path must not be assumed to undo earlier commits |
| N07 finalize vs late arrival | Entrant, lateness request, reschedule; finalize/check-in race; conditional domain retry | Lateness history plus immutable final snapshot may survive |
| N08 63 starters | Bulk users/identities, seeded entrants/rosters, reschedule; concurrent finalization; post-lock withdrawal/audit | Immutable snapshot; attempted snapshot UPDATE/DELETE must fail |
| N09 64 starters | Same as N08 at threshold | Separate case, same preservation blockers |
| N10 SERIALIZABLE conflict | Two sessions read/update event name; one aborts; explicit new transaction retries loser | Requires independent transactions and a real winner commit; outer rollback cannot undo it |
| N11 direct capacity/fabrication | Seed entrants; rejected capacity insert; second event scheduled and roster/status locked; fabricated snapshot rejected | Locked registrations/event remain even though fabricated snapshot does not |
| N12 bench/referee | Teams/rosters/audits, reschedule, direct check-in timestamps, captain role changed, valid referee finalization | Immutable snapshot and changed fixture user role |
| N13 late registration vs locking | Seed attended entrant, reschedule; finalize/registration race | Winner snapshot and audit remain; no blind retry of loser |

Current queries generally scope behavior assertions to fresh events/users. Host quota and identity uniqueness still require fresh users and provider IDs for every run. Review any future global aggregate/query before allowing multiple run scopes to coexist. Partial counts cannot certify completion of all thirteen cases.

## Strategy comparison

| Strategy | Concurrency fidelity | Repeatability and safety |
| --- | --- | --- |
| One outer transaction/savepoint, rollback at suite end | Insufficient | Other sessions cannot see uncommitted setup. Serializing everything onto one connection changes the behavior under test; independently committed service/direct transactions escape the outer rollback. Process interruption also defeats client-managed coordination. |
| Fresh run/case scopes, keep committed rows | Preserves current transactions | Useful interim mode in an exclusively owned test database. Append-only runs avoid cleanup, but grow indefinitely; all queries and uniqueness-sensitive helpers need scope review. Requires a reviewed replacement for the empty guard; do not just remove it. |
| Scoped DELETE by exact manifest keys | Preserves tests | Supports unlocked fixtures only. Snapshot immutability, lateness-history no-delete and locked-roster guards prevent a complete suite reset. Do not disable triggers, change replication role, unlock events or weaken policies to make deletion work. |
| Atomic whole application-table reset in an exclusive, proven test database | Preserves tests and schema | Recommended bounded-storage reset between suites. Requires explicit cleanup authorization, complete ownership proof for every row, quiescent sessions and exact object inventory. Never applicable to a mixed or unproven database. |

PostgreSQL documents that Read Committed cannot see other transactions' uncommitted setup; sequences also have rollback exceptions ([transaction isolation](https://www.postgresql.org/docs/18/transaction-iso.html)). PostgreSQL TRUNCATE is transactional, takes exclusive locks and skips DELETE triggers ([TRUNCATE](https://www.postgresql.org/docs/18/sql-truncate.html)). That makes a future explicit all-table TRUNCATE design technically compatible with immutable history **only inside an exclusively owned test database**; it is not a service deletion mechanism or authorization to clear V4. No CASCADE, RESTART IDENTITY, schema drop, trigger alteration or migration-ledger truncation is permitted by this design.

## Recommended isolation and ownership contract

Provision one explicitly approved, dedicated Phase 4 database on the approved testing branch, then reuse that database for many suites. This avoids requiring a new branch after a failure. Database name, role and database OID must be pinned in a reviewed policy; the existing `neondb` guard is not silently repurposed. Existing V4 `neondb` records stay untouched. One-time provisioning and initial migration setup require a separate authorized implementation task. Future branch expiry/replacement remains an occasional lifecycle decision, not a per-test operation.

Use a test worker role confined to that database, with no production/V2/V3 connectivity and no schema-owner, TRUNCATE or trigger-management rights. A separate cleanup capability may reset only the exact approved application tables. Neither capability should possess credentials for other databases/branches. Validate required privileges against native behavior before adoption; role-name assertions and ownership-sensitive catalog normalization must be deliberately updated and reviewed. Production is never a fallback when a test connection is missing.

Keep the seven pinned migration files and ledger entries unchanged. The dedicated database must start from a reviewed empty application baseline and exact migrated catalog. Any migration-created reference rows must be identified beforehand: this design's whole-table reset is forbidden if such rows need retaining. Test-control state belongs outside the migration-managed application schema (for example a restricted external control store), so its introduction does not alter migration fingerprints.

Each run receives a cryptographically random run ID and each case its own scope. Before any fixture commit, durably record target identity, source/migration/catalog digests, run/case, intended root keys, expected table writes and authorization. For default-UUID service children, record exact keys and ownership in the same database transaction using an approved instrumentation mechanism or restricted transactional outbox whose setup is separately reviewed. An external log written only after commit leaves a crash window and is insufficient. An external write-ahead intent can cover that gap only if its bounded operation and generated keys can be reconciled unambiguously after a crash. If that cannot be demonstrated, leave ownership UNKNOWN and block reset.

Ownership requires manifest membership plus expected creation operation and all root/child relationships; prefixes, email suffixes and graph reachability are corroboration only. Track changed/deleted fixture rows as well as inserts, including service-side audit writes. Enumerate primary keys, composite keys, non-FK references (audit entity IDs and JSON snapshots/roster metadata), inbound/outbound FKs and cascading/SET NULL effects. A row owned by another run or an unexplained reference is protected. Unknown records must never be adopted automatically into a cleanup set. No shared reference/real data is allowed in the reusable database.

## Mandatory exact-target verification

Before dry-run and again immediately before a future mutation:

1. Require a reviewed, exact positive allowlist for project, branch ID, endpoint ID, direct hostname, database name/OID, role, expiry and operation. Reject omitted targets, URI overrides, poolers, alternate hosts, stale policy and ambient DATABASE_URL/DIRECT_URL. Read credentials through existing hidden-input controls; never log them.
2. Query Neon metadata to verify endpoint-to-branch attachment, project ownership, ready state, nondefault/nonprimary/unprotected status, approved initialization and pinned expiry with sufficient margin for cleanup plus verification. Reject V2/V3 and production identifiers explicitly, but rely on the positive allowlist to reject every other branch too. Cross-check against the live project's production/default endpoints; a branch name alone is never evidence.
3. Require strict TLS/hostname validation and approved engine/options. Query current database/user, database OID and server identity on the connection that will be used. SQL identity alone cannot prove a Neon branch; both control-plane attachment and validated connection host are required. Recheck during the operation boundary; retain the evidence receipt.
4. Compare all seven finished/nonrolled-back ledger rows, checksum pins and exact catalog/security fingerprint. Reject extra tables, partitions, views, foreign tables, triggers, functions, references or unreviewed metadata. Require the database's installation receipt and ownership baseline.
5. Acquire a cross-host run lease with fencing, not just the current local flock. Stop admission of new work; settle all contenders, disconnect clients and prove no identified run session or unresolved prepared transaction remains. Use dedicated role/application_name plus recorded session identity; PID alone can be reused. Inspect other writers and block if they cannot be excluded. Never terminate an unknown session automatically.
6. Cleanup is a separate, explicitly authorized operation bound to a fresh dry-run digest, exact target and run inventory. Dry-run permission or native-test permission does not authorize deletion. Current connector permissions are read-only and cannot execute cleanup.

## Dry-run contract

Dry-run runs only SELECTs in a bounded consistent READ ONLY transaction; it must never perform a deletion and then roll it back as a simulation. It does not acquire mutation authority. Produce a protected, credential-free review artifact with:

- Exact target receipt, timestamp/expiry, schema/ledger digests, source policy and fixture manifest version.
- Every application table, including zero-row tables; total, proven-owned, protected and unknown counts; exact primary/composite keys for every proposed deletion; per-key ownership evidence paths and content digests. Summary output may use counts, but a restricted exact-key artifact is required for review. Do not print row contents, credentials or personal data in console output.
- All FK and non-FK dependencies, cross-run links, cascade/SET NULL side effects and deletion blockers. Show row ownership uncertainty separately from trigger restrictions.
- Proposed mechanism and scope: either a permitted exact-key DELETE subset or a whole-table reset requiring **all** rows to be proven owned. No broad LIKE filter or timestamp cutoff is deletion authority.
- Result `BLOCKED` for any unknown/protected row in a whole-table reset, manifest gap, active/uncertain session, schema drift, target discrepancy or preservation blocker. For V4 the current result is BLOCKED and approved deletion count is zero, even though all populated tables have plausible fixture links.

A dry-run is a snapshot, not a promise about future rows. Bind approval to its digest and short validity; regenerate and compare under exclusive locks inside the eventual cleanup transaction. Any changed key set, row digest, object inventory or lease invalidates the plan.

## Future cleanup and failure protocol

Only after separate approval and implementation: hold the fenced lease and one bounded cleanup transaction; lock the exact application table set in stable order before re-enumerating rows and rechecking the plan. Quiescence and exclusive locks close the dry-run/write race. Validate every row's ownership and the full catalog while locked. If all checks pass, reset the explicit application-table set together with RESTRICT semantics and without resetting sequences. `_prisma_migrations`, control state and every nonapplication object are excluded. No inferred cascading tables are permitted.

Verify zero rows in every expected application table and unchanged ledger/catalog/sequence state **before COMMIT**; any failed condition aborts the whole transaction. Commit only if the lease and target receipt remain valid. Verify again on a fresh read-only connection before declaring CLEAN. Document that skipping DELETE triggers is an explicitly reviewed maintenance operation, confined to this test database. If whole-table reset is not acceptable under governance, use append-only scoping and planned environment retirement instead; normal DELETE cannot reset these immutable fixtures.

On cleanup statement error, timeout or signal, request rollback and verify on a fresh connection. If rollback is confirmed, the pre-cleanup state must be intact. If commit acknowledgement is lost or server work might continue, record UNKNOWN, quarantine the environment and inspect transaction/session state and exact pre/post inventories read-only. Do not retry automatically or start another suite. A cleanup receipt lost after a successful commit does not imply cleanup failed. Atomic transactions prevent intended partial deletion; a partially deleted observed state indicates a broken protocol or external writer and requires investigation.

After a failed/interrupted test, distinguish intended inserts, observed committed rows and aborted transactions using the durable intent/outbox. Preserve diagnostics; settle server transactions before making cleanup decisions. Rollback the losing SERIALIZABLE transaction and retry only that aborted transaction when the case explicitly calls for it; cleanup never retries uncertain fixture work. Any unexplained committed row blocks reset. Recovery ownership must survive process death and machine loss; a missing manifest is a block, not permission to infer ownership from current contents.

## Post-cleanup verification

Required evidence is broader than a count on known fixture tables:

- Re-enumerate the exact application relation set and count all 37 tables, including currently empty ones. No owned residue, unknown rows, or missing/extra relation may remain. Match the approved baseline if a later design explicitly supports preserved reference data; the current whole-table mode requires all zero.
- Preserve the exact seven migration rows (all fields, not just names), their completed state, checksums and local pinned file digests. No ledger rewrite, replay or history deletion.
- Compare before/after normalized definitions, ownership and security for tables/columns/defaults, constraints/validation, indexes/validity, enums, functions, triggers/enabled states, views, partitions, sequences, policies and ACLs. Preserve relevant migration-managed metadata and sequence state captured immediately before cleanup; tests themselves may have advanced sequences.
- Revalidate FK integrity and audit/snapshot reference rules, approved database identity, absence of surviving test transactions, run fencing and clean-state receipt. Unknown object classes or normalization gaps fail closed.
- Only `CLEAN_VERIFIED` unlocks the next suite. `TEST_FAILED`, `DIRTY_KNOWN`, `OWNERSHIP_UNKNOWN`, `CLEANUP_UNCERTAIN` and `SCHEMA_DRIFT` remain distinct states; none silently means reusable.

## Implementation plan and regression acceptance

1. Review this design and choose exclusive-database reset versus append-only retention. Keep V4 protected. Approve a specific one-time environment setup independently of test/cleanup execution.
2. Implement a pure exact-target policy validator and normalized catalog/ledger inventory. Extend existing guard tests to database/role boundaries; do not loosen current pins as a shortcut.
3. Implement durable transactional ownership capture and fenced cross-host lifecycle control. Cover every helper and service/default-UUID write from the thirteen-case matrix; demonstrate crash reconciliation before enabling cleanup.
4. Implement read-only provenance/dry-run tooling first, with exact-key protected artifacts and fail-closed ownership decisions. Review its output before implementing mutation.
5. Implement the separately gated atomic cleanup path and pre/post checks. Keep all mutations unreachable from import, dry-run, normal test discovery or an unapproved CLI invocation.
6. Add local policy/mocked regression coverage: production/V2/V3/wrong endpoint or database/expired target rejection; metadata spoofing and missing target; forged prefixes, orphan UUID children, shared references, unknown JSON/audit links and one unknown row in any otherwise empty table; exact zero-table enumeration; unchanged migration rows/catalog; no SQL mutation during dry-run; stale digest and concurrent-writer rejection; lease loss; rollback and lost-COMMIT handling. Include real local PostgreSQL integration tests for independent-session visibility, default-UUID atomic ownership capture, immutable DELETE rejection, transactional reset rollback, FK RESTRICT behavior and unchanged object inventory. PGlite/mocks alone cannot certify native concurrency or reset safety.
7. In a separately authorized test database, prove two full consecutive suites with a verified reset between, plus failures after each fixture phase, after a winner commits, during loser rollback/retry, during cleanup and immediately around COMMIT acknowledgement. Assert all thirteen behavior results, distinct native sessions and preserved SERIALIZABLE conflict. Never blindly replay an uncertain operation.
8. Enable a workflow of exact-target preflight → verified clean baseline → owned run scope → native suite → diagnostics/transaction settlement → explicit dry-run review → separately authorized atomic cleanup → fresh clean/schema receipt. Any failed safeguard stops admission. A failed test can then reuse the same branch/database after verified recovery, without another branch per failure.

No runtime code was changed, no native test was run, no migration was executed, and no database mutation or cleanup was attempted. Existing diagnostics and workspace changes remain preserved. Proposed regression cases above are acceptance criteria, not tests claimed to have run. Design status: **READY FOR REVIEW**. Existing V4 cleanup status: **BLOCKED**.
