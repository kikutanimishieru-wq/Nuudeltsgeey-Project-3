# Phase 2 — Identity and authority review

Scope: Phase 2 only, authorized after governance reconciliation and the substitution follow-up. No Phase 3 tournament creation/classification work, push, deployment, production connection, or production migration. Historical rules and governance decisions remain unchanged.

## Identity implementation

The existing Auth.js JWT session system remains in use. Steam OpenID and Discord authorization-code proofs feed a short-lived one-use Auth.js credentials grant; there is no second session system or automatic account merge. Existing password sign-in and registration remain available. First-time users register/sign in to their existing account, then visit `/identity` to link each provider. A linked provider can subsequently sign in to that same identity.

Steam assertions require the fixed Valve endpoint, matching identity/claimed ID, exact state-bound return URL, required signed fields, fresh nonce, direct server-side signature validation, and database nonce uniqueness. Discord uses only `identify`, not email or guild membership scopes. Provider access/refresh tokens are not stored. Verification means provider account possession at the recorded time, not legal identity, anti-cheat clearance, or continuous monitoring of account sharing.

Linking requires the initiating session and browser cookie. Challenges and login tickets are random, hashed in storage, expiring, and atomically consumed. Linking never replaces a different linked identity or transfers another user's account. Provider IDs have database uniqueness constraints and are not returned by identity-status/public-profile APIs or recorded in identity audit metadata.

Self-reported or documented administrator verification loss sets `revokedAt`, preserving provider ownership and existing registrations. New protected roster approval/check-in/lock/draw operations require both provider proofs and eligible current account state. Withdrawal/rejection is not blocked solely by lost provider verification. Reverification requires fresh proof of the same provider identity. No automatic polling/webhook claim is made for external revocation. Different-account replacement remains unavailable pending documented administrative correction; no arbitrary transfer API is introduced.

## Authority and auditing

- Privileged checks read current database roles/status rather than relying on JWT role claims. Mutation transactions recheck and lock current authority where applicable.
- Admin dashboard authorization happens before tournament/registration queries. Non-admin sign-in does not create a dashboard/login redirect loop.
- Referees can access authorized minor case review; serious cases/unknown categories and Levels III–IV require administrators. Level V execution stays unavailable pending badge catalog and owner-approval workflow. This phase does not invent appellate authority.
- Review requires recorded involved parties and a different administrator's attested assignment. Checks reject reporter/party involvement, tournament participation, and involved-team membership. Existing cases without sufficient context fail closed. Assignments append parties; recorded conflicts cannot be removed through this API. Unrecorded relationships/host affiliations require honest administrative attestation; a complete host model belongs to later phases.
- Direct suspension requires an established, independently reviewed suspension decision, involved target, defined future end time, and single execution. Condition-based suspensions without a supported end-time representation are unavailable, not silently indefinite.
- Role changes require an active SUPER_ADMIN, a different target, and a documented reason. The API cannot create, remove or transfer SUPER_ADMIN authority.
- Protected database mutations and audit records share the same transaction. Audit failures roll back state changes. Audit metadata avoids raw request bodies, provider secrets and evidence. Administrative review reasons are private; no public audit/evidence endpoint is added.
- Exact-origin CSRF checks protect POST mutations, including alternate Auth.js POST endpoints. Rate limits use atomic PostgreSQL upserts, hashed keys and shared state across workers. Missing limiter storage fails closed. Without a trusted ingress IP header, ingress requests share a conservative bucket; never enable a client-spoofable header.

Default technical limits (not competition rules): 120 mutations/minute per ingress key; 30 identity callbacks/minute per ingress key; 8 password attempts/10 minutes per normalized account; 5 registrations/hour per account; 10 link starts/10 minutes per user; 60 privileged checks/minute per actor. Auth.js internal provider tickets remain short-lived and one-use. Operators must tune traffic limits against legitimate attendance loads.

## Configuration and routes

Set `APP_URL` and `AUTH_URL` to the same canonical backend origin. Production requires HTTPS. Register Discord callback `${APP_URL}/api/identity/discord/callback` and supply `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET`. Never commit real credentials. Steam callback is `${APP_URL}/api/identity/steam/callback`; no Steam Web API data/anti-cheat integration is claimed.

| Route | Purpose |
| --- | --- |
| `GET /identity` | Existing-style account linking/sign-in screen; provider IDs hidden |
| `POST /api/identity/{steam,discord}/start` | Explicit `LINK` or `SIGN_IN`; same-origin initiation |
| `GET /api/identity/{steam,discord}/callback` | Validated provider proof and state/session binding |
| `GET /api/identity/status` | Current user's verification status/timestamps only |
| `POST /api/identity/{steam,discord}/revoke` | Self-reported verification loss |
| `POST /api/admin/identities/:nmdId/revoke` | Documented admin revocation with reason/reference |
| `POST /api/admin/players/:nmdId/role` | SUPER_ADMIN-only non-owner role changes |
| `POST /api/admin/incidents/:incidentId/assign` | Record parties and independently attest reviewer assignment |

Existing admin/registration/team/auth mutations gain boundary protection and atomic auditing. Existing competitive result/settlement behavior is not redesigned in this phase: captain workflow, full private-case lifecycle, finality holds, classification, roster lifecycle and approved check-in boundaries still require their planned phases. Passing Phase 2 tests is not competition readiness.

## Additive migration risk review — not production approval

Proposal: `prisma/migrations/20261016093000_identity_authority/migration.sql`.

Adds one enum and seven tables: ExternalIdentity, IdentityChallenge, IdentityLoginGrant, SteamAssertionNonce, RateLimitBucket, IncidentParty, ReviewAssignment. Adds provider/slot uniqueness, foreign keys and checks for subject shape, intent/session binding, independent assigner and positive rate counts. No existing rows, NR values, rule-version references, or foundation migration are rewritten. The Prisma schema gains only these models/relations.

Risks and rollout requirements:

1. Existing ACTIVE flags do not prove Steam/Discord possession. No verification backfill is performed; affected competitive operations require linking first.
2. New code requires the new tables. Review/test the migration on an approved non-production branch before deploying code. It has not been applied to any configured PostgreSQL/Neon database in this session.
3. Foreign-key creation takes brief locks on referenced User/Incident tables. Plan a reviewed deployment window and backup/restore check before production application.
4. Legacy cases have no inferred parties/assignments. They need independent, documented context before decisions; no migration guesses parties or host affiliations.
5. Provider IDs and case relationships are private records requiring restricted database access/backups. No tokens, real external identities or production evidence are seeded.
6. Operational retention/cleanup is needed for expired challenges, grants, nonces and rate buckets. No destructive cleanup job is introduced. Never remove a live nonce or active rate bucket early.
7. Rollback should revert application code while preserving new audit/identity data. Do not drop populated identity/audit tables as an automatic rollback.

The migration was executed only inside a disposable in-memory PGlite test instance alongside the original foundation SQL. No production URL was read or used. SQL uniqueness, atomic rate counts, one-use consumption, legacy data preservation and audit-failure rollback are covered. PGlite has one connection: this is not proof of multi-session PostgreSQL/Neon locking or Prisma wire integration. Those checks remain required on an approved isolated server.

## Validation and remaining issues

The Phase 2 suite covers provider proof validation, session/state replay boundaries, ownership conflicts, dual verification, current role checks, dashboard read denials, reviewer conflicts/assignments, CSRF, rate limits, safe errors, SQL constraints and audit rollback. Existing ranking/rank/bracket tests remain unchanged. The existing bye-support test remains a known later-phase governance conflict; passing it does not approve byes.

Live Steam/Discord round trips require configured provider credentials and a reviewed test environment. No live external identity was linked here. No full venue verification, anti-cheat, account-sharing detection, identity reassignment or appellate assignment hierarchy is claimed.

The installed existing dependency graph reports 8 npm advisories: 2 moderate, 4 high, 2 critical. They involve the Next/PostCSS, Prisma/deepmerge-ts and Vitest/tinypool/mocker chains. The suggested fixes include major upgrades; none were applied automatically. Only a pinned development-only PGlite dependency was added for isolated SQL tests. Review the advisory graph before public deployment; run tests only on trusted code/data in the meantime.

Protocol references: [Valve Steam OpenID](https://steamcommunity.com/dev), [OpenID 2.0 verification specification](https://openid.net/specs/openid-authentication-2_0.html), [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2), [Auth.js credentials extension](https://authjs.dev/getting-started/providers/credentials), [PGlite single-connection test engine](https://pglite.dev/docs/).

## Files changed in Phase 2

This inventory excludes the previously completed Phase 1 changes.

- `backend/.env.example`
- `backend/README.md`
- `backend/app/admin/login/page.tsx`
- `backend/app/admin/page.tsx`
- `backend/app/api/admin/identities/[nmdId]/revoke/route.ts`
- `backend/app/api/admin/incidents/[incidentId]/assign/route.ts`
- `backend/app/api/admin/incidents/[incidentId]/decide/route.ts`
- `backend/app/api/admin/matches/[matchId]/lock-result/route.ts`
- `backend/app/api/admin/matches/[matchId]/record-result/route.ts`
- `backend/app/api/admin/matches/[matchId]/verify-result/route.ts`
- `backend/app/api/admin/players/[nmdId]/role/route.ts`
- `backend/app/api/admin/players/[nmdId]/suspend/route.ts`
- `backend/app/api/admin/players/[nmdId]/verify/route.ts`
- `backend/app/api/admin/tournaments/[tournamentId]/complete/route.ts`
- `backend/app/api/admin/tournaments/[tournamentId]/generate-bracket/route.ts`
- `backend/app/api/admin/tournaments/[tournamentId]/lock-rosters/route.ts`
- `backend/app/api/admin/tournaments/[tournamentId]/registrations/[registrationId]/check-in/route.ts`
- `backend/app/api/admin/tournaments/[tournamentId]/registrations/[registrationId]/route.ts`
- `backend/app/api/auth/[...nextauth]/route.ts`
- `backend/app/api/auth/login/route.ts`
- `backend/app/api/auth/logout/route.ts`
- `backend/app/api/identity/[provider]/callback/route.ts`
- `backend/app/api/identity/[provider]/revoke/route.ts`
- `backend/app/api/identity/[provider]/start/route.ts`
- `backend/app/api/identity/status/route.ts`
- `backend/app/api/register/route.ts`
- `backend/app/api/team-invitations/[invitationId]/route.ts`
- `backend/app/api/teams/[teamId]/invitations/route.ts`
- `backend/app/api/teams/route.ts`
- `backend/app/identity/IdentityActions.tsx`
- `backend/app/identity/page.tsx`
- `backend/auth.ts`
- `backend/docs/PHASE2_IDENTITY_AUTHORITY.md`
- `backend/lib/audit.ts`
- `backend/lib/competition-authority.ts`
- `backend/lib/identity-providers.ts`
- `backend/lib/identity.ts`
- `backend/lib/permissions.ts`
- `backend/lib/rate-limit.ts`
- `backend/lib/request-security.ts`
- `backend/lib/reviewer.ts`
- `backend/lib/secure-route.ts`
- `backend/lib/security-error.ts`
- `backend/lib/session.ts`
- `backend/lib/transaction-authority.ts`
- `backend/package-lock.json`
- `backend/package.json`
- `backend/prisma/migrations/20261016093000_identity_authority/migration.sql`
- `backend/prisma/schema.prisma`
- `backend/tests/admin-dashboard.test.ts`
- `backend/tests/identity-callback.test.ts`
- `backend/tests/identity-providers.test.ts`
- `backend/tests/identity.test.ts`
- `backend/tests/permissions.test.ts`
- `backend/tests/phase2-database.test.ts`
- `backend/tests/request-security.test.ts`
- `backend/tests/reviewer.test.ts`
- `backend/vitest.config.ts`

## Recorded check results

- Prisma schema validation and client generation: passed (dummy URL for validation; no database connection).
- Backend TypeScript check: passed.
- Vitest: 65 tests passed across 11 files, including five isolated PostgreSQL SQL tests.
- Next.js production build: passed with a dummy unreachable database URL.
- Localhost HTTP smoke: admin redirect, private identity status 401, foreign-origin link and alternate credentials callback 403, identity page 200. Production HTTP canonical configuration first correctly failed closed with 503; the smoke setup was corrected to an HTTPS canonical origin. No enforcement was weakened.
- Historical snapshot/Phase 1 registry hashes, protected ranking/emblem/foundation files and change-scope checks: passed.
- Dependency advisory review: eight existing advisories recorded above; not silently fixed through major upgrades.

No live provider account, configured database, production migration, push or deployment was used. Phase 3 requires explicit owner approval.
