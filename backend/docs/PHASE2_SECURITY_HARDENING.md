# Phase 2 security hardening follow-up

Authorized scope: fresh authentication for provider linking, administrative hold isolation, targeted dependency remediation, preview file restrictions and regression coverage. Recorded 2026-10-16. Phase 3, production migration, push and deployment remain unauthorized. The earlier Phase 2 report describes its earlier checkpoint; this follow-up supersedes its descriptions of the named security gaps and dependency findings only. Governance decisions and historical rule versions are unchanged.

## Fresh authentication

Every Steam/Discord LINK initiation now requires the current password for the signed-in account. The server rate-limits password verification and checks the current stored hash and account state. Inside the challenge transaction it locks/rechecks the account, rejecting concurrent password changes or suspension. Client-supplied account IDs and authentication timestamps are not trusted.

A successful challenge stores only the server authentication timestamp, not the password or hash. Linking proof lasts five minutes and is checked again in the callback, including after provider verification. Existing challenges lacking this timestamp are rejected and must be restarted. Browser/session binding, single-use consumption and replay protection remain in place. Provider sign-in remains separate and does not require the local password; linking/reverification does. All existing accounts have the password field in the retained schema. Account recovery for forgotten passwords is not added by this follow-up.

The identity page adds a current-password field using the existing form styles. It clears the password after each attempt and never saves it to browser storage or provider URLs. The server does not audit request bodies or passwords.

## Administrative holds

External identities now distinguish routine self-reported verification loss from an administrative security hold. Administrative revocation sets `administrativeHoldAt` and `revocationKind=ADMIN`, in the same transaction as the audit. Fresh provider proof cannot clear it. Held identities also fail provider sign-in and competitive identity checks even if an inconsistent record lacks `revokedAt`. Password access to the existing account is not automatically removed.

Self-revocation cannot overwrite an active hold or convert an unknown legacy revocation into a self-reported one. Legacy revoked identities without provenance fail closed for administrator review; no migration guesses their history or changes account status.

`POST /api/admin/identities/:nmdId/release-hold` requires current authorized administrator permissions, a different target user, a documented reason/reference and atomic audit. Release clears the hold but leaves verification revoked with `ADMIN_CLEARED`; it does not mark the provider verified or award competitive eligibility. The player must then authenticate freshly and prove control of the same provider identity. Provider ownership cannot be transferred or replaced through these endpoints.

## Preview server

The original `server.cjs` remains a localhost preview on port 5173. It now serves an explicit allowlist of public HTML/CSS/JavaScript, the existing mountain artwork and selected public rule/proposal documents. It rejects private repository paths, hidden files, malformed encoding, raw/encoded traversal, nested percent encoding, null bytes and backslashes. It checks every path segment for symlinks, verifies the real path, opens the final file without following symlinks, and accepts only GET/HEAD. Error responses do not reveal filesystem paths. It sets `nosniff` and a no-referrer policy.

`.env` files, backend/frontend source, package manifests/lockfiles, Git metadata, node_modules, governance history and arbitrary future files are not public. Adding a public asset now requires an explicit allowlist entry. Application markup, styles, game data and design are unchanged. Filesystem races involving a malicious local actor with write access are not a substitute for OS-level permissions; do not expose this development server as production hosting.

## Dependency remediation

No `npm audit fix --force`, peer-dependency bypass or Next/Prisma major migration was used.

| Chain | Remediation | Compatibility evidence |
| --- | --- | --- |
| Vitest/mocker/Tinypool | Vitest 3.2.7 → pinned 4.1.11; matching mocker packages; vulnerable Tinypool removed from lockfile | Full suite; explicit automatic JSX transform for the updated Vite test stack; ESM test config renamed to `vitest.config.mts` |
| Next/PostCSS, both apps | Pinned PostCSS 8.5.30 override in both manifests | Both Next.js production builds and TypeScript checks; lock regression checks |
| Prisma/config/deepmerge-ts | Scoped `@prisma/config` override to deepmerge-ts 8.0.0; Prisma/client remain 6.19.3 | Schema validation/client generation/build; standard and cyclic merge regression; actual Prisma configuration loading |

Backend Next remains 15.5.27; frontend Next remains at its previously locked 15.5.28. Neither Next.js nor Prisma changed major versions. Deepmerge 8 changes Map-merging semantics: the existing project has no custom Map-based Prisma config. The scoped override is deliberately pinned and must be reviewed on later Prisma/config upgrades. The underlying merge API used by Prisma remains available and is tested.

The test-tool upgrade required a temporary npm 11 resolver after npm 10 hit an internal peer-tree exception. No unsafe force/legacy-peer flag was used. Both apps declare Node >=22.12.0; validation used a temporary Node 22.23.3 runtime.

Fresh npm audits returned **zero reported vulnerabilities** for backend and frontend. This is an advisory-database result, not a guarantee of absence of vulnerabilities. The earlier eight affected-package entries are no longer present in these audit results. Frontend `npm ls` reported two extraneous optional platform packages in the local install; no invalid peer dependency was reported, and neither is an added runtime dependency in the lockfile.

References: [Vitest mocker fix](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9), [Tinypool fix](https://github.com/tinylibs/tinypool/security/advisories/GHSA-85c8-ppgw-ccpr), [deepmerge 8 security and compatibility notes](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0), [PostCSS releases](https://github.com/postcss/postcss/releases), [Vite transform configuration](https://vite.dev/config/shared-options.html#oxc).

## Additive migration review

`20261016103000_identity_hardening/migration.sql` adds three nullable columns: ExternalIdentity.administrativeHoldAt, ExternalIdentity.revocationKind and IdentityChallenge.reauthenticatedAt, plus checks limiting supported values. The foundation and previous Phase 2 migrations are unchanged. No DML/backfill deletes or rewrites records, NMD IDs, ratings, matches, rosters or rules.

Risk review before application:

- Apply only after the Phase 2 identity migration, on a separately approved test branch first. This session used only disposable in-memory PostgreSQL tests.
- ALTER TABLE needs short locks; schedule and validate against the actual Neon schema/migration history before any production rollout.
- Old linking requests intentionally become unusable because they lack fresh proof. Players restart linking; existing account sessions and history are retained.
- Legacy unclassified revocations intentionally need documented admin review. There is no automatic release or inferred disciplinary finding.
- New code requires these columns. Review migrations and code rollout together; do not deploy code against an unmigrated schema.
- A rollback must not restore the unsafe reverification path while active holds exist. Retain hold/audit data and disable linking if an application rollback would ignore it.

No configured PostgreSQL/Neon database was contacted or migrated. No database credentials were inspected. Production application requires separate owner approval.

## Validation and remaining work

Regression coverage includes correct/missing/wrong password, server-issued authentication timestamps, concurrent password changes, expired/legacy linking challenges, administrator/unknown holds, self-revocation bypass attempts, authorized documented hold release, retained revocation pending fresh proof, real SQL hold persistence, preview sensitive paths/traversal/symlinks/HEAD, safe dependency locks, cyclic merge handling and actual Prisma config loading. Original ranking tests remain intact.

Remaining checks before real users: live Steam/Discord flows with registered credentials/callbacks, approved multi-connection PostgreSQL/Neon tests, production HTTPS/origin configuration, trusted-ingress rate-limit setup, least-privilege database access and temporary-record retention. Independent hosting-conflict integration belongs to Phase 3; complete competition result/appeal/settlement workflows retain their existing phase gates. Zero advisory results do not activate those features.

No owner decision on competitive rules was changed. An approval for reviewed database rollout and live-provider testing is distinct from approval for Phase 3. No push or deployment was performed.

## Follow-up file inventory

- `backend/app/api/admin/identities/[nmdId]/release-hold/route.ts`
- `backend/app/api/admin/identities/[nmdId]/revoke/route.ts`
- `backend/app/api/identity/[provider]/callback/route.ts`
- `backend/app/api/identity/[provider]/revoke/route.ts`
- `backend/app/api/identity/[provider]/start/route.ts`
- `backend/app/api/identity/status/route.ts`
- `backend/app/identity/IdentityActions.tsx`
- `backend/app/identity/page.tsx`
- `backend/docs/PHASE2_SECURITY_HARDENING.md`
- `backend/lib/competition-authority.ts`
- `backend/lib/identity-policy.ts`
- `backend/lib/identity.ts`
- `backend/lib/link-authentication.ts`
- `backend/lib/permissions.ts`
- `backend/lib/session.ts`
- `backend/package-lock.json`
- `backend/package.json`
- `backend/prisma/migrations/20261016103000_identity_hardening/migration.sql`
- `backend/prisma/schema.prisma`
- `backend/tests/hold-release.test.ts`
- `backend/tests/identity-callback.test.ts`
- `backend/tests/identity-holds.test.ts`
- `backend/tests/identity.test.ts`
- `backend/tests/link-authentication.test.ts`
- `backend/tests/phase2-database.test.ts`
- `backend/tests/preview-server.test.ts`
- `backend/tests/security-dependencies.test.ts`
- `backend/tests/self-revocation.test.ts`
- `backend/vitest.config.mts`
- `backend/vitest.config.ts` (renamed to vitest.config.mts)
- `frontend/package-lock.json`
- `frontend/package.json`
- `server.cjs`

## Recorded check results

- Regression suite: **110 tests passed across 17 files**, including seven isolated PostgreSQL SQL tests.
- Backend and frontend TypeScript checks: passed.
- Prisma schema validation and client generation: passed; validation used a dummy unreachable URL.
- Backend and frontend Next.js production builds: passed; backend build used a dummy unreachable database URL.
- Final npm audits: **0 reported vulnerabilities in each app**.
- Governance/design/ranking/emblem/prior-migration integrity and follow-up scope checks: passed.
- `git diff --check`: passed.

The isolated SQL engine has one connection. These checks are not live-provider or multi-session Neon validation. No configured or production database was modified.
