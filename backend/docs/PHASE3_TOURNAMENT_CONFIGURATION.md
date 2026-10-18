# Phase 3 — Tournament configuration review

Scope: owner-authorized Phase 3 only. No Phase 4 registration/check-in/finalization, configured database migration, push or deployment. Governance records, rank formula, nine emblems and historical rule versions are unchanged.

## Delivered behavior

Verified eligible players can create owned tournament configurations through `POST /api/tournaments` and the existing-style backend page `/tournaments/manage`. Current Steam/Discord verification, administrative holds, account eligibility and profile existence are checked again inside the creation transaction. No ADMIN role is required and there is no administrator exemption from the quota. The host is always the authenticated actor, never a request field. Creating an event does not join the host to its roster or use the host's floor to restrict participants.

New configurations are private DRAFT records. They do not publish or open competition before the later-phase essential rules/services exist. Drafts reserve one of the three hosting slots as a conservative resource reservation: every existing nonterminal status counts, including DRAFT; only COMPLETED/ARCHIVED releases a slot. This is explicit draft-quota behavior, not a new competition eligibility or disciplinary rule.

Owners can list saved configurations with `GET /api/tournaments/mine` and archive an unused owned Phase 3 draft with `POST /api/tournaments/:id/archive`. Archival preserves records/audits. It cannot remove another host's event, change a live tournament or free a slot by deleting data. Losing provider verification does not automatically delete an existing configuration, and does not prevent authorized draft cleanup through the existing user-session guard.

Creation accepts only name, venue, approved format/capacity, optional future start time, Open Bracket and zero entry fee. Unknown fields are rejected. Hosts cannot provide a host ID, status, Grand classification/category, opponent assignment, stakes, rank multiplier or arbitrary rule version. No token, wallet, paid-entry or reward operation is called.

Example request body (existing signed-in session and same-origin POST required):

```json
{"name":"Community Open","venue":"Local Cafe","format":"5v5","capacity":16,"style":"Open Bracket","entryFee":0}
```

The response is a saved draft with `classification.kind=null`, `classification.activePlayerCount=null` and `classification.status=AWAITING_PHASE4_SNAPSHOT`. Capacity is never displayed as verified attendance.

## Formats, pending details and activation gates

| Format | Starters per entrant | Approved substitute maximum | Phase 3 behavior |
| --- | ---: | --- | --- |
| 1v1 | 1 | Not applicable (0) | Configuration draft |
| 2v2 | 2 | Unresolved; substitutes are optional | Draft only; no competitive activation |
| 3v3 | 3 | Unresolved; substitutes are optional | Draft only; no competitive activation |
| 5v5 | 5 | One optional substitute | Configuration draft |

Entrant capacities are exactly 2, 4, 8, 16, 32 and 64: individual players for solo, teams otherwise. All new configurations use randomized Single Elimination Open Bracket as their selected style. Actual drawing/progression remains in its approved future phase; this phase does not fix or enable the legacy bye algorithm.

The existing non-null `maxSubstitutes` storage field is retained. In inactive 2v2/3v3 drafts it contains a nonbinding zero placeholder; the owner-facing API returns **null**, with an unresolved-policy blocker. Zero is not adopted as a substitute ban. New drafts cannot reach roster lock or generation through legacy admin routes, and legacy 2v2/3v3 activation is also gated until the substitute policy is complete. A future approved policy must replace the placeholder/readiness behavior before competition activation.

Advanced styles remain unavailable for creation and legacy activation. They are not deleted. Historical tournament formats/styles/data remain intact. Newly created drafts use `rulesVersion=PENDING_APPROVAL`, not an invented adopted rulebook. `PHASE3_FREE_OPEN_V1` is a technical configuration marker only. Publication requires resolving the applicable immutable rules reference; Phase 1's non-executable register is not falsely treated as an adopted consolidated rulebook.

Admin mutation endpoints reject Phase 3 configuration-only events. The admin dashboard labels their competitive operations unavailable. Public list/detail APIs and server-rendered pages exclude these private configurations, including archived ones. Legacy public events retain their current visibility. Existing rank/emblem/front-end design code is not replaced.

## Automatic Grand Battle policy boundary

The server-side threshold helper implements the approved rule for trusted participation snapshots: count distinct verified eligible active starters; classify 64+ as GRAND_BATTLE, otherwise ORDINARY. It takes no host preference, admin override, Arena Day or reward multiplier. Unused substitutes do not count; a substitute in a valid active starter position does. Incomplete or ineligible starter lineups block this operation rather than being assumed complete.

Tests cover 64 solo players, 32 2v2 teams, 16/32 3v3 teams and 8/16 5v5 teams. The helper is not exposed as an API accepting user-supplied eligibility flags. It does not itself validate attendance or prove roster eligibility. Its inputs must come from the Phase 4 trusted eligibility/check-in/lock workflow.

There is **no final classification persistence or lock in Phase 3**. No provisional label based on capacity grants Grand status. Phase 4 must take the approved snapshot, recalculate before lock, permanently retain final classification despite later withdrawals/forfeits, and validate all protected attendance/incomplete-team cases. Hosting and participation remain open to eligible players, with no invitation-only or Arena Day prerequisite introduced.

## Security and quota enforcement

The creation transaction locks the host User row, rechecks eligibility, counts current nonterminal hosted events and inserts the draft/audit atomically under ReadCommitted isolation. Other creation requests for that host serialize on the same lock. Verification revocation shares that account lock. The database trigger repeats quota enforcement even for direct SQL, blocks ownership reassignment and excludes the row being updated from its count. Draft archival locks the same host and uses a conditional state update. Audit failure rolls back creation and quota consumption.

Ownership is now included in both tournament adjudication and case-review independence checks, including hosts who do not participate. Existing role, CSRF, rate-limit and safe-error boundaries remain in force. No public API exposes host email, provider IDs or private case data. No email, external notification, deployment or payment action is added.

## Additive migration proposal and risks

`prisma/migrations/20261016120000_tournament_configuration/migration.sql` adds nullable hostUserId, configurationPolicy and entryFee columns, the host/status index, a restrictive User foreign key, a scoped new-configuration CHECK, and a quota trigger/function. Existing User relations gain no data writes. Earlier migrations are unchanged. Historical ownership/fees/policy markers remain NULL; there is no guessed backfill or rewrite of existing events.

Before any approved database application:

- Confirm live Neon schema/migration history and apply preceding Phase 2 proposals first on an approved isolated branch. No configured/production database was inspected or migrated here.
- ALTER TABLE, FK/CHECK validation and index creation can lock or scan Tournament/User; assess table size, permissions, timeout and maintenance window.
- The migration role needs permission to create the PL/pgSQL function/trigger. Application writes must retain these guards. Ownership transfer is intentionally unavailable, including direct updates covered by the trigger.
- Review quota behavior for any future explicitly approved legacy ownership mapping; historical events are not assigned to a host automatically.
- The trigger and transaction locks need multi-connection PostgreSQL/Neon contention testing before real hosting. PGlite tests validate PostgreSQL SQL/constraints/rollback and overlapping callers on one connection; they do not certify multi-session lock behavior.
- Rollout requires the new columns before application deployment. Rollback must preserve created records, audits and quota enforcement, and must not restore unsafe activation paths for configuration-only drafts.

The migration was applied only to disposable in-memory PostgreSQL fixtures. There is no production migration approval implied by this report.

## Unresolved and deferred operations

Still pending: 2v2/3v3 substitute maxima; revised check-in boundaries and Grand finals timing; Floor 2 lateness trigger/finalization interaction; incomplete-team eligibility; publication-ready immutable rule selection; advanced-style algorithms/unlocks; byes; and other previously registered blockers. Those do not prevent saving eligible draft configurations, but affected competition operations remain unavailable. No Phase 4 registration, attendance validation, roster/settings lock, final classification or new result settlement was implemented.

## Validation

- 188 tests passed across 22 files, including five new isolated PostgreSQL hosting tests and retained Phase 2 regression coverage.
- Backend TypeScript, Prisma validation/client generation and production build passed using a dummy unreachable database URL.
- SQL tests cover legacy preservation, overlapping creation capped at three, direct-SQL quota enforcement, archival without deletion, malformed/nonfree configuration and audit-failure rollback.
- API/policy tests cover same-origin/verified identity, host ownership, manual classification rejection, all approved format/capacity combinations, advanced-style/readiness gates, incomplete teams, substitute counting and host independence.
- Live provider and multi-connection Neon checks remain unperformed. No dependency versions were changed in this phase.

Phase 4, configured/production migration, push and deployment each remain subject to explicit owner approval.

## Phase 3 file inventory

- `backend/app/admin/AdminActions.tsx`
- `backend/app/admin/page.tsx`
- `backend/app/api/admin/tournaments/[tournamentId]/complete/route.ts`
- `backend/app/api/admin/tournaments/[tournamentId]/generate-bracket/route.ts`
- `backend/app/api/admin/tournaments/[tournamentId]/lock-rosters/route.ts`
- `backend/app/api/admin/tournaments/[tournamentId]/registrations/[registrationId]/check-in/route.ts`
- `backend/app/api/admin/tournaments/[tournamentId]/registrations/[registrationId]/route.ts`
- `backend/app/api/tournaments/[tournamentId]/archive/route.ts`
- `backend/app/api/tournaments/[tournamentId]/route.ts`
- `backend/app/api/tournaments/mine/route.ts`
- `backend/app/api/tournaments/route.ts`
- `backend/app/tournaments/[tournamentId]/page.tsx`
- `backend/app/tournaments/manage/HostConfigurationForm.tsx`
- `backend/app/tournaments/manage/page.tsx`
- `backend/app/tournaments/page.tsx`
- `backend/docs/PHASE3_TOURNAMENT_CONFIGURATION.md`
- `backend/lib/competition-authority.ts`
- `backend/lib/reviewer.ts`
- `backend/lib/tournament-activation.ts`
- `backend/lib/tournament-configuration.ts`
- `backend/lib/tournament-hosting.ts`
- `backend/prisma/migrations/20261016120000_tournament_configuration/migration.sql`
- `backend/prisma/schema.prisma`
- `backend/tests/reviewer.test.ts`
- `backend/tests/tournament-activation.test.ts`
- `backend/tests/tournament-api.test.ts`
- `backend/tests/tournament-configuration.test.ts`
- `backend/tests/tournament-database.test.ts`
- `backend/tests/tournament-hosting.test.ts`
