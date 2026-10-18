# Phase 4 native behavior/concurrency tests — PREPARED, NOT EXECUTED

The current V3 target is verified at foundation stage only; migration rehearsal and native synthetic writes require separate authorization. Earlier successful migrations applied to V2, not V3. The only allowed future target is project `rough-snow-56584532`, branch `br-morning-queen-b5u7j4qz`, endpoint `ep-still-rain-b55chfrd`, direct host `ep-still-rain-b55chfrd.c-7.us-east-2.aws.neon.tech`, database `neondb`, role `neondb_owner`. Production endpoints `ep-crimson-rain-b5po4mqa` and `ep-wispy-voice-b4nvm1b4` are rejected by the shared allowlist.

## Preflight and authorization

The live metadata check during preparation reported an unprotected, non-primary/non-default, ready schema-only branch expiring at **2026-10-18 07:20:59 UTC / 15:20:59 Ulaanbaatar**. A read-only catalog inspection found 37 application tables, 16 triggers and 10 functions. The preparation baseline catalog SHA-256 is `88a5b13465ec1be32fb9f0e1265a8b8ec81f214e4b73e7b5633f0577a7752011`. The launcher compares the whole catalog, including constraints, indexes, enum values, functions, trigger definitions/enabled state, ownership/ACLs, RLS and views. Any drift blocks execution for review.

Separate approval must authorize committed synthetic fixtures and independent-session service/direct-SQL tests on these exact identifiers. Cleanup/disposal is a separate approval; this runner never deletes the branch, resets schemas, disables triggers or erases historical records. It does not run migrations. Fresh hidden terminal input supplies the URL and API key; no .env file, normal DATABASE_URL or credential log is used. Strict TLS, engine/version pins, exact ownership/protection, direct endpoint, migration names/checksums and expiration are checked before fixtures. At least one hour of branch lifetime must remain when starting. Every service/direct concurrency transaction rechecks cached expiration, and every case checks expiration with ten minutes of margin. Recheck or separately authorize an expiration extension if insufficient; never redirect the suite to another branch.

The local same-user execution flock is shared with the migration runner. No other operator, host or manual write process may use this branch concurrently. The isolated Vitest configuration selects only `scripts/phase4-native.ts`, which is outside the normal *.test.ts glob. The native module fails before connecting without the launcher's authorization marker and exact strict-TLS URL. The suite requires **all 37 application tables empty** before any fixture writes. It refuses a rerun after any prior fixtures/failure; do not delete rows or reset to force it through.

## Governance and coverage

Registration closes 15 minutes before start. Ordinary authenticated self-check-in runs from start minus 15 minutes inclusive to start exclusive. Floor 2 alone gets a personal reason-bearing request and protected arrival through start plus 15 minutes inclusive; one incident is consumed atomically, retries preserve the original attendance receipt, and expiration alone does not consume protection. Substitutes are optional, at most one for current-policy 2v2/3v3/5v5; only locked-roster substitutes are usable after lock. Entrant capacities are 2/4/8/16/32/64, not player counts. Exactly 64 verified eligible active starters triggers Grand Battle automatically at finalization; unused bench players do not count. Historical other-policy events are not silently upgraded.

| Prepared native case | Expected result / failure condition |
| --- | --- |
| Last registration slot, two service sessions | One commit, one capacity denial; two total entrants and exactly two successful registration audits including initial entrant. Duplicate submission adds nothing. |
| Direct capacity overflow | PostgreSQL rejects overflow independently of the service; no extra entrant remains. |
| Same player on two teams in competing direct transactions | Exactly one active participation commits; loser rejected by the database duplicate-participation guard. |
| Held identity and 2v2/3v3/5v5 roster limits | Administrative hold rejects registration; no substitute is valid; adding/removing one before lock succeeds; two substitutes rejected. |
| Early and duplicate self-check-in | Early request rejected; caller-supplied player override rejected; two sessions return one stable attendance receipt and one audit; later retry preserves timestamp. |
| Floor 2 duplicate requests and simultaneous protected arrivals | One pending personal request, one consumed incident, one approval audit; attendance retry is idempotent. Floor 1 protection rejected. |
| Expired protection | Arrival/request denied; used-incident count remains zero. |
| Finalizer racing protected check-in | Check-in succeeds; finalization either includes it or returns pending, then an explicit retry succeeds; never an absent-player snapshot. |
| Concurrent finalizers, 63 and 64 starters | One snapshot/audit; count 63 ORDINARY, count 64 GRAND_BATTLE; no host classification input. |
| Immutable snapshots and post-lock rosters | Snapshot update/delete rejected; post-lock roster edit rejected; historical withdrawal preserves digest/count/classification. |
| Fabricated count/classification | Stored count64/GRAND against one real eligible starter rejected by snapshot-count trigger; no snapshot residue. |
| Optional bench and referee independence | Bench excluded from active count; participating referee rejected; independent referee finalizes. |
| Registration racing lock | Late entrant rejected whether registration or finalizer takes the event lock first; snapshot and entrant count remain consistent. |
| SERIALIZABLE conflict and explicit retry | Two distinct sessions read before competing updates; exactly one commits and one P2034 aborts; only the aborted idempotent transaction is retried once. No blanket retries. |

Every concurrency schedule uses independent PrismaClient instances, obtains pg_backend_pid within the competing transactions and requires distinct PIDs. Barriers coordinate entry rather than issuing Promise.all on one connection. READ COMMITTED is the service test default; SERIALIZABLE is tested separately. Timeouts bound barrier waits, locks, statements and transactions. Test clocks are real database clocks, not a mocked clock. Fixture scheduling is adjusted before lock; classification fixtures deliberately insert synthetic valid attendance facts to isolate finalization. This does not substitute for external provider verification or authenticated HTTP/browser testing.

Additional boundary schedules remain important for a later expanded run: exact millisecond opening/start/protection deadlines; both forced lock orders and repeated contention; incomplete-team disqualification; every identity/revocation/suspension combination; mismatched snapshot JSON sets; unsupported isolation; direct incident-reset attempts; 63-to-64 final-arrival races. Existing local unit/database tests cover portions of these, but they are not claimed as native multi-session coverage by this prepared suite. Do not report unimplemented native schedules as passed.

## Fixture isolation, evidence and cleanup

Each invocation generates `p4_<random>` IDs, `example.invalid` emails, disabled synthetic login hashes and fake numeric provider subjects. Every event has a separate synthetic host to avoid unrelated three-active-host quota failures. Only the verified initially empty branch receives fixtures. Services are invoked through a Vitest mock of the Prisma export that forwards each transaction to a real selected Prisma client; application services are not reimplemented. Raw SQL bypass cases independently exercise triggers. No application code, governance, ranking formulas, emblems, wallet or website design is changed.

Fixtures commit across connections and remain after success or failure. Row-by-row cleanup is unsafe because locked snapshots and lateness history intentionally prohibit deletion. Retain the run ID and sanitized result, then separately approve disposal of the exact disposable branch in Neon Console after reconfirming identity. No automatic cleanup command is provided. If keeping the branch, retain the synthetic records until a reviewed cleanup approach is separately approved. Never disable guards, use cascade deletion, or run prisma migrate reset. Cross-session rollback cannot provide one global cleanup transaction.

The launcher captures and discards raw Vitest stdout/stderr. A dedicated reporter flushes allowlisted test IDs, states, error categories, known SQLSTATE codes and durations to a user-owned mode-0600 file in a mode-0700 temporary directory. The launcher independently reconstructs safe records, displays static registered test names, and retains the sanitized report path on failure. Started cases identify work interrupted before a result; their elapsed time is measured at reporting. Unknown names become UNKNOWN_TEST and block success. No raw error, assertion values, stack, fixture identifiers, console messages or connection URLs are saved. Native tests assert distinct session IDs without logging them. On any failure, no automatic repair/reset/cleanup or broad retry occurs. The process-group guard handles local children; even confirmed local exit does not prove PostgreSQL outcome. This suite uses the currently authorized owner role; it does **not** establish least-privilege runtime-role enforcement. Testing a restricted role requires separate approved role provisioning and guard changes. Cluster roles/default grants, physical presence, live OAuth and historical production-data preservation remain outside this suite.

## Exact future command — requires separate write authorization

From the repository root, after explicit approval only:

```sh
python3 -B backend/scripts/phase4-behavior.py --run-approved-tests
```

The launcher asks for the branch ID and fresh hidden credentials. Do not run Vitest directly, paste credentials into chat, or export a production URL. The command performs synthetic application writes; it is **not** a read-only preflight. If branch expiry, catalog, migration history, identity, empty-data check or version checks fail, stop for review.

Local preparation checks: Python mock guards, TypeScript with no emission, JavaScript syntax and whitespace checks. No native fixture path, service write, migration replay or cleanup was executed during preparation. Native results remain NOT RUN until separately authorized.


## Local runner remediation (2026-10-18)

The original approximately 10-minute-25-second failure cannot be recovered from discarded output. A concrete risk was the old 10-second PostgreSQL lock timeout racing a transaction allowed 60 seconds. This is a potential contributor, not an established original root cause.

Service races now deliberately acquire the tournament row lock on the selected winner before releasing a bounded two-party barrier. Two real separate sessions remain required. This makes lock ordering reproducible but does not explore every possible scheduler interleaving. Direct constraint races and the SERIALIZABLE conflict remain concurrent. No service implementation, schema or governance policy changes.

Timeouts (milliseconds, centralized in phase4-budgets.cjs): barrier 10,000; winner transaction 60,000; lock wait 75,000; statement 80,000; inherited socket timeout 90,000; waiter transaction 150,000; connection acquisition 10,000; hook 120,000; test 300,000; process suite 2,700,000. SET LOCAL statement/lock settings apply only inside native interactive transactions. Ordinary fixture operations retain the guarded URL's 60-second statement/10-second lock timeouts. The inherited idle-in-transaction timeout is 60 seconds; the synchronization barrier is capped at 10 seconds. A Prisma transaction deadline can fire before PostgreSQL finishes its current statement: server-side outcome must still be treated as unknown after failure.

Vitest retry is zero and bail is one. The existing explicit retry of a known-aborted SERIALIZABLE transaction and the protected-arrival domain retry are test scenarios, not retries of a failed test or suite. Transactions and barriers are bounded. Unrelated row ordering in service/trigger paths can still deadlock: 40P01 is reported, never silently retried. A Vitest timeout is not transaction cancellation; launcher process-group TERM/KILL escalation bounds local workers, and uncertain cleanup is explicitly reported. No failure performs database cleanup or reset.

Next safe rehearsal: revoke the previously exposed API key and replace it outside chat. Obtain separate authorization for a fresh disposable schema-only branch with adequate expiration; record project, branch, endpoint, role, parent and copied-data status. Review and explicitly rebind the hardcoded guards (Python and native test) to that exact branch; there is no environment-variable target override. Run strict-TLS read-only preflight, then separately authorize migration rehearsal. Verify seven checksums and exact migrated catalog plus empty application tables. Only after separate synthetic-write authorization may the behavior runner be invoked. Retain the sanitized report; investigate any failure read-only before considering cleanup or another run. The expired branch and committed fixtures are not reset, retried or repaired. New branch creation, migration, execution and disposal remain separately authorized actions.

Local verification: 41 Python regression tests and four Node reporter tests passed, including a real Vitest subprocess containing only a synthetic local assertion (no Prisma import or database access). TypeScript no-emit checks, Python/JavaScript syntax checks and Git whitespace checks passed. No native database suite or database connection was executed during remediation.
