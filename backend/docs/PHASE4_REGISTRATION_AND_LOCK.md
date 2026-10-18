# Phase 4 — Final governance implementation

The final owner-approved Phase 4 policies are implemented prospectively under `OWNER_PHASE4_FINAL_2026_10_16` (S5). Phase 5 has not started. No configured Neon or production database was read or migrated; no push, deployment, competitive bracket generation, result settlement or NR change occurred.

The previous 220-test Phase 4 report is preserved exactly in [the pre-final report](history/PHASE4_REGISTRATION_AND_LOCK_PRE_FINAL.md). This report supersedes its unresolved-policy statements; historical rule documents and published event policies are unchanged.

## Resulting behavior

- Registration closes exactly 15 minutes before scheduled start, using the database clock, capacity serialization and verified identity/authorization checks. Registration and attendance are separate.
- Registered players personally check in during the ordinary 15-minute window without captain/referee confirmation. Receipts are timestamped, audited and idempotent; they mean self-confirmation, not independently verified physical presence.
- Eligible Floor 2 players personally request lateness with a non-empty reason, then personally complete protected check-in by start plus 15 minutes, inclusive. Automatic approval, the single per-tournament incident consumption, attendance and audit commit together. Overlap/replay cannot consume another incident. Expired unsuccessful requests are recorded without consumption; no disciplinary consequence is introduced.
- Necessary eligible protected starters delay team finalization while the protection window remains open. After resolution/expiry, insufficient eligible checked-in starters disqualify the entrant from starting and exclude it from classification; no account identity is revoked.
- 2v2, 3v3 and 5v5 each allow one optional registered substitute. Pre-lock changes require current team membership and eligible identities. Only lawfully active starters count; new substitutes and original roster edits remain blocked after lock.
- Finalization serializes with all these operations, locks settings/rosters and writes one immutable count/classification snapshot plus audits. At least 64 distinct eligible active starters produces Grand Battle. Counts exclude absent starters, incomplete/disqualified entrants and unused substitutes, and survive post-lock withdrawal.
- Non-power-of-two remaining fields can be locked without eliminating eligible entrants. Auditable, reproducible random seeding and fair automatic byes are approved governance for Phase 5, not implemented in Phase 4.
- The 30-minute window remains an isolated policy interface only for a separately scheduled championship final of an already locked Grand Battle. Match-specific attendance and final progression remain unavailable.

The existing styled backend tournament page now offers personal Check In and late-arrival request actions; host configuration offers a scheduled start and explicit opening. The separate frontend source, root prototype, styles and emblems were not redesigned or changed.

## APIs and workflow

[The API/database contract](PHASE4_FINAL_API_DATABASE.md) documents request bodies, timing boundaries, authority, expiry behavior and migration constraints.

Updated paths include the existing create/open-registration, registration, roster, withdrawal, check-in, lateness and finalization endpoints. New authenticated `GET /api/tournaments/:id/attendance` exposes only the current player's own receipt and pending request. Authentication, CSRF/origin controls, shared rate limits, current roles, independence and private evidence boundaries remain in effect.

Newly opened empty owned drafts explicitly adopt S5 and its fixed deadline/self-attendance references. No host invents those policies. Existing populated/published policies are rejected for implicit upgrade, and locked snapshots remain immutable. Earlier pending lateness records retain their null policy version and pending state. No data is backfilled by this implementation.

## Migration proposal and risks

`prisma/migrations/20261016170000_final_attendance_governance/migration.sql` adds a version field and request-history table, partial unique indexes, scope/state/time checks and incident/history guards. It prospectively expands two old checks to allow the approved substitute maximum and automatic late decision under S5, preserving old-version constraints. This constraint expansion is inside an explicit transaction and does not rewrite earlier migration files or existing records.

It remains unapplied to configured databases. It needs a separately approved Neon branch/clone rehearsal before application. Review schema drift and exact existing check names, DDL locks/scans, FK/trigger privileges, timezone behavior, query latency and real separate-session concurrency/deadlocks. PGlite replay is evidence of isolated SQL/constraint behavior, not proof of live Neon compatibility or a native Prisma-to-Neon integration run. Existing earlier unapplied migrations remain prerequisites.

## Validation

- **235 passing tests in 25 files**, including all existing security/regression suites.
- Added or updated tests cover registration immediately before/at/after closing, ordinary self-confirmation and unauthorized actions, missing reasons, Floor 1 rejection, personal request ownership, automatic Floor 2 approval, exact/late protected deadlines, duplicate requests, idempotent concurrent protected check-ins, expiry without usage, one-use constraints, consumption/audit rollback, active team protection, incomplete/ineligible starter disqualification, one optional substitute in every team format, membership, 63/64 classification, non-power-of-two locking without matches, roster-lock races and preservation of historical records.
- TypeScript checks, Prisma validation/client generation and backend/frontend production builds pass. Backend build uses a nonconnecting placeholder database URL.
- Fresh npm audits: **zero backend advisories; zero frontend advisories**. Dependencies and lockfiles are unchanged in this follow-up.
- Governance register/JSON/unresolved-list consistency and historical manifest hashes pass. Hash comparison preserves earlier migrations, historical rule snapshots, original NR/rank code, root prototype/design and separate frontend/emblem assets.

Concurrency tests issue overlapping requests against a single-connection in-memory PGlite adapter. Separate-session Neon/Prisma concurrency, real Steam/Discord callbacks and an authenticated browser journey were not run. The database-backed `demo:smoke` script was not run because no approved isolated live HTTP/database environment was configured. Generated local build/client/type caches are not source changes.

## Approved policy versus implementation limits

The registration, self-attendance, automatic lateness, substitute maximum and non-power-of-two decisions are resolved; they are no longer governance blockers. Remaining implementation boundaries include unsupported match-specific attendance, scheduled championship-final progression, exceptional roster corrections, existing published-event adoption and all Phase 5 bracket execution. Unrelated advanced styles, appeals/escalation, delayed-settlement mechanics, special rewards and designated badge revocations retain their separate governance gates.

Nothing enables unapproved rewards, paid entry, token staking, changes during BO3 maps or new post-lock substitutes. Historical users, tournaments, results and ranking data were not touched. Migration rehearsal/application, push, deployment and Phase 5 require separate authorization. Stop here for owner review.

## Follow-up changed-file inventory

- `backend/README.md`
- `backend/app/api/tournaments/[tournamentId]/attendance/route.ts`
- `backend/app/api/tournaments/[tournamentId]/check-in/route.ts`
- `backend/app/api/tournaments/[tournamentId]/route.ts`
- `backend/app/tournaments/[tournamentId]/AttendanceActions.tsx`
- `backend/app/tournaments/[tournamentId]/page.tsx`
- `backend/app/tournaments/manage/HostConfigurationForm.tsx`
- `backend/docs/PHASE4_FINAL_API_DATABASE.md`
- `backend/docs/PHASE4_REGISTRATION_AND_LOCK.md`
- `backend/docs/history/PHASE4_REGISTRATION_AND_LOCK_PRE_FINAL.md`
- `backend/governance/decisions.json`
- `backend/lib/tournament-activation.ts`
- `backend/lib/tournament-attendance-policy.ts`
- `backend/lib/tournament-configuration.ts`
- `backend/lib/tournament-hosting.ts`
- `backend/lib/tournament-registration.ts`
- `backend/prisma/migrations/20261016170000_final_attendance_governance/migration.sql`
- `backend/prisma/schema.prisma`
- `backend/tests/phase4-api.test.ts`
- `backend/tests/phase4-database.test.ts`
- `backend/tests/tournament-activation.test.ts`
- `backend/tests/tournament-configuration.test.ts`
- `backend/tests/tournament-hosting.test.ts`
- `docs/governance/decision-register.md`
- `docs/governance/implementation-conflicts.md`
- `docs/governance/unresolved-decisions.md`
