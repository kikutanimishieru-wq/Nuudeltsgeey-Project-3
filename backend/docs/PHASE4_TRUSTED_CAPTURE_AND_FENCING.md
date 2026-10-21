# Phase 4 trusted capture and cross-host fencing — local safeguards

2026-10-19. Operational verdict: **BLOCKED**. Local verifiers and a pure fencing reference model are implemented; no live database authority, gate or lease is installed or activated.

The reusable environment design, operator guide and all nine initial implementation files were read before changes. The design and V4 evidence remain unchanged. No native test, migration, Neon connection, branch operation, cleanup, deployment or push was performed. Existing native empty-data/target guards and migration pins remain intact. Target policy remains disabled; cleanup and mutation authorization entry points always reject.

## Files changed in this phase

| File under backend | Change and purpose |
| --- | --- |
| scripts/phase4-reusable/capture.cjs | New independently signed database-evidence verifier, constrained capture signer, receipt verifier and run-seal verifier |
| scripts/phase4-reusable/fencing.cjs | New pure lease/CAS reference model and mutation-proof validator; real mutation entry point is disabled |
| scripts/phase4-reusable/manifest.cjs | Require transactional-v2 database evidence and a complete independent run seal; reject transaction replay |
| scripts/phase4-reusable/dry-run.cjs | Require capture installation evidence, pass verification time and reject database transaction replay across manifests |
| scripts/phase4-reusable/policy.cjs | Require four distinct signing key identities; include new verifier sources in source pins; disabled policy unchanged |
| scripts/phase4-capture-test-fixtures.cjs | New synthetic evidence builders used only by local tests; no real database facts or persistent keys |
| scripts/test-phase4-capture-fencing.cjs | New 22 simulation-only regressions for capture evidence, outcomes, fencing and disabled-operation safeguards |
| scripts/test-phase4-reusable.cjs | Upgrade existing test fixtures to independent evidence/seals; SQL test now explicitly opt-in and force-skippable |
| scripts/test-phase4-schema.cjs | SQL test now explicitly opt-in and force-skippable |
| docs/PHASE4_REUSABLE_NATIVE_INFRASTRUCTURE.md | Update current receipt/key/seal requirements and link this report; retain earlier verification history |
| docs/PHASE4_TRUSTED_CAPTURE_AND_FENCING.md | This design, workflow, integration matrix and operational-blocker record |

Other workspace edits predate this task and were preserved.

## Trusted capture authority

Four separate Ed25519 trust identities are required: manifest writer, capture signer, inventory signer and independent database observer. Policy validation compares actual public-key identities, not PEM formatting. No live trust keys were generated or configured; tests generate ephemeral synthetic keys. The observer key must be unavailable to the runner, manifest writer and capture signer. The capture signer must have no endpoint that accepts a claimed committed outcome as evidence.

Journal chain format remains version 1. Accepted receipt protocol is now `transactional-v2`; old `transactional-v1` signatures/claimed outcomes fail closed rather than being grandfathered into ownership. Receipt fields bind run/case, request transaction UUID, intent digest, exact target, lease fence/ID, installation epoch, full database transaction ID, backend session identity and source/schema/ledger installation pins. Source operations carry exact table/key, fixture UUID, row digest and expected relationships. Default UUID children must be observed through capture, not identified by scanning current rows.

`issueCapture()` verifies an independently signed database-evidence envelope before signing anything. `verifyCapture()` independently verifies both signatures and compares outcome/session/operations and scope exactly. The worker cannot manufacture a source proof using a manifest, capture or inventory key. Policy/source/target mismatches, future-dated observations, invalid scopes and absent installation evidence reject. Historical immutable receipts are verified at their attested observation time, while the dry-run requires a separately fresh identity/inventory and currently unexpired approved target.

Outcome rules:

| Outcome | Required independent evidence | Local treatment |
| --- | --- | --- |
| COMMITTED | Independently visible committed outbox marker; complete ordered effect digest/count; same-transaction capture and atomic fence/gate proof; identity/session/full transaction binding | Reconstruct exact owned operations, subject to complete run seal and inventory checks |
| ROLLED_BACK | Retained terminal server abort evidence for that exact full transaction/session; no committed operations | Own no rows; never erase another transaction's commits |
| UNKNOWN | Explicit uncertainty, such as lost acknowledgement, absent marker without terminal proof or interrupted capture | Own no operations from that transaction; entire run remains blocked |

Client success, a worker-signed outcome, marker absence, plausible rows, timestamps and names are explicitly insufficient. A marker missing from one observation may indicate an in-flight transaction; it is not proof of rollback. The full database transaction ID plus installation epoch prevents ordinary transaction-ID wraparound/reprovision replay; the deployment must still detect restored/duplicated installation epochs.

The observer-signed end seal binds final inventory digest, run/fence and the exact complete transaction/evidence-digest set. It requires closed admission, settled sessions, zero unresolved transactions and an exclusive gate. A worker cannot omit an inconvenient transaction or substitute a capture-only end assertion. Database transaction reuse is rejected within and across supplied manifests. The existing hash chain still detects accidental event changes/gaps, and exact inventory matching prevents adopting unknown rows. A source capture authority must attest to a complete run scope, not merely sign a worker-selected subset.

**Boundary:** local signature/schema checks validate attestations; they do not make those attestations true. No real observer, outbox reader, abort-status reader or capture database adapter exists in this release. Synthetic signed objects are test inputs, not database-verified proof. All live use stays blocked until the authority's evidence generation and custody are independently reviewed and integration-tested.

## Database-backed lease and mutation gate design

The intended future implementation uses an installation-specific control schema inside the isolated test database, separate from the seven application migration records. Its installation and added capture/gate objects require explicit owner and architecture approval and new installation fingerprints. No installation DDL, callable database writer or lease-activation command is included here.

One durable gate row is keyed by exact target and installation epoch. It stores monotonically increasing generation/fence, CAS version, holder/run/lease IDs, state and database-time expiry. The epoch changes only through reviewed reinstallation; no counter reset, TTL takeover or branch-name-based identity is permitted. A future privileged coordinator acquires it atomically; worker machines never allocate fences themselves. A local file lock is not a cross-host coordinator.

Intended protocol:

1. Acquire only a FREE or provably RELEASED gate with atomic compare-and-swap under a database lock. Exactly one competing host can receive the next generation. Bind the authorization to target/epoch/run/holder/lease ID. Ensure branch lifetime covers lease, maximum transaction duration and recovery margin.
2. Before **every** mutating statement/row path, a restricted server-side gate/capture mechanism obtains a shared row lock on that gate, validates all bindings and actual database-clock expiry, then captures all row effects in the same transaction. Hold the gate lock through commit/rollback. Ordinary SELECTs need not take a global exclusive lock; independent sessions may hold shared gate locks concurrently and still race on application rows.
3. Include direct SQL, nested Prisma writes, batch operations, audit writes, cascades and changes made by triggers. A custom GUC, application_name or worker-provided run ID is a label, not authorization. Only privileged admission procedures may bind a real backend identity/full transaction to a current authorized run. Capture/gate paths must not be optional for the worker role.
4. Gate generation changes/renewal require the conflicting privileged lock/CAS and fresh database time. Shared locks may delay renewal until admitted transactions settle. Choose transaction/lease budgets accordingly and renew during verified idle boundaries; never break a worker's gate lock to make renewal succeed. If renewal cannot complete before expiry, close/quarantine and settle instead of assuming a heartbeat extended authority. The local model permits bounded TTLs up to ten minutes; this is not a claim that current test budgets have been integrated.
5. Once a gate is expired, draining or quarantined, reject new mutation admission, including delayed statements from an old worker. Expiry does not undo previous commits or prove that all backends stopped. A pre-expiry transaction can still be in flight; no new generation is issued until exclusive drain and terminal-outcome reconciliation prove the old generation cannot commit further work.
6. Release/recovery requires a privileged supervisor holding the exclusive gate, reconciling every admitted backend/full transaction and producing independent closure evidence. Do not kill unidentified sessions or automatically retry uncertain mutations. If gate acquisition, commit observation, renewal or session settlement is uncertain, quarantine. Restarting another host is not evidence of release.

For real enforcement, the test worker must lack schema ownership, trigger-management, TRUNCATE, replication-role changes, control-table writes, alternate ungated roles and credentials to other databases/branches. Capture/gate functions need reviewed privilege boundaries and a fixed search path. Keep all existing immutable-history trigger definitions and behavior intact. An extra trigger that records ownership must never disable, bypass or reinterpret them. Any mechanism that cannot cover every write path and isolation level atomically is unacceptable for execution.

Under SERIALIZABLE/Repeatable Read, gate-row locking must reject an outdated snapshot or abort the transaction rather than authorize stale ownership. Verify this against the actual server version; a plain snapshot read or startup-only lease check is not sufficient. The new reference model does not implement PostgreSQL locks, triggers, privilege checks or isolation semantics.

## Local fencing implementation and its limits

`fencing.cjs` is explicitly `REFERENCE_MODEL_ONLY`. Pure transitions model acquire, renew, drain and quarantine using expected CAS versions, database-time input, monotonic generations, holder/run/lease/epoch bindings and expiry. Simulated concurrent acquisition has one CAS winner. Delayed tokens and late renewals reject. Expired holders cannot be replaced automatically. Clock regression relative to the last modeled transition rejects; actual database clock-jump behavior still needs verification.

`assertAuthority()` checks each **simulated** admission. `verifyMutationProof()` validates the independently signed observer's same-transaction gate/capture evidence and exact row-effect coverage. Neither returns a live database mutation permit. `authorizeDatabaseMutation()` always throws `ATOMIC_DATABASE_FENCING_NOT_INSTALLED`; `executeCleanup()` remains an unconditional rejection. Release/recovery is deliberately unavailable in the model because no database closure proof implementation is installed. CAS against an in-memory object does not establish distributed linearizability or durability.

Production, V2, V3 and V4 remain excluded. Approved policy stays disabled with null target/keys. No command, callback or environment flag enables database mutation. Existing V4 provenance is unresolved and cannot be repaired with synthetic capture receipts.

## Operator/recovery workflow and approvals

Current permitted workflow is local code review and pure regression tests. Offline dry-run still returns BLOCKED and authorizes zero deletions. Preserve all old journals and diagnostics; legacy receipts fail closed, with no automatic conversion or retrospective ownership adoption.

Before any future database work, obtain separate approvals for:

1. Exact isolated target/database/OID/role, installation epoch, expiry, production isolation and trust-key custody.
2. Architecture/install plan for control objects, exhaustive same-transaction capture and atomic gate enforcement, including unchanged application migration ledger and immutable-history triggers.
3. A bounded real PostgreSQL integration exercise with synthetic records and independent sessions. Native behavior tests require their own explicit authorization.
4. Any cleanup implementation/activation or actual fixture deletion. This release contains neither; test execution approval does not grant cleanup authority.

For interruption/lost acknowledgement: close admission, preserve local evidence, quarantine the generation and obtain independent terminal evidence. Do not replay the write or infer rollback from disconnect/marker absence. Produce a complete observer-signed run seal only after all registered sessions and transactions settle. If any evidence has aged out or cannot be reconciled, ownership stays UNKNOWN. For branch expiry, stop; do not extend, retarget or create a replacement automatically. Reinstallation/restoration must never silently reuse a prior epoch/fence counter.

## Required real PostgreSQL integration matrix

Use a separately approved, disposable, empty, dedicated test database with restricted worker roles, the reviewed seven migration pins, reviewed control objects and independent sessions on at least two hosts. Use exact-target control-plane/TLS/SQL attestation; preserve before/after catalog and full-ledger evidence. No production or V2/V3/V4 database may be used for these tests. Provisioning, control-object installation and fixture writes each need explicit approval; the current no-database task authorizes none.

| Unverified behavior | Required database-backed experiment |
| --- | --- |
| Atomic fencing | Exercise every helper/service/direct SQL/batch/nested/trigger path; show gate validation and capture occur in the same transaction with the gate lock held through outcome |
| Concurrent acquisition | Simultaneous acquisition from two real hosts, lost replies and coordinator restart; prove one generation/holder and durable monotonic fence/CAS |
| Expiry and delayed workers | Delay requests before/after expiry and during renewal, inject clock changes; reject new expired mutations and reconcile already admitted commits before takeover |
| Independent commit verification | Commit/abort racing sessions; observe markers through a separate connection, verify full transaction identity, and show one rollback leaves the other's commit intact |
| Interrupted capture | Crash before write, during nested/batch writes, before/after commit and after lost acknowledgement; verify all-or-none capture, no ownership inference, retained terminal-abort proof or UNKNOWN |
| Signed journal consistency | Omit/substitute transaction receipts, truncate journals, lose end seals and replay epochs/XIDs; verify independent run-scope completeness and inventory binding |
| Serializable conflict | Produce actual SERIALIZABLE conflict with independent sessions and gate locks; verify stale snapshots fail safely and only an explicitly authorized aborted transaction is retried |
| Multiple-host crash recovery | Partition/kill runner and coordinator, delay old worker, restart authority and restore database; block takeover until exclusive drain and verified epoch/session reconciliation |
| Privilege/isolation boundaries | Attempt ungated writes, control-record edits, trigger disable, alternate role, schema/replication changes and target substitution; all must fail without altering original triggers |
| History/cleanup compatibility | Verify snapshot and lateness DELETE protections remain effective; keep cleanup disabled until a separate reviewed mechanism preserves migration/catalog/history requirements |

## Verification record and blockers

Final local results:

- Python unit tests: **44 passed**, zero failed/skipped (`python3 -m unittest discover -s backend/scripts -p 'test_phase4_*.py'`).
- JavaScript unit tests: **66 total, 64 passed, 2 intentionally skipped, zero failed**. This includes 22 new capture/fencing simulations. The skipped tests are the existing PGlite inventory and expanded catalog SQL tests.
- TypeScript: `tsc --noEmit --incremental false` passed.
- Python AST parsing, JavaScript syntax checks and whitespace checks, including new files, passed.
- Native behavior tests, migrations, real PostgreSQL integration and cross-host deployment checks were not run. No result here certifies a real database transaction or a distributed service.

The guarded JavaScript command was:

```text
cd backend
PHASE4_NO_DATABASE_TESTS=1 node --test scripts/test-phase4-capture-fencing.cjs scripts/test-phase4-reusable.cjs scripts/test-phase4-reporter.cjs scripts/test-phase4-duplicate-check.cjs scripts/test-phase4-native-target.cjs scripts/test-phase4-schema.cjs
```

Pure tests use generated signatures and simulated coordinator/database evidence. They do not prove PostgreSQL concurrency, atomic fencing, marker durability, abort evidence retention or cross-host crash recovery. Do not opt into the SQL tests under the current authorization.

One verification mistake occurred: the initial test-name filter did not exclude the existing in-memory PGlite inventory test, and it ran temporary local table setup. No Neon connection, migration or native behavior test occurred. Both SQL/PGlite tests now default to skipped unless explicitly opted in; `PHASE4_NO_DATABASE_TESTS=1` overrides any opt-in and was used for subsequent checks. No later database operations are authorized or intended in this task.

Operational blockers remain: no approved isolated target; no deployed trusted observer/capture authority; no database-backed CAS/gate/privilege installation; no independently verified real transaction outcomes or interrupted-capture recovery; unresolved V4 ownership; immutable-history reset incompatibility; no enabled cleanup; and no real PostgreSQL integration evidence. These are not replaced by passing local simulations. Operational reuse stays **BLOCKED**.
