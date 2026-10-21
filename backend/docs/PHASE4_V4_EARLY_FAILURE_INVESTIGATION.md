# V4 early native failure investigation — 2026-10-19

Status: READY FOR REVIEW. Native execution remains blocked on the nonempty V4 branch.

## Finding

The supported root cause is the empty application-data guard in `scripts/phase4-native.ts`, inside `beforeAll`:

```ts
expect(Number(row.count), 'branch must contain no application rows before this run').toBe(0);
```

The supplied report records a 4,980 ms failed process, a 4,738 ms failed run, `ASSERTION_FAILED`, thirteen skipped cases, and no `case_started`. The hook's only assertions are database identity, exactly 37 application tables, and zero rows in each table. Read-only V4 queries confirm the expected identity and 37 tables, but substantial existing native fixtures. This identifies the empty-data assertion by elimination and corroborating database evidence. The original report deliberately discarded assertion values, stack, and table identity; the exact first nonempty table visited is UNKNOWN because the enumeration has no ORDER BY. No historical stack trace can be recovered from this report.

All 187 users have a native run-prefixed ID, `@example.invalid` email, and `SYNTHETIC_DISABLED_LOGIN` password marker. They belong to one native run prefix. Their creation range is 2026-10-19 18:02:01.026–18:14:49.709 Asia/Ulaanbaatar (10:02:01.026–10:14:49.709 UTC), preceding the supplied diagnostic file's 18:22 modification time. Earlier work committed synthetic records; this five-second invocation did not start a test or reach fixture creation. The earlier run's overall outcome is not established here.

## Read-only V4 evidence

- Project `rough-snow-56584532`; branch `br-withered-mode-b528hnhk`, named `phase4-validation-v4`; endpoint `ep-delicate-poetry-b5bbwllj` is attached to that branch and has the pinned direct hostname.
- Branch ready, primary/default/protected false, initialized from parent schema, expiry `2026-10-26T09:48:09Z`.
- Database `neondb`, role `neondb_owner`; no credential contents inspected or recorded.
- All seven expected migration records are finished, none rolled back, and every checksum matches its local migration file.
- All sixteen expected noninternal trigger names exist and are enabled (`O`). This investigation did not repeat a full catalog fingerprint check; the launcher requires it before spawning Vitest.

Nonzero application counts (all other 24 application tables are zero):

| Table | Rows |
| --- | ---: |
| User | 187 |
| PlayerProfile | 187 |
| ExternalIdentity | 374 |
| Team | 6 |
| TeamMembership | 23 |
| Tournament | 16 |
| TournamentRegistration | 142 |
| TournamentRosterMember | 151 |
| AuditEvent | 29 |
| TournamentRegistrationPolicy | 16 |
| TournamentLatenessClaim | 2 |
| TournamentLatenessRequest | 2 |
| TournamentLockSnapshot | 3 |

## Initialization and transaction boundaries

`phase4-behavior.py` validates ownership/expiry, migration checksums and ledger, enabled triggers, and catalog fingerprint before launching the native process. `phase4-native.config.mts` selects only the native module. The module's environment/target guards throw ordinary Errors, whereas the observed failure is an assertion. Native client construction succeeded far enough to register all cases and run the hook. There is no evidence of a credentials, connection, target, environment, ledger, or trigger failure in this invocation.

The hook performs SELECTs before installing the service transaction mock. It contains no explicit `$transaction` and no application writes. No explicit native fixture/service transaction was reached; PostgreSQL still executes each SELECT in an implicit transaction. If invoked through the reviewed launcher, its preceding schema verification does use an explicit READ ONLY transaction. The saved native report alone is not a server transaction audit.

The fixed PostgreSQL duplicate SQL wrapper is merely imported as a string at module initialization. Its DO block executes inside the second native case, after fixture creation and transaction startup. No case started here, so wrapper execution/initialization in PostgreSQL cannot explain this failure.

## Smallest safe correction

No functional code defect was identified: the guard correctly prevents another committed fixture run against a used branch. Keep it intact. V4 can be retained for read-only investigation, but cannot safely be reused as an empty native-suite target as-is. No reset, cleanup, new branch, migration, rerun, push, or deployment is authorized or performed by this investigation. A future execution plan requires separate review; bypassing the guard is not a correction.

The reporter's coarse suite-level redaction limits historical attribution. An optional later improvement could add strictly allowlisted hook-stage codes without assertion values; it is not required to correct this failure. No runtime code changes or new regression tests were necessary.

## Local verification and preservation

- Python: 44 existing guard/launcher/migration/diagnostic regression tests passed; all script Python sources parsed successfully.
- JavaScript: 17 local tests passed across reporter, duplicate checks, target guard, and schema SELECT checks. These use mocks or disposable memory; the reporter test launches a local synthetic Vitest assertion without database access.
- TypeScript: `tsc --noEmit --incremental false` passed.
- JavaScript syntax checks for reporter, schema helper, duplicate SQL/helper and target regression script passed; `git diff --check` passed.
- Native tests were not rerun. Remote activity consisted only of metadata reads and SELECT queries on V4. No application records were modified.

Original diagnostic preserved in place:
`/var/folders/ym/skpkyd491lb3m21qzlz22q5c0000gn/T/phase4-diagnostics-cts1py5p/sanitized.jsonl`

SHA-256: `9f6614fd0d421a46a0aa5716a6eea494d2096a0f35ea3333915f2769467d346e`.

Existing workspace edits and private diagnostic archives were preserved. This investigation adds only this report.
