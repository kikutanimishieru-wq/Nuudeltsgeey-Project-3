# Phase 4 local ownership and dry-run infrastructure

Implemented 2026-10-19. Local code review only; no remote operations are enabled.

The subsequent [trusted capture and fencing update](PHASE4_TRUSTED_CAPTURE_AND_FENCING.md) strengthens the initial implementation described here. It requires transactional-v2 receipts, a fourth independent observer key, and an observer-signed run seal. Legacy claimed-outcome receipts are no longer accepted. The original file/test counts below record the initial phase; see the update for current verification results and remaining operational blockers.

Both reference documents were read completely before changes. Their V4 evidence is historical provenance evidence, **not** a signed ownership inventory and not an authorization to delete anything. This change leaves the native launcher, all thirteen cases, existing empty-database guard, migrations, target pins, V4 records and diagnostics unchanged.

## Files added

| File under backend | Purpose |
| --- | --- |
| scripts/phase4-reusable/common.cjs | Canonical JSON, SHA-256 digests and Ed25519 signing/verification; fixed error codes |
| scripts/phase4-reusable/policy.cjs | Disabled exact-target policy, explicit historical/production rejection, seven checksum pins, local source/migration and inventory preservation validation |
| scripts/phase4-reusable/manifest.cjs | Private durable append-only signed journal; transaction/capture validation; exact fixture ownership reconstruction |
| scripts/phase4-reusable/inventory.cjs | All 37 model tables, exact primary/composite keys, FK and embedded-reference extraction; one fixed inventory SELECT |
| scripts/phase4-reusable/dry-run.cjs | Signed inventory and manifest analysis; counts, keys, unknowns/dependencies/blockers; pure post-clean comparison |
| scripts/phase4-reusable/executor.cjs | Approval/transaction boundary contract and permanently disabled executor stub |
| scripts/phase4-reusable/cli.cjs | Offline dry-run command; protected report output and redacted console summary |
| scripts/test-phase4-reusable.cjs | 27 local regression tests, including in-memory inventory SQL validation |
| docs/PHASE4_REUSABLE_NATIVE_INFRASTRUCTURE.md | This operator guide and implementation/verification record |

No pre-existing file was modified in this implementation task. Pre-existing workspace edits were preserved.

## Ownership format and authority boundaries

Version 1 uses a directory of sequential `00000000.json` event envelopes, each containing `payload` and an Ed25519 `signature`. The signed payload contains version, sequence, previous-envelope SHA-256 and an event. Canonical JSON sorts object keys. The chain detects changed, missing, reordered and truncated events. Each append uses exclusive creation, file fsync and directory fsync. Files require mode 0600, directories 0700, current-user ownership, no symlink paths or hardlinked files. A writer lock prevents simultaneous local writers; it is **not** advertised as a distributed lease. Output is never overwritten. A failed append cannot be retried through that writer.

Events:

1. `run`: version 1, random `p4_` plus 32 hex digits, target/source/catalog/complete-ledger/authorization digests and lease fencing token. Run IDs are scope labels, not ownership evidence.
2. `intent`: UUID transaction ID, one of the thirteen case IDs, allowed write tables and known fixture keys, recorded before fixture work. Optional UUID `concurrencyGroup` declares contenders that must use distinct backend identities. Server-generated UUID keys may be absent here; that gap requires authoritative transactional capture, not later inference from a scan.
3. `receipt`: a separately signed `transactional-v2` capture envelope with independently signed database evidence. It binds run/target/case/transaction/fence, pre-write intent digest, installation epoch, database transaction identity, outcome (`COMMITTED`, `ROLLED_BACK`, `UNKNOWN`), session PID/backend-start/session ID and operations. Each operation contains UUID `fixtureId`, operation (`insert`, `update`, `delete`), exact table/key, whole-row digest and expected relationships. Updates/deletes require prior captured ownership and a matching before-digest. Noncommitted outcomes carry no owned operations. Known intent keys must be covered by a committed receipt. A successful client response or capture signature alone is insufficient.
4. `end`: run result (`PASSED`, `FAILED`, `INTERRUPTED`), exact final signed-inventory payload digest and independent observer-signed capture seal covering every transaction/evidence digest. An interrupted test can have inspectable committed fixtures only when all transactions have authoritative settled outcomes and the inventory is sealed. Missing end, missing independent seal or any unresolved transaction blocks ownership reconstruction.

The manifest signer, transaction capture signer, inventory signer and independent database observer use four distinct Ed25519 key identities. Only public keys belong in a future reviewed policy. Private keys never belong in source, URLs, logs or command arguments. A worker-signed manifest cannot invent ownership: its capture receipt and enclosed database evidence must verify against different trusted authorities. No valid capture receipt means no ownership, regardless of prefix, timestamp, email suffix, apparent FK linkage or operator assertion. Compromise of a trusted capture/inventory/observer authority remains a trust-boundary risk; signatures do not themselves prove that a database transaction occurred.

The local library implements durable recording and evidence verification. It does **not** implement/provision the trusted transactional capture service/outbox or configure signing authorities. A future authority must prove that default-UUID, nested, batch, service-side and direct-SQL writes are captured atomically, with reliable commit/rollback reconciliation. Merely signing a worker's post-commit log is forbidden. Until that authority and its installation receipt are reviewed, no live ownership manifest is accepted by the checked-in disabled policy. Existing V4 rows must never be retroactively adopted.

## Exact-target and preservation checks

`APPROVED_POLICY` is disabled and has no target or keys. The reviewed design did not specify a provisioned reusable database name, OID or restricted worker role. Do not invent those values, reuse `neondb`, or change the policy using environment variables. Activation requires a separate reviewed source change after explicit owner approval of an exact environment.

Future verification checks the exact project, branch, endpoint, direct hostname, database name/OID, worker role, expiry, endpoint attachment and branch project. It rejects primary/default/protected branches, insufficient lifetime, stale identity observations, poolers, unverified TLS and unrestricted workers. A signed identity must contain a production/default target inventory, and the selected target must not occur in it. Production and historical V2/V3/V4 identifiers are explicitly rejected as well as failing positive-allowlist matching. Only a dedicated `phase4_` database/role is eligible; V4's existing endpoint and branch are denied outright by this new module.

Identity evidence expires after 60 seconds and branch lifetime requires at least ten minutes remaining. Expiry mismatch or expiration blocks operation; no automatic extension, fallback or retargeting exists. Offline evidence is an attestation, **not** a new live Neon API check. A future trusted inventory authority must perform fresh control-plane, TLS, SQL identity, privilege and quiescence checks before signing.

The inventory includes every field of seven migration ledger rows, the original seven checksum pins and unchanged local migration file hashes. Catalog checks cover columns, constraints, indexes, enums, functions, triggers/enabled state, ownership/security/ACLs and additional relation/sequence/dependency/event-trigger/extension inventories. The complete ledger and catalog/object digests must match installation pins; missing or extra tables fail. Source digests bind the native source, Prisma schema, service/audit and reusable validation implementation. Sequence current values are recorded separately from definitions, because tests may advance them; pure post-clean comparison requires those captured values to remain unchanged by cleanup.

Actual object coverage/privileges must be verified against the future database before activation. Unsupported objects or incomplete inventory authority coverage cannot be waived as an equal row count. The existing catalog helper is reused without modifying it or executing its migration-reference mode.

## Read-only collection and dry-run procedure

The only CLI mode consumes a **previously captured, authority-signed snapshot**, existing manifest directories and a new output path:

```text
node backend/scripts/phase4-reusable/cli.cjs dry-run <private-signed-inventory.json> <new-private-report.json> [<private-manifest-directory> ...]
```

Inputs and output parent directories must satisfy the private-file rules above. Prefer the existing ignored `.phase4-diagnostics-private` area with restrictive permissions. Reports contain exact keys and must not be pasted into chat or committed. The CLI prints only fixed blocker codes, status and zero authorized deletions. It returns exit code 2 for BLOCKED, never connects to a database, accepts no database URL/policy/key override and has no execute flag. With the checked-in policy, it returns `TARGET_NOT_APPROVED` and `EXECUTOR_DISABLED` without trusting an inventory. Empty per-table output in that case means **unverified**, not empty database.

`collectReadOnly(select)` is an optional library seam for a future trusted collector. It invokes its caller-supplied SELECT capability exactly once with one fixed SELECT statement and never retries. No connector, Prisma client, network call, SQL execution CLI, transaction mutation, DML, DDL, trigger change or deletion is present in that path. The SELECT gathers all 37 application tables and whole rows, ledger, catalogs, FK definitions and sequence state in one statement snapshot. Raw rows stay inside the restricted capture boundary; reports contain exact keys and digests instead of row contents. The caller must supply an appropriately privileged read-only connection and sign the resulting complete inventory together with fresh identity/quiescence/fence attestations. This seam is not yet wired into Neon or the native launcher.

For a valid inventory, each table report contains total rows, verified-owned rows, unknown count, proposed exact keys and ownership evidence, and unknown-key reasons. Malformed records increase unknown counts without becoming deletion candidates. Ownership requires matching verified capture, row digest and exact relationships. No-prefix keys can be owned; convincingly named synthetic rows without capture remain unknown. Default UUID children and composite primary keys are supported explicitly.

Dependencies include FK fields from the Prisma model, database FK definitions (including cascade/SET NULL effects), polymorphic audit entity links, snapshot players/identities/late-request references and audit roster JSON strings. Unknown embedded ID fields, ambiguous/missing targets and shared/cross-run references block the plan. This is a reviewed reference vocabulary, not a claim to understand arbitrary JSON. Missing, invalid, truncated or inconsistent manifests invalidate deletion ownership; one invalid supplied manifest clears the reconstructed ownership set. Extra rows are never adopted into the set.

Every report is currently `BLOCKED`, `executable=false`, `approvedDeletionCount=0`, even if every fixture is verified owned. Proposed keys are review candidates only. Additional blockers distinguish missing signatures/manifests, unsettled sessions, lease mismatch, expired targets, source/schema/ledger drift, unknown/shared/dependent rows, missing owned records and immutable history. Filesystem/parse errors are reduced to fixed validation codes; raw exception strings are suppressed.

## Concurrency, cleanup interface and recovery

Independent native sessions and their commits remain unchanged. Capture receipts track each transaction separately; one rollback never erases another session's commit. Concurrency groups require at least two distinct PID-plus-backend-start identities. A new transaction ID is required for an explicitly retried SERIALIZABLE transaction. No test, collection, capture reconciliation or uncertain operation is automatically retried by these modules.

Snapshot attestations must show admission closed, a valid fencing token, zero active sessions, zero prepared transactions and zero unresolved operations. The code validates those signed statements; **no distributed fencing service or session supervisor is implemented here**. A local journal lock cannot supply them. No live runs are enabled until they exist and are verified.

`executeCleanup()` unconditionally throws `CLEANUP_EXECUTOR_DISABLED`, ignores caller callbacks and contains no SQL. Its exported contract reserves approval bindings (target/report/snapshot/manifest digests, fence, expiry, owner approval) and transaction boundaries: verify target → fence/quiesce → begin → lock exact table set → revalidate reviewed inventory → separately reviewed mutation → verify preservation → commit → fresh read-only verification. There is no mutation implementation to activate with a flag.

Ordinary deletion is blocked by snapshot/lateness-history immutability and locked-fixture protections. The dry-run reports them; it never disables triggers, changes replication role, unlocks fixtures or emits a bypass. Even though the design discusses a privileged all-table reset, that mechanism is not implemented/enabled here. Any proposed reset that skips history triggers or changes privileges requires explicit separate architecture review and owner approval, not just a successful dry-run. Unknown records and V4 provenance cannot be waived by that approval flow.

Recovery procedure:

1. Stop admission; preserve every diagnostic, manifest event and lock. Do not rerun tests or remove a stale lock automatically.
2. A capture/commit acknowledgement gap, partial journal or missing final seal means ownership is unverifiable. Quarantine the environment. Have the trusted authority reconcile exact transaction outcomes and keys from its durable transactional evidence, read-only; do not manufacture a receipt from current row shapes.
3. After process interruption, wait for authoritative session/transaction settlement. Known committed rows remain; losing-session rollback covers only that transaction. Recheck target lifetime before any further work.
4. Obtain a fresh signed inventory and reviewed recovery evidence. Never overwrite the original journal or silently repair it; a future recovery-authority protocol must preserve the original evidence and be reviewed before use. This release intentionally blocks unresolved recovery cases.
5. For any future separately approved cleanup, require atomic rollback on statement/check failure. Lost COMMIT acknowledgement stays uncertain until fresh read-only evidence establishes the actual result. Never auto-retry, assume rollback, or start a new suite. Partial deletion is a protocol breach requiring investigation.

Provisioning a database, roles, capture objects, changing target pins, executing tests, modifying fixture records and implementing/enabling cleanup each require explicit owner approval at their operation boundary. This local implementation grants none of those permissions.

## Local verification and remaining limitations

Local results:

- Python: 44 existing mock/guard regressions passed.
- JavaScript: 44 tests passed, including 27 new reusable-infrastructure regressions and 17 existing reporter/duplicate/target/schema checks; zero failed/skipped.
- TypeScript: `tsc --noEmit --incremental false` passed.
- Python AST and new JavaScript syntax checks passed. Whitespace checks passed.
- The fixed inventory SELECT executed against temporary in-memory PGlite tables created solely for SQL validation. No migration file was executed/replayed. These tests do not prove native PostgreSQL concurrency, Neon privileges or transactional capture durability across server failure.

No Neon call, native behavior run, migration, branch operation, cleanup, push or deployment occurred. The existing native-target regression extracts guards without executing fixtures; the reporter regression's local synthetic assertion does not import Prisma or access a database.

Not implemented/verified: provisioning, live exact-target attestation, restricted-role installation, trustworthy atomic ownership capture/outbox, distributed fenced admission, automatic native fixture instrumentation, recovery-authority protocol, or any destructive executor. No real local PostgreSQL server/container binary was available for independent-session integration; the new concurrency tests validate receipts/state rules only. Existing V4 provenance remains unresolved and cleanup prohibited. These gaps produce fail-closed outcomes rather than inferred safety.

Local modules are ready for code review. Operational reuse remains blocked pending the separately reviewed installation/capture/fencing guarantees and explicit owner authorization; this release must not be presented as a runnable reusable native environment.
