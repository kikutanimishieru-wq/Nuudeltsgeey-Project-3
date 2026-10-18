# Final Phase 4 API and database contract

The prospective owner-approved version is `OWNER_PHASE4_FINAL_2026_10_16`, source S5 in the governance register. Existing published policies and locked snapshots are not upgraded. Unsupported match-specific attendance remains rejected with `MATCH_SCHEDULE_INTEGRATION_UNAVAILABLE`.

## Opening and registration

A verified host creates a free Open Bracket draft through the existing `POST /api/tournaments` with name, venue, format, entrant capacity and an ISO scheduled start including offset. The maximum remains three active hosted events, including drafts.

`POST /api/tournaments/:id/open-registration` explicitly publishes an owned empty draft. It stores the approved deadline at start minus 15 minutes, self-attendance policy `AUTHENTICATED_SELF_CONFIRMATION_V1`, the S5 rule reference and the approved team substitute limit. It rejects existing published/populated policies instead of retroactively adopting new rules. An old unopened draft with no policy or entrants can adopt S5 through this explicit action. A draft without a scheduled start cannot open.

`POST /api/tournaments/:id/registrations` accepts `{roster:[{playerId,isStarter}],teamId?}`. Profile IDs identify roster members; the server derives the acting user from the session. Solo players can register only themselves, and a team captain may register current verified team members. Registration closes at capacity or start minus 15 minutes, whichever occurs first. The exact closing instant is rejected. Registration does not check anyone in.

The pre-lock roster and withdrawal routes remain unchanged. Every team format allows one optional substitute, with current membership, verified eligibility, duplicate and size checks. No additions or original-roster edits are permitted after lock. Existing post-lock between-completed-matches authority rules remain policy; their execution is not added here.

## Ordinary attendance

`POST /api/tournaments/:id/check-in` accepts an empty body or `{}`. It confirms only the authenticated registered player's attendance in `[start − 15 minutes, start)`. No `playerId`, captain confirmation, referee approval, timestamp or classification override is accepted. Success returns `status: CONFIRMED`, `attendance: SELF_CONFIRMED` and the server `checkedInAt` timestamp.

Successful retries return the same receipt, including after the window closes or classification locks, without another audit/consumption. Current authentication and eligibility still apply. A replay naming a request must name that player's own approved request.

`GET /api/tournaments/:id/attendance` returns only the current verified session player's receipt, server time, ordinary window, protection-used flag and own pending request ID/status/deadline. It has `Cache-Control: no-store`; query-string player IDs cannot select another player. It does not expose private reasons or evidence. The page uses this endpoint to recover pending request state after refresh. No localStorage attendance evidence is used.

Self-confirmation is not independent physical-presence verification. The historical `attendanceVerifiedAt` and `attendanceEvidenceRef` fields are preserved; this workflow does not fill them or require them for self-confirmed eligibility.

## Protected late arrival

1. The personally authenticated eligible Floor 2 player posts `{"reason":"Transport delay"}` to `/api/tournaments/:id/lateness` at or after the scheduled start and no later than start plus 15 minutes. Reason is trimmed, non-empty and limited to 1,000 characters. An optional evidence reference is private and not required for approval. `matchId` remains unsupported.
2. The server creates a `REQUESTED` request and returns its ID and protected deadline. An overlapping pending request is rejected; creating a request does not approve attendance or consume the incident.
3. The player personally posts `{"latenessRequestId":"returned-id"}` to the check-in endpoint by the deadline. At exactly start plus 15 minutes this is still allowed.
4. One transaction verifies identity, membership, floor, request ownership/scope and unused protection; sets request/incident `AUTO_APPROVED`; records actor, decision time and `usedAt`; records self-check-in; and inserts audits. A failed audit rolls everything back.

Floor 1, empty reason, foreign requests, a used incident and attempts after the deadline are rejected. Only the existing successful receipt is replayable. Expiry is evaluated using database time on attendance/request/finalization mutations and committed even when a late check-in returns a deadline conflict. Expired requests record `expiredAt` and do not set `usedAt`. The read-only status endpoint also reports effective expiry immediately. There is no new background scheduler.

The incident remains unique per player/tournament. Individual request rows preserve expired/decided attempt history separately. A future approved match adapter must reuse this same incident and conditional consumption operation rather than create a second per-match allowance. No match-start schedule is inferred or enabled here.

## Finalization

The existing `/api/admin/tournaments/:id/finalize` accepts only an empty body or `{}`. It requires a current independent referee/admin. It serializes with registration, check-in, late arrival and roster changes using the same tournament lock. It rechecks user/profile eligibility and current team membership under locks.

A necessary eligible absent Floor 2 starter with unused protection delays finalization through the inclusive protected deadline. After protections resolve or expire, entrants without enough eligible self-checked-in active starters are disqualified from starting. Their history remains, and no identity is revoked or disciplinary sanction imposed. Unused bench players, absent starters and disqualified entrants do not contribute to classification.

All remaining eligible entrants are retained, including a non-power-of-two field. No phase-4 bye assignment or arbitrary elimination occurs. Phase 5 will implement the approved fair automatic byes and auditable, reproducible random seeding. Zero/one eligible entrants can be recorded in a finalization snapshot; this does not claim a playable bracket or start a match.

The immutable snapshot and atomic audit preserve the distinct active count and classification (`>=64` means Grand Battle). Post-lock withdrawal cannot change that result. No rewards, ranking multiplier, bracket, result settlement or new ranking formula is produced.

## Database expansion and review

New migration: `20261016170000_final_attendance_governance`. It is unapplied to configured/production databases.

- Adds nullable `policyVersion` to the existing one-per-player/tournament lateness incident. Historical pending rows remain unchanged with a null version.
- Adds `TournamentLatenessRequest`, with request/expiry/completion facts and a foreign key to the shared incident.
- Adds partial unique indexes allowing at most one pending request and one completed request per incident, regardless of future match context.
- Adds scope, state and time checks, immutable request facts/final decisions, no-delete history guards and protection against resetting a consumed incident.
- Expands the existing configuration check prospectively so S5 2v2/3v3 configurations may store the approved single substitute; old versions retain their prior storage constraints.
- Expands the pending-only incident check for the explicit S5 version while retaining the old pending-only restriction for null-version history.

Earlier migration files and existing rows are not rewritten. Constraint replacement is a compatible expansion inside an explicit SQL transaction, not a destructive data migration. DDL still needs a separate Neon rehearsal and approval: check deployed schema drift, old constraint names/contents, locks and table scans, Prisma/PostgreSQL array locking, trigger privileges, backup/rollback readiness and separate-session races under real network latency. Migration checks and request timing were exercised in isolated PGlite tests, not configured Neon or live provider callbacks.
