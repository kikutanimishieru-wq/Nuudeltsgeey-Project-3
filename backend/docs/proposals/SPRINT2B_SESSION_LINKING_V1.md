# Persistent sessions and Steam linking — V1

**PROPOSED — NOT IMPLEMENTED OR APPROVED FOR MIGRATION.**

Document version: 1.1 (Sprint 2B-G clarification). Date: 2026-10-21 (Asia/Ulaanbaatar).
Scope: backend session issuance, revocation and a future protected linking protocol.
This is the authoritative consolidated design, superseding the conceptual outline
in SPRINT2AF_REVOCABLE_LINKING.md and prior conversational Sprint 2B reports.
No approval is implied by this document. No source/schema/test/configuration change,
migration, database/provider access or feature activation is authorized here.

## 1. Current evidence and non-negotiable boundaries

Inspected repository sources:

- backend/auth.ts: JWT strategy; password Credentials and Discord login-grant
  Credentials; JWT currently has no persistent session reference/generation.
- backend/app/api/auth/logout/route.ts: calls exported Auth.js signOut directly.
- backend/app/api/auth/[...nextauth]/route.ts: delegates GET/POST to Auth.js.
- backend/app/public-nav.tsx and backend/app/admin/page.tsx: logout forms target
  /api/auth/logout. No other application signOut() caller found in inspected paths.
- backend/lib/identity.ts: grant is currently claimed before User locking.
- identity callback: challenge is currently claimed before account resolution.
- backend/lib/discord-accounts.ts: Discord advisory lock precedes User or NMD
  allocator; new-account provisioning requires a flag and nullable credentials.
- backend/lib/link-authorization.ts: unconditional linking blocker.

Installed source, not merely an API assumption:
node_modules/@auth/core/lib/actions/signout.js lines 14–28 awaits events.signOut,
catches errors, logs SignOutError, then clears cookies. The next-auth server action
in node_modules/next-auth/lib/actions.js calls Auth and applies returned cookies.
Therefore an events.signOut exception cannot guarantee failed logout or durable
revocation. Installation/version changes require renewed integration review.

Retain Auth.js JWT cookies, existing provider verification, Origin/CSRF checks,
browser state binding, uniqueness, backend restrictions and sanitized audit.
Do not replace JWT authentication wholesale with Auth.js database sessions.
Steam never becomes a player sign-in provider. No account merging, identity
transfer, role elevation, history rewrite or fabricated email/password.

## 2. Proposed product policy — owner approval required before activation

- Versioned sessions: eight hours absolute from authentication; no sliding renewal.
- Discord reauthentication challenge: five minutes from issuance.
- Steam linking child: five minutes from fresh Discord proof, bounded by session
  expiry. Final use also requires reauthentication age <= five minutes.
- Login grant: retain existing 60-second expiry and one-time browser-bound use.
- Legacy-password sessions cannot authorize Steam linking, even if the account has
  Discord linked. Require a NEW Discord-authenticated session first.
- Legacy JWTs without registry claims never gain linking authority automatically.
- Failed/uncertain durable revocation is not successful logout.
- Suspended, badge-revoked or under-review accounts cannot link. Discord/Steam
  holds and revoked identities are not silently cleared by activation.
- Retain existing accounts, credentials, roles, NMD IDs, identity links, tournament
  records and rankings. Preserve legacy/admin/referee password authentication.

These lifetimes are proposed product defaults, not proof of security. Fresh Discord
OAuth proves a new provider round trip/account possession; it does not guarantee
Discord prompted for a password or MFA. That stronger assurance is not claimed.

## 3. Architecture, sessions and public projection

Auth.js remains responsible for JWT protection and cookie transport. A small
application registry establishes whether linking authority remains live.

After successful authentication, generate a 32-byte CSPRNG session secret; persist
only SHA-256(secret). JWT stores the raw secret in its protected server-readable
claims, a string-encoded generation, authentication method and absolute expiry.
Never accept those fields from Auth.js client update payloads. Public session JSON
must whitelist only current public user fields; exclude session secrets/digests,
generation, grants, OAuth codes, provider subjects, hashes and challenge proofs.
Use the server JWT decoding/session helper, not public session JSON, for authority.
Role and restriction decisions continue to come from backend records.

Mint the registry record in the same transaction as password acceptance or Discord
grant redemption, after locks and revalidation. Capture current generation there.
Only then may authorize return server-private claims to the Auth.js JWT callback.
Do not mint sessions on routine JWT refresh/session reads. Refresh must preserve
absolute expiry; JWT exp and cookie lifetime must never exceed registry expiry.
A missing/invalid/revoked record cannot be recreated from an old JWT.

If cookie creation fails after commit, the unused registry row remains until
retention cleanup. Without the secret it grants nothing. Do not retry automatically.
A new explicit sign-in mints a new session. If generation changes after registry
commit but before cookie delivery, the delivered JWT is stale and linking rejects.

Initial scope: registry validation is mandatory for protected linking and durable
revocation. It does NOT assert universal immediate revocation of every legacy app
request. Existing permission/competitive checks remain. Extending registry checks
to all protected endpoints is a separately reviewed behavior change.

### 3.1 Installed beta.32 behavior — integration evidence

Inspected next-auth/package.json identifies 5.0.0-beta.32. In the installed tree:

- @auth/core/jwt.js encode lines 49–60 calls setIssuedAt(), then sets expiration
  to its current time + maxAge. Supplying an exp or old iat in token does not
  preserve those values. Its decoder uses 15-second clock tolerance; protected
  authorization must not inherit that grace beyond the registry deadline.
- @auth/core/lib/actions/session.js lines 23–51 decodes, calls callbacks.jwt,
  computes now + session.maxAge, projects the session, re-encodes and chunks cookies
  with that rolling expiry. Lines 54–61 clear cookies if the JWT callback returns
  null or an exception occurs in this processing block.
- @auth/core/lib/utils/cookie.js SessionStore.chunk merges the configured options,
  preserves chunk names/values and produces deletions for superseded chunks.
- next-auth/lib/index.js getSession invokes the core session action for server
  reads; public route interception alone does not govern every auth() call.
- next-auth/lib/actions.js signIn/signOut apply returned cookies directly to the
  Next cookie jar. An outer HTTP-response wrapper cannot retroactively clamp those
  server-action cookies. Auth.js sign-out event errors remain non-authoritative.

Therefore session.maxAge=8 hours and a JWT callback retaining exp are insufficient.
Do not patch node_modules or copy/reimplement JWE crypto/chunking.

### 3.2 Absolute expiry integration contract

New sessions have immutable backend-created originalAuthenticatedAt and
absoluteExpiresAt claims, protocolVersion, registry reference, generation and
method. Times must be finite, correctly typed, originalAuthenticatedAt <= now and
absoluteExpiresAt = originalAuthenticatedAt + eight hours. Cross-check these with
the owning registry row when it is validated. JWT iat is an encoding timestamp,
NEVER the authentication deadline or legacy-cutover source after renewal. Client
session updates cannot supply/change these claims. Use exact integer generation
parsing; never silently truncate a bigint into an unsafe JavaScript number.

Future config.jwt.encode must be an application-owned bounded wrapper around the
installed public next-auth/jwt encode/decode exports, preserving their secret/key
rotation configuration, salt, encryption and supported decoding behavior:

1. Require trusted server-produced immutable claims. Compute a candidate remaining
   maxAge from absoluteExpiresAt, capped by the configured maxAge; do not pass a
   negative duration. Conservative rounding/safety margin may shorten validity.
2. Delegate actual encryption to the installed encoder with that remaining maxAge.
3. Decode/inspect the produced token with the same reviewed configuration. Require
   its exp <= floor(absoluteExpiresAt/1000), identity/binding claims unchanged and
   current time still before both exp and absoluteExpiresAt. The core encoder
   samples time internally after asynchronous work; relative maxAge alone is NOT
   a proof. Reject an overrun or unverifiable result with no retry/publication.
4. Keep iat/jti regeneration harmless: no calculation ever resets the captured
   originalAuthenticatedAt/absoluteExpiresAt or registry expiresAt.

The corresponding decode/authority wrapper delegates cryptographic verification,
then applies strict absolute/JWT expiry checks without adding the core decoder's
15-second tolerance to authority. A clock/claim ambiguity denies authorization.
Browser cookie storage/clock behavior is not an authorization guarantee; the JWT
and registry independently enforce expiry. Registry clock_timestamp governs
protected transaction acceptance as in section 6.4;
server time gates encoding/publication conservatively. Host clock synchronization
and boundary skew must be validated before activation; no grace extends DB expiry.

Cookie publication also requires an application-owned boundary, not just encode:

- Hold core authentication responses/cookie descriptors before publication. Verify
  the session token's approved claims and effective expiry before applying cookies.
  Clamp each live session chunk's Expires to effective expiry and remove positive
  Max-Age on live chunks: a relative Max-Age can outlive the bound after delivery
  delay and overrides Expires. Preserve immediate deletion attributes for old
  chunks. Preserve HttpOnly, Secure, SameSite,
  Path, Domain policy, cookie prefix, chunk values/order and deletion descriptors.
  Do not split combined Set-Cookie text on commas or rechunk/re-encrypt manually.
- A reviewed private adapter may use the exported @auth/core Auth/raw boundary
  (also used by the installed Next server actions) to obtain structured cookie
  descriptors. Apply cookies only AFTER validation/clamping. Preserve the existing
  CSRF/Origin requirements; raw is not permission to use skipCSRFCheck for browser
  requests. Public browser handlers must retain CSRF verification.
- Do not use the stock server signIn/signOut/update helpers where they apply cookies
  before this boundary can inspect them. Replace public exports with reviewed
  application wrappers; retain raw helpers/core dispatch only inside the private
  adapter. Audit every server action, handler and response path. Unsupported paths
  block issuance/activation rather than being assumed covered.
- Public GET/POST session operations for versioned sessions use the application
  read/projection service below, with NO rolling reissue or session Set-Cookie on
  ordinary reads. The custom encoder is still required for initial issuance and
  any separately reviewed future reissue. Benign update requests cannot mint a new
  session, change protected claims or extend expiry.
- Public session expires is ISO(min(registry expiresAt, immutable absoluteExpiresAt,
  verified JWT exp converted from epoch seconds to milliseconds)); expose a session
  only after registry validation. Never expose
  the rolling newExpires generated by stock session action for these sessions.
- Public auth() and server helpers use the same application validation/projection
  service, not stock getSession/core renewal for versioned protected operations.
  Cookie decoding must use the configured session cookie name/salt/chunk handling,
  NOT getToken's optional Authorization Bearer fallback for browser linking/logout.

This is bounded integration of session/cookie boundaries, not replacement of JWT
cryptography or Auth.js provider authentication. It requires dependency-specific
source mocks and later separately authorized transport validation. If structured
response interception cannot preserve all cookie semantics for the installed
version, STOP implementation of that portion and keep features blocked.

### 3.3 Registry failures and automatic cleanup — explicit outcome model

The public application session adapter classifies a request before core session
renewal/cleanup. It performs no durable revocation on a session read. JWT/session
callbacks contain no registry I/O; they must not turn a database outage into null
or an exception as a revocation strategy. Authority validation returns a typed
VALID / INVALID / EXPIRED / UNAVAILABLE result; only VALID permits protected use.

| Condition | Public/server result and cookie handling | Durable revocation meaning |
|---|---|---|
| Registry unavailable on session read | Fixed 503 SESSION_REGISTRY_UNAVAILABLE, no authenticated projection, no renewal or session-cookie mutation. Private server helper returns unavailable/typed failure; never a valid principal or silently signed-out success. | UNKNOWN; do not infer revoked, expired or absent. |
| Registry unavailable on requested renewal/reissue | Do not dispatch core encoding/cookie application. 503, preserve existing cookie, no automatic retry. Ordinary session reads do not renew at all. | UNKNOWN. |
| Registry confirms revoked/session generation stale | Deny protected use; may clear browser cookie with SESSION_INVALID_LOCAL_COOKIE_CLEARED. Do not extend or recreate a session. | Revoked only if the row confirms revocation; stale generation is separately observed invalidity. No new revocation was performed by the read. |
| Registry/JWT absolute deadline elapsed | Deny, return expired/signed-out projection; local cookie deletion allowed through the adapter. Do not dispatch a new login or renewal. | EXPIRED, not a successful database revocation. |
| Invalid/unverifiable JWT | Deny and optionally clear only local configured session cookie/chunks. Cannot identify an authoritative registry owner from unverified contents. | UNKNOWN for other copies; no revocation claim. |
| JWT callback returns null unexpectedly for a verified versioned input | Treat as failed internal session processing, not durable logout. Private adapter must withhold core's automatic clean-cookie response unless independent invalidity/expiry or confirmed revocation permits local cleanup. Return sanitized 503, no successful session or silent downgrade. | Not proof of revocation. |
| JWT callback/encoder/session hook throws | Same failure classification. Stock session action catches errors and may clean cookies; it must not be the public versioned session path. If raw core output occurs internally, reject/withhold its session-cookie mutations on this failure. | Not proof of revocation; preserve cookie where the application controls publication. |
| Browser/manual/automatic cookie loss already occurred | Report local state only. Do not create a replacement registry session from cached public user data. A genuine new sign-in is required if the cookie is gone. | Cookie removal alone revokes nothing in the database. |

A copied JWT after local cookie loss is treated exactly like any other presented
credential: protected linking requires its live owning DISCORD session, current
generation, strict expiry, browser-bound fresh challenge and eligible account.
If registry is unavailable, deny. If confirmed revoked/expired/stale, deny. If
otherwise still valid, cookie removal alone does NOT make the copy invalid; do not
claim otherwise. Credential theft is not solved by browser-local deletion.

A valid versioned JWT with a missing registry row is INVALID, never legacy. Malformed
claims fail closed. Local cleanup cannot be described as SIGNED_OUT with durable
revocation semantics. Retain distinct machine codes/UI messages for COOKIE_CLEARED,
SESSION_EXPIRED/INVALID, SESSION_REVOKED and REVOCATION_UNCONFIRMED/UNAVAILABLE.
Generic framework null session/error responses cannot substitute for those outcomes.

### 3.4 Legacy compatibility under expiry control

Legacy player/admin/referee credentials and account records remain. New successful
password sessions receive the same eight-hour immutable registry deadline but
method LEGACY_PASSWORD, so they cannot authorize Steam linking. Existing pre-cutover
JWTs may retain only the explicitly approved original validity/transition window;
never use renewed iat as evidence of original issuance. If old claims cannot safely
establish the window, require sign-in again without deleting accounts or roles.
Do not rewrite legacy JWTs into registry-backed authority. Any permitted legacy
reissue must use a separately captured immutable legacy deadline, not now+maxAge;
otherwise disable that reissue. Public projection continues to exclude secrets.
No change enables Steam SIGN_IN, LINK or default-disabled provisioning.

## 4. Durable logout boundary — application-controlled, before Auth.js

### 4.1 Authoritative service

Future logoutAndRevoke() must read/decode the cookie server-side, identify its
session/account, then lock User -> AuthSession. Validate ownership before writing.
If a registry row exists, set revokedAt once and write a sanitized audit in one
transaction. Already revoked/expired rows return an explicit terminal observation;
never reactivate them. Only a confirmed commit or confirmed already-revoked result
permits invoking the private, cookie-publication-controlled Auth.js integration
(section 3.2), not the stock server helper that mutates cookies before inspection.
A confirmed expired session follows explicit local-expiry cleanup semantics, not
a false claim that a database revocation write occurred.

Database read/write/commit error or ambiguous commit: return fixed 503
REVOCATION_UNCONFIRMED; do not dispatch Auth.js, clear cookies or redirect as success.
Preserve the session reference in the cookie for an owner-initiated status check.
No automatic retry. If the commit actually occurred, copied JWTs still fail registry
validation; if not, durable logout has NOT been established and UI must say so.

If revocation commits but cookie clearing fails, report an explicit partial result
SESSION_REVOKED_COOKIE_CLEAR_UNCONFIRMED, not generic SIGNED_OUT. Copied JWTs cannot
link; the remaining browser cookie is unusable for linking. Do not claim all other
application uses of that JWT have been revoked in this initial scope.

### 4.2 Entry point coverage

| Entry point | Proposed enforcement before cookie-clearing dispatch |
|---|---|
| POST /api/auth/logout | Existing Origin/rate validation -> logoutAndRevoke -> private Auth.js signOut only after confirmed revocation. |
| POST /api/auth/signout through catch-all | Intercept the exact framework action BEFORE handlers.POST. Route into the SAME revocation service. Reject ambiguous/encoded/unsupported action aliases; never forward them as an alternate sign-out. Preserve same-origin checks; do not invoke Auth.js merely to validate CSRF if it could clear cookies. |
| GET /api/auth/signout | May render an inert confirmation or route to the canonical confirmation UI; must not perform cookie-clearing sign-out. Review actual installed behavior; block action dispatch unless demonstrated inert. No mutation on GET. |
| Server-side signOut() | Replace public raw helper exports/callers with logoutAndRevoke. Private integration captures core results before cookie publication as in section 3.2. Static import/export checks prohibit bypasses. |
| events.signOut | Optional non-authoritative diagnostics only. Never the database revocation gate; errors are swallowed by installed core. No competing lock-taking revocation implementation here. |
| Server/userland direct Auth() dispatch | Prohibit imports/calls bypassing the reviewed adapter. Enumerate and statically test all call sites. No claim that module privacy contains malicious server code. |

The installed public Auth.js event API does not provide the required fail-closed
hook by itself. The minimal safe control is this application wrapper plus catch-all
interception, not a fork/patch of Auth.js. Exact integration must pass mock and later
separately authorized transport tests against the installed dependency before any
registry-enabled logout is described as operational. Unknown new sign-out paths
block activation rather than being assumed covered.

The cookie-preservation guarantee here concerns controlled explicit logout dispatch.
Automatic framework cleanup and malformed/expired-cookie removal are classified
separately in section 3.3 and never establish durable revocation. Database failure
before revocation => fixed 503 REVOCATION_UNCONFIRMED, no successful logout redirect
or clearing dispatch. Ambiguous commit has the same result and no retry. Confirmed
revocation followed by cookie-publication failure => explicit partial result.

### 4.3 Legacy/malformed cookies

A legacy unversioned JWT cannot authorize linking today or after migration. Its
logout may clear the local cookie ONLY with an explicit LEGACY_COOKIE_CLEARED result
that disclaims durable global revocation; it must not mint a registry record.
Malformed or missing-version session references produce an explicit local-cookie
result, never a successful durable-revocation claim. A correctly signed versioned
JWT whose registry is missing cannot be silently downgraded to legacy: report
SESSION_REGISTRY_MISSING, linking denied, no general-revocation assurance.
New JWTs require a server-signed protocol version. A legacy token must be genuinely
pre-cutover (signed issuance time no later than the approved cutover) and otherwise
valid; a post-cutover token missing required registry claims fails closed, not
legacy fallback. Preserve legacy access only through the separately approved
transition window; do not extend it through JWT refresh. Owner must approve this
legacy response contract and transition window before rollout.

## 5. Protected linking state machine

1. NEW_DISCORD_SESSION: verified Discord sign-in, grant redemption and registry
   creation. Password/legacy sessions must sign in through Discord first.
2. START_REAUTH: same-origin POST /api/identity/steam/start with the reviewed link
   intent. Validate live DISCORD-method session, current generation, permitted
   account and current unrevoked/unheld Discord identity. Create REAUTH_STEAM_LINK
   with provider DISCORD; no account provisioning or session replacement.
3. DISCORD_PROOF: existing Discord callback verifies state/browser and server-side
   provider response. Returned subject must exactly equal the captured AND current
   linked Discord subject. Revalidate all bindings under locks. Consume parent
   once and create exactly one LINK_STEAM child in the same transaction.
4. STEAM_PROOF: send child state to the fixed Steam verification endpoint. The
   existing Steam callback verifies signed OpenID fields, exact return URL and
   fresh provider nonce. It never establishes a login session.
5. ATTACH: lock and validate account, live originating DISCORD session, current
   generation, parent, child and current Discord/Steam identities. Conditionally
   consume child, reserve nonce, attach permitted Steam identity, apply eligible
   status transition and audit atomically. Commit -> LINKED; failure -> no partial
   attachment. No update to external identity owner/provider/subject is allowed.

State and browser secret are independent 32-byte CSPRNG values; store hashes.
Use a separate HttpOnly SameSite=Lax linking cookie, Secure on HTTPS, path
/api/identity, max-age <= ten minutes for the whole flow. One active flow per browser
is sufficient: a new start may replace the cookie, causing older flows to fail
browser binding. No browser persistent storage. No return URL is client-selected.
All responses/redirects use no-store/referrer protection. Never expose a grant or
session reference in redirect query strings. Fixed reviewed callback destinations.

The child record itself is the short-lived linking authorization. No extra proof
service/table/token minting layer is necessary. On callbacks require the same
session, not merely another session belonging to the same user. Missing legacy
bindings reject. Existing raw LINK challenges stay blocked forever; future explicit
purposes must not reinterpret an old LINK or SIGN_IN as reauthentication.

Only empty Steam slots or the same Steam subject with explicitly permitted fresh
reverification are eligible. A Steam identity owned by another account, changed
Discord identity, hold, unknown revocation provenance or restricted account stops
without merge/transfer. A SELF/ADMIN_CLEARED reverification remains an explicit
fresh-proof operation, not automatic hold/revocation clearing.

## 6. Exact schema constraint proposal (public schema only)

Names below are proposed contract names. No DDL is provided/executed by this sprint.
Timestamps are timestamptz; hashes are lowercase 64-character hex text.

### 6.1 User and AuthSession

- User.authGeneration bigint NOT NULL DEFAULT 0, CHECK >= 0. Database immutability
  enforcement permits only unchanged or strictly increasing generation; no decrement
  or wraparound. Application advancement increments once under User lock.
- AuthSession: idHash PK, userId NOT NULL, authGeneration bigint NOT NULL CHECK >=0,
  method NOT NULL enum {DISCORD, LEGACY_PASSWORD}, createdAt/authenticatedAt/expiresAt
  NOT NULL, revokedAt nullable.
- CHECK: hash syntax; createdAt = authenticatedAt; expiresAt = authenticatedAt +
  interval '8 hours'; revokedAt IS NULL OR revokedAt >= authenticatedAt.
  Revocation after natural expiry is allowed. No CHECK against changing NOW().
- FK userId -> User.id ON DELETE RESTRICT. UNIQUE(idHash,userId,authGeneration).
  Do NOT FK session generation to User's CURRENT generation: old rows must remain
  after User generation advances.
- Immutability trigger: prohibit changing idHash, owner, generation, method and
  creation/authentication/expiry times. revokedAt may change NULL -> timestamp once,
  never back or to a different value. Repeat logout must be a read/no-op.
- Indexes (userId,revokedAt), expiresAt. These are not quota/retention enforcement.

### 6.2 IdentityChallenge extensions

Add createdAt for new challenges; nullable sessionIdHash/authGeneration,
discordIdentityId/discordSubjectHash, parentChallengeHash/parentPurpose. Historical
rows may lack new fields; only the exact historical purpose allowance accepts
those shapes. New purposes require NOT NULL fields through purpose-dependent CHECK.
Keep tokenHash PK, existing provider/intent/userId/browserHash/expiresAt/consumedAt.

- CHECK for REAUTH_STEAM_LINK: provider DISCORD; account/session/generation/Discord
  bindings and createdAt present; parent fields NULL; reauthenticatedAt NULL;
  expiresAt > createdAt AND expiresAt <= createdAt + five minutes.
- CHECK for LINK_STEAM: provider STEAM; all bindings and parent fields present;
  parentPurpose = REAUTH_STEAM_LINK; reauthenticatedAt present;
  createdAt >= reauthenticatedAt; expiresAt > createdAt;
  expiresAt <= reauthenticatedAt + five minutes.
- CHECK intent is one of SIGN_IN, legacy LINK, REAUTH_STEAM_LINK or LINK_STEAM;
  reject unknown purposes. SIGN_IN/legacy LINK rows never authorize protected linking.
- For new purposes CHECK generation >=0 and valid hash formats. consumedAt must be
  NULL OR between createdAt and expiresAt (strictly before expiresAt).
- Composite FK (sessionIdHash,userId,authGeneration) ->
  AuthSession(idHash,userId,authGeneration), DELETE RESTRICT. Required non-null
  new-purpose fields prevent MATCH SIMPLE null bypass.
- Add UNIQUE(id,userId) on ExternalIdentity; FK(discordIdentityId,userId) ->
  ExternalIdentity(id,userId), DELETE RESTRICT. Subject equality/hash and provider
  DISCORD are additionally checked transactionally against current identity.
- Add UNIQUE(tokenHash,intent,userId,sessionIdHash,authGeneration,discordIdentityId,
  discordSubjectHash) to support the parent relation.
- Composite parent FK (parentChallengeHash,parentPurpose,userId,sessionIdHash,
  authGeneration,discordIdentityId,discordSubjectHash) references that unique tuple
  on IdentityChallenge, DELETE RESTRICT. This enforces parent purpose and shared
  account/session/generation/Discord binding. Parent fields NULL only for the root.
- UNIQUE(parentChallengeHash): at most one child per parent, multiple NULL roots.
- Indexes (sessionIdHash,consumedAt), userId; retain expiresAt index.
- Immutability trigger: token/browser hash, purpose/provider, owner/session,
  generation, Discord binding, parent, createdAt, reauthenticatedAt and expiresAt
  never change. consumedAt only NULL -> valid timestamp once. On reauthentication,
  consume parent and set child.reauthenticatedAt = parent.consumedAt; do not update
  parent.reauthenticatedAt. No old challenge can be upgraded into new authority.

### 6.3 Login grant and identity invariants

- Add nullable authGeneration and createdAt to existing IdentityLoginGrant. Newly
  issued versioned grants require nonnegative generation and expiry <= creation +
  60 seconds. Legacy grants do not mint versioned sessions; require new sign-in.
- Enforce grant owner/provider/browser/generation/expiry immutability and one-way
  consumedAt. Existing FK User and tokenHash PK remain. New grants are DISCORD only.
- Retain ExternalIdentity UNIQUE(provider,providerAccountId) and
  UNIQUE(userId,provider). Immutability enforcement prevents changes to id/userId/
  provider/providerAccountId after creation. Updates to verification/revocation
  metadata remain controlled by existing authority rules. No cascading identity
  deletion or hidden reassignment.

### 6.4 Facts requiring locked transactional validation

CHECK/UNIQUE/FK cannot prove live account eligibility, current generation, unrevoked
session, current Discord provider/subject/hold state, fresh provider proof or a
successfully consumed parent. Check these after locks. Validate parent.consumedAt
is present and equals child.reauthenticatedAt; session expiry bounds each challenge;
require method DISCORD; capture a fresh DB clock_timestamp after lock acquisition.
Do not claim a CHECK constraint alone can enforce those cross-row facts.

Authorization linearizes at the successful conditional consumption inside the
locked transaction, after provider proof. Require strict expiry > DB time there.
Locks protecting generation/session/identity remain held through commit. Audit
failure rolls back. Expiry need not retroactively undo a consumption valid at that
instant if commit later completes; the UI must not claim request-arrival ordering.
Session issuance similarly uses the transaction's validated generation; later
rotation makes the new session stale instead of retroactively cancelling its row.

## 7. Complete lock protocol and operation table

Global order for operations in this domain:

D: Discord-subject advisory lock (only for sign-in resolution/provisioning);
N: NMD allocator row (only new account);
U: User rows, multiple existing actors/targets sorted by stable User ID;
S: AuthSession rows sorted by idHash;
C: parent challenge then child, or sign-in challenge then login grant;
I: existing ExternalIdentity rows sorted by (userId,provider,id);
W: protected mutations/provider-nonce reservation;
A: audit append last.

Skip unused categories, never acquire an earlier category after a later one.
A preliminary nonlocking read may discover IDs but grants no authority: reread
under locks. A newly created User is private to its transaction and inserted after
N; it does not require acquiring another account's U lock. Do not acquire D or N
from a User-locked path. No provider HTTP request inside these transactions.

| Operation | Lock sequence and validation/mutation boundary |
|---|---|
| Discord sign-in callback, existing account | Verify provider outside tx; D -> U -> C(sign-in challenge) -> I; recheck challenge/browser, identity/restrictions; consume; issue generation-bound grant; A. No session minted here. |
| Account provisioning | Verify provider outside tx; D -> N -> insert new U -> C(sign-in challenge) -> create profile/I -> grant -> A. Recheck absent identity under D; collisions with other writers abort whole tx. Feature/schema guards precede N. No merge/retry. |
| Login-grant redemption | Preliminary lookup -> U -> C(grant) -> I; recheck browser, expiry, single use, generation, Discord status; consume and insert NEW S -> A. New S has no preexisting lock; never reuse/mutate an old S here. |
| Legacy password login | Initial bounded bcrypt outside tx -> U; reread same hash/status; insert NEW S(method LEGACY_PASSWORD,current generation) -> A; preserve role. Cannot authorize linking. |
| Session creation | Only inside one of the two preceding authentication transactions after validation. Record before returning private JWT claims. No independent public session-mint endpoint. |
| Discord reauth start | U -> S -> I; require live DISCORD session/current generation/current Discord; insert NEW C(root) -> A. New C needs no existing-row lock. |
| Discord reauth callback | Provider outside tx -> U -> S -> C(root) -> I; validate same Discord/session/browser/generation; consume root; insert NEW C(child) -> A. |
| Steam attachment | Provider outside tx -> U -> S -> C(parent then child) -> I -> W(nonce,attachment,eligible status) -> A. Final conditional use and all writes atomic. |
| Logout | U -> S -> A; revoke once. No challenge locks/bulk invalidation needed. Invoke Auth.js only AFTER confirmed commit. |
| Credential rotation | U -> W(password update + generation increment) -> A. No S/C bulk updates: generation invalidates authority. Future issuance must take U. |
| Account recovery | Privileged actor/target U sorted -> W(reviewed recovery + generation increment) -> A. Preserve identities unless a separate explicit recovery policy authorizes changes. No auto-merge. |
| Identity security revocation / restriction / hold entry or release | Actor/target U sorted -> I if needed -> W(reviewed state transition + target generation increment) -> A. No S/C bulk update. Releasing a hold never revives old authority. |
| Session/challenge cleanup | Dedicated retention service, not login/logout request: choose one target account, U -> S sorted -> C(parent then child) -> A; delete eligible retained child before parent, grants before referenced session. Respect every FK; skip if lock cannot be obtained. Never acquire D/N. No protected operation may depend on deletion for expiry. |

New-row insertion exceptions do not permit locking an existing row out of order:
a uniqueness conflict aborts, never an upsert that takes an unplanned lock. Cleanup
cannot delete audit/security records outside the approved retention policy.

Required future changes to existing source:

- Callback currently consumes C before D/U: move consumption after D/U, retaining
  conditional single-use and expiry checks; do not trust the initial read.
- consumeLoginGrant currently updates C before U: move U first, then lock/recheck C.
- Password login already U-locks; add registry creation without moving bcrypt under
  the lock. Source schema guard remains mandatory before relevant raw SQL.
- Identity admin routes currently often lock actor U before target U; refactor to
  discover both, acquire sorted U, then revalidate permission/review/target facts.
  Existing incident locks introduce an outer order: adjudication paths take Incident
  first, then sorted U, then I. Auth/linking paths must never acquire Incident after
  U; review all incident writer paths before claiming the combined order complete.
- Role/status permissions must be reread after sorted locking, not established by
  the discovery read. Revocation/recovery writers must adopt generation advancement.
- Current callback LINK branches remain blocked; new explicit purposes require
  separate reviewed implementation, not removal of the old unconditional guard.

Proposed transaction-local limits: lock_timeout 1 second, statement_timeout 3
seconds, interactive transaction timeout 5 seconds, maxWait 2 seconds. Fixed reviewed
SET LOCAL controls only, no connection-global SET. Fail closed on lock timeout,
deadlock, serialization error, uniqueness error or uncertain commit. No automatic
retry. Cleanup uses NOWAIT/SKIP LOCKED where independently reviewed, bounded batches
<=100 rows per account, <=5 seconds; skipped work is not claimed deleted. These are
proposed bounds requiring deployment validation, not demonstrated guarantees.

## 8. Race, revocation and recovery semantics

- Logout/generation change commits first: callback rechecks under U/S and rejects.
- Attachment acquires/commits first: it was authorized; later revocation invalidates
  future authority, not historical attachment. No promise of arrival-order priority.
- Duplicate callbacks: conditional consumption and unique child/nonce constraints
  permit at most one committed success. Other outcomes stop, no automatic retries.
- Simultaneous different-account Steam claims: unique identity constraint is the
  backstop. Loser rolls back profile/status/audit mutations together.
- Password rotation/recovery atomically advances generation. Login grants capture
  issuance generation; old grants cannot mint a session in the new generation.
- Security-related Discord or Steam revocation, restriction and hold transitions
  advance target generation under U. Release also advances generation and retains
  fresh-proof requirements; never lower generation to restore an old session.
- Expiry is enforced from DB time and registry state, not cleanup timing. No reuse
  of expired/revoked session IDs. Browser logout does not delete registry evidence.
- Audit is in the same transaction as successful protected changes. Do not log
  passwords, raw session IDs, state/browser secrets, codes or provider tokens.
  Failed transactions produce no success audit. Retain minimal sanitized operational
  error identifiers separately, without falsely claiming committed DB history.
- Ambiguous commit: fixed UNKNOWN/UNCONFIRMED result; preserve evidence and status
  references server-side. A separately initiated read can determine current state.
  Do not infer rollback from a lost response or replay the mutation automatically.

## 9. Migration, compatibility and rollback

1. Independently approve this design and decide open integration/retention items.
2. Separately authorize schema/client preparation: additive fields/tables/indexes/
   constraints and immutable-binding enforcement. No changes to existing Phase 4
   migrations, pins or guards. Nullable password/email proposal stays separate.
3. Separately review/apply on an approved isolated target. Backfill only generation
   default 0, not sessions or linking authority. Historical challenges/grants stay
   inert for versioned linking/session creation. Validate preserved data/references.
4. Deploy issuance/registry validation/durable logout only. Linking unconditional
   blocker and default-disabled new Discord provisioning MUST remain. Preserve old
   password/admin access; legacy JWTs require new Discord sign-in before linking.
5. Prove ALL revocation/logout/rotation/restriction paths adopt the lock and generation
   protocol. Dependency-specific mock tests first, then separately approved isolated
   PostgreSQL and transport/provider validation. Missing path blocks activation.
6. Implement future explicit reauth/Steam child purposes separately; independent
   security review and owner approval required before activation.

Rollback disables new feature exposure/issuance as reviewed but retains registry,
generation and additive schema. Do not downgrade a versioned JWT to legacy, delete
identity/session history, restore generations or return to a logout path that
silently ignores revocation. A previous binary lacking these guards is NOT a safe
automatic rollback. Restoring NOT NULL after passwordless users exist is also not
an automatic rollback. Preserve admin recovery access through a reviewed route.

## 10. Retention and bounded cleanup

No cleanup is implemented or authorized. Expiry/revocation correctness does not
depend on cleanup. Proposed policy for owner/legal review: retain expired/revoked
session and challenge metadata 30 days after terminal expiry/revocation, then purge
only unreferenced terminal records in bounded jobs; keep audit independently for
an approved security retention period, never cascading from session deletion.
Raw browser secrets/session IDs are never persisted. Do not retain provider tokens.
No job may delete active records or purge parents while children remain. Rollout
may retain everything until retention approval; that is not approval for unbounded
storage in production. Approve capacity monitoring/storage limits before rollout.

## 11. Acceptance tests and approval gates

Offline tests (fake DB/provider/cookie/clock boundaries; no services):

- Every logout path: custom endpoint, direct Auth.js POST, GET confirmation, server
  helper and malformed action aliases. Revocation fail/unknown => no successful
  cookie-clearing dispatch. Prove events.signOut failure alone is insufficient.
- Already-revoked, expired, legacy, malformed and missing-registry JWT results;
  copied versioned JWT fails protected linking after confirmed revocation.
- Generation rotation racing issuance: stale registry/JWT rejected, no claim of
  revoking a historical commit. Null password never enables legacy credentials.
- Wrong account/session/generation, client-supplied JWT-update fields and public
  session projection; eight-hour absolute expiry survives repeated JWT renewal.
- Encoder uses the installed crypto with unchanged secret/salt/key-rotation inputs;
  default encoder overwriting exp/iat is explicitly exercised. Delegate time advances
  during encoding -> overrun rejected without cookie publication or retry.
- Renewal/read loops immediately before/at/after eight hours never extend registry,
  JWT authority or cookie expiry. Enforce strict deadline despite decoder tolerance.
  Public expires equals the effective minimum; client updates cannot alter it.
- Registry outage during GET/POST session read, requested reissue and private server
  reads -> 503/unavailable, no successful principal, no renewal or cookie mutation.
  JWT null/throw paths and installed automatic cleanup cannot masquerade as logout.
- Invalid/expired/missing-registry cases, copied JWT after local deletion, confirmed
  revocation and ambiguous commit produce distinct outcomes. Callback exceptions,
  event hooks and local deletion are never asserted to revoke a session.
- Structured session cookies: chunked/unchunked transitions, stale chunk deletions,
  Expires plus Max-Age precedence, HttpOnly/Secure/SameSite/Path/prefix preservation,
  internal server-action issuance and every external response application point.
- Legacy renewed iat cannot reset cutover/deadline; post-cutover malformed tokens
  never downgrade to legacy. No server-side public projection includes private claims.
- Wrong-purpose parent, wrong owner, binding mutation, missing legacy fields,
  duplicate child, parent-consumption mismatch, mismatched Discord subject and
  claimed Steam owner. Simulate every constraint and transactional rejection.
- Replayed/expired root/child/grant, expiry during lock waits and provider denial;
  preserve browser binding and Steam nonce uniqueness, with no retries.
- Restrictions/holds before/after proof and release do not restore old authority.
- Callback, profile, identity, session and audit failure -> simulated rollback;
  post-commit cookie failure -> orphan registry evidence but no fake success.
- Assert operation lock order, bounded timeout errors and no reverse acquisition;
  logs contain no secrets. Tests model ordering, not real PostgreSQL semantics.

Later, separately authorized isolated PostgreSQL tests must establish actual FK/
CHECK/unique/immutability enforcement, rollback, row/advisory locks, simultaneous
claims/callbacks, allocator contention, rotation/issuance and logout/attachment in
BOTH orders, bounded deadlock/timeout failure, cleanup versus callback and schema/
Prisma consistency. No real production/provider credentials or old target cleanup.

Later separately authorized transport/provider tests must establish installed
Auth.js sign-out interception, cookie chunking/clearing and failure behavior, JWT
renewal/absolute expiry, server-only claim handling, callback routing/browser
binding and provider proof. Passing mocks never authorizes these operations.

## 12. Review finding resolution and next boundary

| Review finding | Design resolution |
|---|---|
| HIGH durable logout boundary | Section 4: authoritative pre-dispatch service; intercept all entry points; private raw helper; no reliance on swallowed event errors. |
| MEDIUM incomplete lock order | Section 7: complete operation table, advisory/allocator/actor-target order, current violations, timeouts and incident-domain integration gate. |
| MEDIUM schema invariants | Section 6: CHECK/unique/composite FK/immutability split and explicitly transactional cross-row facts. |
| LOW fragmented specification | This versioned document is authoritative; prior outline/report are historical context only. |
| MEDIUM absolute expiry integration (2B-G) | Sections 3.1–3.2/3.4: installed behavior, bounded delegate encoder with post-verification, controlled cookie publication and no rolling versioned session reads. |
| MEDIUM registry outage/automatic cleanup (2B-G) | Sections 3.3/4: typed outage outcomes, no callback-I/O revocation, withheld unexpected cookie cleanup and separation of local loss/expiry/revocation/unknown. |

Remaining decisions/blockers: owner approval of proposed lifetimes/legacy response
semantics/retention; exact installed Auth.js dispatch integration demonstrated before
activation; full incident-domain lock-order audit; isolated schema/Prisma validation;
reviewed password/recovery writer interfaces (none found as player endpoints today);
reviewed encoder/cookie/session adapter against beta.32 including all server-side
entry points, strict time/clock behavior and legacy immutable deadline policy.
Do not infer those decisions from this proposed document.

Smallest next implementation sprint: session issuance, registry validation and
pre-dispatch durable revocation, with offline mock tests ONLY. Do not implement
Steam linking, activate new-account provisioning, change frontend/proxy/ingress,
apply migrations, connect providers or execute transport tests in that sprint.
Schema/client source preparation needs its own explicit approval; unsupported
schema must fail closed. Independent review precedes any runtime authorization.
