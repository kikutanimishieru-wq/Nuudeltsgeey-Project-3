# Phase 4 — Registration, check-in and classification

Phase 4 implementation is complete with explicit governance gates. This is not an assertion that live tournaments are ready to operate. No configured Neon or production database was read or migrated. No push, deployment, bracket generation, result settlement, reward issuance or Phase 5 work was performed.

Builds regenerated ignored local `.next`, Prisma client and TypeScript build caches; these are not source changes.

The working tree already contained Phases 1–3. The inventory below describes this follow-up relative to the Phase 4 starting filesystem, rather than treating all existing uncommitted files as Phase 4 changes.

## Registration and APIs

All mutation routes use the existing Auth.js session, same-origin protection and shared database rate limiting. Competitive routes require both verified provider identities. Services recheck current identity and authorization inside their database transaction.

| Method and path | Action and authority |
| --- | --- |
| POST `/api/tournaments/:id/open-registration` | Verified host opens their own draft only after an approved registration deadline, scheduled start and published rule reference exist. Does not let the host create policy approvals. |
| POST `/api/tournaments/:id/registrations` | Verified solo player or current team captain registers an entrant. Body: `{teamId?, roster: [{playerId, isStarter}]}`. Solo registration must name the session player's profile and no team. |
| POST `/api/tournaments/:id/registrations/:registrationId/roster` | Verified current captain changes their team's roster before lock. Body: `{roster: [...]}`. Retained players keep their own attendance records; new members inherit none. |
| POST `/api/tournaments/:id/registrations/:registrationId/withdraw` | Registered solo player/current team captain records withdrawal without deleting the entrant or roster. After lock, the immutable classification remains unchanged. |
| POST `/api/tournaments/:id/check-in` | Registered verified player records their own server-time check-in receipt. No client timestamp, attendance decision or classification flag is accepted. |
| POST `/api/tournaments/:id/lateness` | Registered Floor 2 player records one pending claim. Body: `{reason, evidenceRef, matchId?}`. Match-specific execution is gated until an approved scheduled-match integration exists. |
| POST `/api/admin/tournaments/:id/finalize` | Current active independent referee/admin finalizes the approved event. Accepts an empty body or `{}`; rejects manual classification or other overrides. No special administrator creation prerequisite for Grand classification. |

Existing GET tournament list/detail and server-rendered pages expose new events only after the explicit policy-gated opening; drafts and archived configuration drafts remain private. Detail exposes a classification summary, count, lock timestamp and digest, never private evidence or the raw snapshot. Withdrawn/disqualified entries are omitted from the active public roster. Host configuration responses show actual policy blockers and the locked classification summary. The unresolved 2v2/3v3 substitute maxima remain `null` in configuration/detail responses.

The registration transaction locks the tournament before counting capacity or reading competing lineups. Formats are 1v1, 2v2, 3v3 and 5v5, with capacities 2/4/8/16/32/64; units are solo entrants or teams. Current team membership, captain authority, provider verification and floors are checked. Duplicate players across active entries, duplicate entrants and capacity overflow are rejected. Withdrawals release capacity before lock while retaining history; exceptional re-registration of the same recorded entrant is not enabled.

Players may register incomplete active lineups for later completion. Exactly the required verified eligible active starters must be ready at finalization. The 5v5 optional bench limit remains one. Adding a bench player in 2v2/3v3 is gated on the unresolved maximum; starter-only configurations remain available without treating the storage placeholder zero as an approved limit. Authorized pre-lock bench registration/removal and activation use the same roster service. Post-lock substitution execution remains unavailable; this does not change the approved between-completed-matches authority rules or allow changes between BO3 maps.

No production policy rows are seeded. A missing deadline blocks opening/registration. The exact deadline and its approval reference must be supplied through a separately approved governance configuration process; a host cannot pick one through these APIs. The application supplies no invented rulebook version. Existing `PENDING_APPROVAL` drafts remain gated.

## Check-in and lateness

Ordinary check-in uses `[scheduled start − 15 minutes, scheduled start)`: opening is inclusive, closing exclusive. The database clock supplies authoritative receipt times, rechecked after player authorization. New timestamps use PostgreSQL `timestamptz(3)` and API ISO UTC instants. Existing historical timestamp columns are not converted.

A receipt records the individual roster member and `OWNER_PHASE4_2026_10_16` policy reference. It does not claim physical attendance verification. There is no new attendance-approval endpoint because evidence requirements and authorized exception workflow remain unresolved. An approved attendance policy plus separately authorized evidence verification is required before affected finalization can succeed. The only verified attendance fixtures are isolated tests, not production approvals.

The isolated final-policy interface supplies 30 minutes only when a separately scheduled championship final already belongs to a locked Grand Battle. Ordinary check-in always retains 15 minutes, including tournaments expected to reach 64 starters. No final scheduling or match progression was introduced.

Lateness records contain player, tournament, optional match reference, scheduled start, the fixed start-plus-15-minute protected deadline, private reason/evidence reference, pending decision, decision actor/time fields and usage time. The unique player/tournament key prevents concurrent duplicate claims. Floor 1 is rejected. Claims never grant protection, waive identity/cheating restrictions or mark the incident used automatically. The migration constrains decisions to pending until review governance is approved. The protection limit is not an invented evidence-submission deadline: later evidence can still be recorded before lock for review.

An absent necessary Floor 2 starter blocks finalization during the protection window. After it, missing review authority still blocks dependent exclusion; the elapsed timer is not an automatic disqualification rule. Pending claims affecting active starters also block finalization. Match-specific protection and post-lock exceptional review require later approved integration.

## Atomic finalization and security

The finalizer locks the tournament, rechecks role and independence, then locks users/profiles in ordered batches and rereads roster facts. It rejects the host or anyone with participation in the event as an independent finalizer. Identity revocation and administrative holds block verification-dependent finalization rather than automatically removing a player. Current team membership and active starter requirements are revalidated. Open Bracket remains the only enabled style; no higher-floor unlock is inferred.

A successful transaction:

1. Enforces ordinary check-in closure by the scheduled-start server-time gate.
2. Requires approved attendance governance and resolved relevant lateness eligibility.
3. Separates complete entrants from incomplete entrants after those gates.
4. Blocks if the remaining field is outside approved power-of-two capacities; no bye policy is invented.
5. Records incomplete-entrant disqualification and locks participating registrations and tournament settings.
6. Counts distinct verified eligible active starters from that same qualified lineup; unused substitutes and disqualified/withdrawn entrants contribute nothing.
7. Writes one immutable snapshot and audits in the same transaction.

At least 64 distinct active players produces `GRAND_BATTLE`; otherwise `ORDINARY`. Solo players and team starters count as individuals. Classification is not manually settable, confers no extra reward and cannot be recalculated after lock. Post-lock withdrawal changes only historical withdrawal status, not the frozen count or classification.

The snapshot records settings, rules/policy references, qualified entrant/player IDs, floor and identity verification facts, individual attendance evidence references and disqualified entrant IDs. A canonical SHA-256 digest can be recomputed after PostgreSQL JSONB normalizes object-key order. The digest detects changes; it is not an external signature. Database triggers reject snapshot update/deletion, locked settings changes and original roster edits. Registration/roster/policy writes take the same parent tournament lock; moving a roster member or registration between parents is rejected. Exceptional corrections require separately approved governance, not an undocumented override.

State mutations and audit insertion commit together. Roster-edit audits retain the previous and next player/starter lineup, without private evidence. Lateness evidence is neither copied into public audit metadata nor exposed through public selects. Existing Phase 3 guards continue to block legacy administrative mutation/bracket routes for newly managed events; the new finalizer is the sole Phase 4 lock path. Compatibility guards in legacy result/bracket routes reject unsupported solo use without adding settlement or generation behavior.

## Proposed migration and risks

`prisma/migrations/20261016150000_registration_lock/migration.sql` is an unapplied, backwards-compatible schema expansion:

- `TournamentRegistrationPolicy` stores approved event deadline and policy references. There is no host-editable approval endpoint.
- `TournamentLatenessClaim` stores one private pending incident per player/event and future decision/usage fields, with a fixed 15-minute interval constraint.
- `TournamentLockSnapshot` stores the unique immutable lock/classification record, count, private snapshot and canonical digest.
- Existing registrations gain nullable solo player, withdrawal and disqualification fields; roster members gain individual check-in and attendance evidence fields.
- To reuse the existing registration/roster models for genuine 1v1 entrants, existing `teamId` becomes nullable. This is the migration's one relaxation of an existing constraint; no team, registration or ID is removed. A new exclusive entrant-kind check requires exactly one team or solo player. This expansion is explicitly called out for migration approval rather than hidden as a new-column-only migration.
- New foreign keys, a solo entrant unique index, claim unique index, check constraints and lock/immutability triggers enforce the new boundaries. Previous migrations remain byte-for-byte unchanged.

No data backfill, ranking recalculation, existing record rewrite, destructive table/column drop, ownership reassignment or user merge is included. Existing team registrations satisfy the entrant-kind constraint because the original column was required.

Risks requiring a separately approved Neon validation include DDL lock duration on populated registration/roster tables, index/check scans, deployed schema drift, FK privileges, existing application assumptions about non-null team joins, and multi-session lock contention/deadlock behavior. PostgreSQL may abort a deadlocked transaction; it must not be reported as a successful registration/lock. These endpoints fail closed, but no automatic deadlock retry is introduced. Private evidence requires suitable database access and backup permissions. Future attendance/lateness governance must not be enabled by manually fabricating approval references.

The SQL uses ordinary PostgreSQL constructs and no new extension. It was replayed only into a fresh in-memory PGlite database with earlier migrations and historical fixtures. This is not a live Neon compatibility guarantee or a native Prisma-to-Neon integration test. Before any approved migration application, use an isolated Neon branch/clone, verify the actual schema/version and backup, rehearse all migrations, compare preservation counts and IDs, and run separate-connection capacity/locking/revocation races through the real Prisma client. No configured database inspection or branch creation occurred in this task.

## Validation

- Backend regression suite: **220 passing tests in 25 files**, including identity/security and preview-server regressions from earlier phases.
- Phase 4 additions exercise exact check-in boundaries, all four formats, capacity/deadline gates, overlapping registration/lock requests, duplicate claims/players, Floor 1 rejection, pending Floor 2 handling, pre-lock substitute activation, incomplete-team exclusion, 63/64/65 thresholds, bench exclusion, persisted 64-player Grand classification, pre/post-lock withdrawals, override/auth rejection, canonical snapshot integrity and audit-failure rollback.
- Existing format/capacity tests cover all 24 approved format/capacity combinations and the six owner classification examples.
- Migration replay fixtures preserve an existing user/profile with NR 1432, historical team registration/check-in, stable IDs, a legacy 3v3 Swiss event and its nonstandard historical capacity.
- TypeScript checks and Prisma validation/client generation pass. Backend and unchanged frontend production builds pass. Builds use a nonconnecting placeholder database URL for the backend.
- Fresh backend and frontend npm audits report **zero advisories**. No dependencies or lockfiles changed in this phase.
- Whitespace and governance consistency checks pass. Phase-start hash comparison confirms preserved historical documents, earlier migrations, NR/rank files, root prototype/design assets and unchanged frontend source/emblem assets.

Concurrency tests execute overlapping service requests against a single-connection PGlite adapter; they do not prove separate-session PostgreSQL/Neon behavior. No live Steam/Discord callback, live browser tournament journey, configured Neon connection, real production attendance evidence or production migration was tested. The `demo:smoke` script was not run because it reads a running server and database; no separately approved isolated HTTP/database environment was configured. The adapter and approved-policy fixtures are test infrastructure, not alternative runtime identity/database systems.

## Unresolved decisions and approval boundary

GOV-008/016/018 now reflect the explicit Phase 4 incomplete-team, timing and trigger approvals. GOV-040–043 separately record the remaining field-size/byes, attendance evidence, lateness review authority and registration deadline decisions. GOV-012/039 preserve the unapproved 3v3/2v2 substitute maxima. Exceptional roster corrections, advanced-style thresholds and Grand rewards remain unapproved. Historical source snapshots and existing published rules are unchanged.

Live operation of affected paths still needs those governance decisions, an approved mechanism for installing their configuration/verification records, a separately approved migration rehearsal/application, and actual provider/database integration validation. No new tournament can be opened merely by ignoring the readiness blockers.

Stop here for owner review. Phase 5, push, deployment, configured-database writes and migration application require separate explicit authorization.

## Changed-file inventory

- `backend/app/admin/page.tsx`
- `backend/app/api/admin/matches/[matchId]/record-result/route.ts`
- `backend/app/api/admin/tournaments/[tournamentId]/finalize/route.ts`
- `backend/app/api/admin/tournaments/[tournamentId]/generate-bracket/route.ts`
- `backend/app/api/tournaments/[tournamentId]/check-in/route.ts`
- `backend/app/api/tournaments/[tournamentId]/lateness/route.ts`
- `backend/app/api/tournaments/[tournamentId]/open-registration/route.ts`
- `backend/app/api/tournaments/[tournamentId]/registrations/[registrationId]/roster/route.ts`
- `backend/app/api/tournaments/[tournamentId]/registrations/[registrationId]/withdraw/route.ts`
- `backend/app/api/tournaments/[tournamentId]/registrations/route.ts`
- `backend/app/api/tournaments/[tournamentId]/route.ts`
- `backend/app/api/tournaments/route.ts`
- `backend/app/tournaments/[tournamentId]/page.tsx`
- `backend/app/tournaments/page.tsx`
- `backend/docs/PHASE4_REGISTRATION_AND_LOCK.md`
- `backend/governance/decisions.json`
- `backend/lib/tournament-attendance-policy.ts`
- `backend/lib/tournament-hosting.ts`
- `backend/lib/tournament-public.ts`
- `backend/lib/tournament-registration.ts`
- `backend/prisma/migrations/20261016150000_registration_lock/migration.sql`
- `backend/prisma/schema.prisma`
- `backend/tests/phase4-api.test.ts`
- `backend/tests/phase4-database.test.ts`
- `backend/tests/tournament-api.test.ts`
- `backend/tests/tournament-attendance-policy.test.ts`
- `backend/tests/tournament-hosting.test.ts`
- `docs/governance/decision-register.md`
- `docs/governance/implementation-conflicts.md`
- `docs/governance/unresolved-decisions.md`
