# Nuudeltsgeey backend

> Governance reconciliation: consult the [current decision register](../docs/governance/decision-register.md) and [preserved pre-reconciliation source](../docs/governance/history/backend/README.md). The original text below is retained; conflicting Grand Battle restrictions, blanket 3v3 deferral, economic proposals and older workflows do not override later approved decisions. This notice does not change application behavior or historical tournament rules. Check-in timing remains under revision.

This is the real backend foundation for the current project. It uses Next.js, Auth.js/NextAuth, Prisma, and PostgreSQL while preserving the existing browser prototype.

## Scope

- Private identity fields are stored separately from public player profiles.
- Public NMD IDs are generated server-side and are distinct from internal database IDs.
- Team, café, tournament, match, ranking, achievement, incident, suspension, correction, and audit models are included.
- Tournament sizes and styles remain flexible.
- 5v5 rosters support five starters plus one optional substitute.
- Ranking transactions preserve the current policy: Floors 1–2 are protected; Floor 3+ losses may reduce NR; participation and opponent strength affect verified results.
- Tournament award defaults follow the approved pilot document: participation +5 NR, champion +50, runner-up +30, semifinalist +15. Awards must be idempotent.
- Identity, verification, disciplinary, and result workflows require authenticated route handlers before production use.
- Unverified accounts are not exposed through the public profile route; private identity fields are never selected by that route.
- Authentication uses Auth.js/NextAuth credentials with secure framework-managed sessions; the earlier custom JWT cookie layer is no longer active.

## Implemented workflow routes

- `POST /api/register`, `POST /api/auth/login`, and `POST /api/auth/logout`
- `GET/POST /api/teams`
- `POST /api/teams/:teamId/invitations`
- `POST /api/team-invitations/:invitationId`
- Protected admin verification, registration decisions, check-in, roster locking, bracket generation, result verification/locking, incident decisions, suspensions, and tournament completion.

Bracket generation is system-owned and supports non-power-of-two team counts with byes. It does not provide opponent selection, seed editing, or reroll controls.

## Database setup

Set a private `DATABASE_URL` in `.env`, then run:

```sh
npm run db:validate
npm run db:migrate -- --name foundation
npm run db:generate
```

The foundation migration has been applied to the configured PostgreSQL database. The local `.env` is intentionally untracked.

## Run

Copy `.env.example` to `.env`, set a private PostgreSQL `DATABASE_URL`, then run `npm install`, `npm run db:validate`, `npm run db:generate`, and `npm run dev` from this directory. For the repeatable first demo, follow [docs/DEMO.md](docs/DEMO.md) and run `npm run demo:smoke`.

Do not commit `.env`, real identity data, passwords, or production credentials.

## Phase 2 identity and authority

See [the Phase 2 review](docs/PHASE2_IDENTITY_AUTHORITY.md) for identity linking, permission boundaries, configuration, tests and the additive migration risk review. The new migration is a proposal for review, not production approval. No production migration or deployment was performed.

## Final Phase 4 governance

The owner-approved final policy is implemented prospectively for newly opened events. See [the Phase 4 report](docs/PHASE4_REGISTRATION_AND_LOCK.md) and [API/database contract](docs/PHASE4_FINAL_API_DATABASE.md). Registration closes at start minus 15 minutes; players confirm their own attendance; qualifying Floor 2 personal late requests are approved and consumed atomically with check-in by start plus 15 minutes. Every team format permits one optional substitute. Phase 5 owns approved fair random byes and remains unimplemented. No configured Neon migration was applied.
