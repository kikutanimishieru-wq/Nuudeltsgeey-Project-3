# Sprint 2A — Discord-first source foundation (offline only)

> Sprint 2A-F update: all LINK starts and callbacks are now fail-closed until
> persistent session/generation revocation is implemented. Linking availability
> statements below describe the earlier foundation. See SPRINT2AF_AUTH_HARDENING.md.

## Operational status

Source and mock tests only. No provider, server, database, migration or real account
has been used. `DISCORD_ACCOUNT_PROVISIONING_ENABLED` defaults to disabled (unset).
No configuration is changed by this sprint. Existing linked Discord accounts can
use the existing sign-in flow; creating a previously unseen identity requires both
separate feature activation and the reviewed nullable-credentials schema.

## Flow and transaction boundaries

Keep the existing `POST /api/identity/discord/start` with `intent: SIGN_IN`, fixed
provider authorization URL, state and browser cookie. The callback verifies the
provider code against Discord before entering its transaction. The verified stable
Discord ID is the only account lookup key; email, nickname and display name never
participate in resolution. No automatic account merge or identity transfer occurs.

Within the same callback transaction: consume the challenge conditionally, acquire
a transaction-scoped advisory lock namespaced by Discord ID, resolve/re-read the
identity under the User row lock, or create the account/profile/Discord link,
write sanitized audit events, then issue the browser-bound 60-second login grant.
The existing Auth.js linked-identity credential consumes that grant once and
rechecks current account/identity restrictions under a User lock. Session creation
occurs after callback commit. If that later step fails, the committed account is
preserved; a new explicit OAuth attempt reuses it. There is no automatic retry.

A simulated lock test demonstrates intended call ordering; it does NOT prove
PostgreSQL lock/isolation behavior, transaction rollback, connection/session
transport or unique-index enforcement. These require separately approved isolated
PostgreSQL integration testing. Database uniqueness remains the backstop against
other writers; conflicts stop instead of merging or retrying.

New users receive PLAYER role, UNVERIFIED status, a real allocated public NMD ID,
NULL email/password, a unique provisional Player-<random-id> nickname and a profile
with the existing 1000 NR default. No legal name, fake email or password is invented.
No rankings/history/membership records for existing accounts are replaced.

## Schema proposal — not applied

`proposals/SPRINT2A_PASSWORDLESS_USER.sql` is review material, outside Prisma's
migration directories. It drops NOT NULL only for User.email/passwordHash. Preserve
all data, uniqueness and references. Future schema.prisma must change those fields
to `String?`, retaining `@unique` on email; regenerate the client in a separately
approved stage. Neither schema.prisma nor existing migration files change here.

Until then, a fixed parameterized User insert expresses NULL credentials without
pretending the existing generated client supports nullable create inputs. It is
preceded by an exact two-column public-schema nullability/type check. This check
performs no DDL and does not establish deployment-wide schema approval. It fails
closed before NMD allocation if either column is not nullable text. Existing
NOT NULL deployments cannot provision Discord-only accounts through this path.

Applying this proposal changes the catalog and would require a separately reviewed
new migration/baseline process. Do not replay or edit the pinned seven Phase 4
migrations, checksum pins or guards. Restoring NOT NULL after passwordless accounts
exist is not an automatic rollback: preserve those accounts and review recovery.

## Identity and account restrictions

Steam SIGN_IN is rejected at challenge creation, challenge/callback validation,
Auth.js linked credentials and grant consumption, regardless of account role.
Steam records and explicit LINK/reverification remain. Revoked/held Discord
identities cannot sign in or be recreated. Suspended, badge-revoked and under-review
accounts cannot use Discord sign-in. Existing profile absence requires review,
not silent recreation. Unknown status values are denied by the sign-in policy.

The automatic eligibility helper promotes only PLAYER accounts currently CREATED,
UNVERIFIED or VERIFIED when both identities have verification timestamps and no
revocation/administrative hold. ACTIVE stays unchanged. Restrictions and role
values are never cleared or elevated. It runs after explicit linking or returning
Discord resolution. Competitive mutations still use existing backend eligibility
checks; a session or status field alone grants no tournament authority.

Activation never clears a revocation. Existing explicit fresh-proof re-verification
for SELF/ADMIN_CLEARED revocations remains unchanged; administrative holds still
require the existing independent review path. Steam revocation removes competitive
eligibility, not ordinary Discord access. Discord account replacement/recovery
is not implemented and must not be inferred from profile similarity.

## Legacy/admin compatibility and deliberate blockers

Existing password registration/login routes and the Credentials provider remain
available pending separately approved legacy/admin migration. Thus this is a
Discord-only NEW player path, not a claim that every legacy password endpoint is
retired. PLAYER, REFEREE, ADMIN and SUPER_ADMIN password roles are mock-regression
tested. NULL-password users cannot use the password provider. No existing passwords
are deleted, changed or backfilled.

Steam linking still requires fresh password authentication for legacy accounts.
Passwordless accounts fail closed there. Fresh, browser/session-bound Discord
reauthentication for Steam linking is the NEXT implementation requirement; no
session-only or client-claimed timestamp fallback has been introduced. Consequently
new Discord accounts cannot yet complete the full Steam/tournament journey.

An unseen Discord ID cannot reveal an unlinked legacy account owned by the same
person. Stable-ID uniqueness prevents duplicate Discord identities, not duplicate
humans. Legacy account claiming/recovery needs proof and separate policy review.
Never match or merge by Discord email, display name, nickname or Steam resemblance.

## Offline verification

Invoke the installed Vitest executable with an explicit list of mock-only auth,
identity, provider, hold, permission and request-security tests. Do not invoke the
whole suite: database/native test files exist. No npm build, Prisma generation,
migrate, seed, dev server, transport harness or Phase 4 command is needed.
TypeScript uses `tsc --noEmit --incremental false` only. Provider tests inject fake
fetch functions; Prisma and Auth.js boundaries are mocked.

## Next approvals

1. Independent source/security review, including raw insert, identity serialization,
   account statuses and preserved legacy access.
2. Schema/client preparation and migration review; no migration is authorized here.
3. Discord reauthentication design/implementation for passwordless Steam linking.
4. Separately approved isolated database migration/concurrency validation.
5. Separately approved provider/cookie/session end-to-end validation and eventual
   feature activation; keep production configuration unchanged until approved.

Frontend, ingress/proxy, transport harness and Phase 4 evidence are unchanged.
