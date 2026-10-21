# Sprint 2C — persistent session source core (runtime BLOCKED)

Specification: proposals/SPRINT2B_SESSION_LINKING_V1.md version 1.1.
No database, migration, provider, server or real authentication was used in this
sprint. No feature flag/configuration was enabled. No frontend, ingress/proxy,
transport harness or Phase 4 file is changed.

## Source inventory

- lib/persistent-session.ts: transactional store contract; CSPRNG session secret,
  hash-only row storage, generation/credential/grant binding, eight-hour absolute
  deadline, strict claims, ownership/method/restriction validation, revocation and
  public allowlisted projection. Revocation is allowed after account restriction
  or generation advancement so old sessions can still be invalidated.
- lib/session-codec.ts: delegate encoder/decoder interface preserving Auth.js
  encryption, verified absolute exp, strict decoding deadlines (no added tolerance),
  cookie option/deletion preservation and removal of positive Max-Age.
- lib/session-publication.ts: holds synthetic/raw response descriptors, verifies
  issued claims and cookie chunks, bounds expiry before a single publication
  attempt. Writer failure is SESSION_ISSUED_COOKIE_UNCONFIRMED, never fake rollback.
- lib/session-boundary.ts: GET/POST read projection without renewal; registry outage
  503 with no cookie changes; confirmed revocation BEFORE private cookie-clear
  preparation; ambiguous commit and cookie failure are separate outcomes.
- lib/session-auth-adapter.ts: installed next-auth/jwt crypto delegation and
  cookie-only decoding (no Authorization Bearer fallback), server request capture,
  fail-closed runtime boundary. Private live cookie writer is intentionally absent.
- lib/session-runtime.ts: hard-disabled source gate, unavailable production store
  and transaction adapter. No env/configuration value activates it.
- auth.ts: password source issuance hook under existing row lock, private engine,
  guarded public auth/signOut/handlers, versioned session interception and encoder
  rejection while disabled. Client updates do not overwrite private authority.
- lib/identity.ts: future gated Discord redemption branch uses User-before-grant
  adapter ordering; missing browser proof rejected. Existing legacy branch remains
  active until the registry/client rollout is reviewed.
- types/next-auth.d.ts: server-private claim typing, not public session fields.
- app/api/auth/logout/route.ts: returns wrapped explicit legacy/local status, not
  an unsupported claim of durable database logout.

## Implemented source versus missing runtime assembly

The interfaces/algorithms are implemented and exercised with mocks. There is NO
real Prisma AuthSession model/client or SessionTransaction implementation. See
proposals/SPRINT2C_SESSION_CORE_SCHEMA.md. Do not cast the old client to invented
models, emulate persistence in memory or run SQL to bypass that boundary.

Versioned sessions encountered today fail closed because the runtime store is
unavailable. New versioned issuance is rejected by the hard gate and encoder.
Real session-cookie publication is not wired: runtime clearing/publishing refuses
with SESSION_COOKIE_ADAPTER_REQUIRED. `publishIssuedSession` is a reviewed-source
building block, not a live transport adapter.

The existing server signIn helper and legacy Auth.js reads remain in use ONLY for
the pre-registry compatibility path. Replacing those with held Auth/raw response
assembly, configuring strict decoding/expiry on ALL cookie application points,
setting the approved legacy cutover and integrating grant generation capture are
still required BEFORE enabling persistent issuance. No claim is made that the
current legacy cookies now have eight-hour absolute expiry. No current cookies
are rewritten by this sprint.

This explicit assembly boundary prevents presenting partial expiry/cookie wiring
as real security. Installed beta.32 public exports are used for cryptographic
operations; modules are imported but no encryption/provider/login runtime was run
by tests. Encoding tests inject fake crypto; they perform no real Auth.js sign-in.

## Durable logout behavior

Current legacy sessions: custom logout, direct Auth.js POST signout and server
signOut use the public wrapper. It reports LEGACY_COOKIE_CLEARED (or invalid/no-cookie
status), not confirmed DB revocation. Raw signOut/engine/handlers are not exported.
GET signout is 405; ambiguous auth action encodings are rejected. Existing custom
and framework POST route Origin/rate protections remain; interception also checks
Origin. Application code remains trusted: module privacy is not a server sandbox.

Versioned sessions: validation requires a persistent record. Revocation failure or
ambiguous commit returns fixed 503, does not invoke the raw clearing helper, does
not publish cookies, and never retries. No versioned token downgrades to legacy.
A private cookie failure after confirmed revocation is partial/unconfirmed cookie
cleanup, not a successful ordinary logout. Revoked/copied JWT cannot pass registry
validation; cookie removal alone does not revoke a registry session.

A partial cookie publication cannot be made atomic by this source. Preserve the
committed registry row and report uncertainty; no automatic reissue/rollback.
Unversioned session transition/cutover policy remains unapplied. Existing old
password/admin/referee login and identity records are preserved; Steam sign-in and
all LINK/reverification remain blocked. Provisioning stays at its existing default
(disabled unless separately activated); no provisioning environment was changed.

## Offline verification

Three added tests: persistent-session.test.ts, session-entrypoints.test.ts,
session-publication.test.ts. They use fake persistence/crypto/cookie/framework
boundaries, no listeners, child workloads, HTTP, real backend or database setup.
They cover issuance/rotation, User-before-Session/grant order, expiry/renewal overrun,
revocation/ambiguous commit, custom/direct/server logout, registry outages on GET/
POST, public projection, malformed/legacy tokens, cookie attributes/chunks and
post-issuance writer failure. Existing explicit auth/identity suites are regressions.

Mocks do NOT prove PostgreSQL serialization, rollback, uniqueness, stored timestamps,
parallel grant redemption, native lock timeouts, real encryption or browser cookie
transport. Those need separately authorized isolated integration testing.

## Next review and approvals

Independent source review must assess all new modules, public export/route coverage,
missing assembly boundary, strict data schemas and compatibility changes. Then
separately approve schema/client SOURCE preparation and the concrete Prisma/raw
cookie adapters. No migration execution, provider integration, frontend work,
linking activation or new Discord provisioning is authorized by Sprint 2C.
Keep incident-domain ordering and complete revocation-writer adoption as explicit
prerequisites. The current deliverable is source-core review readiness, not an
operational session system or permission to activate it.

## Sprint 2C-F — four targeted source corrections

Runtime remains hard-disabled. No schema, production adapter, live cookie writer,
provider, frontend or linking activation is added.

1. `publishIssuedSession` now requires `expectedClaims` from the committed issuance
   transaction. It compares every private claim (owner, raw session identifier,
   generation, method, authentication time and absolute deadline) before publishing.
   This is a trusted server-only input, not proof that a caller committed a transaction.
2. Publication additionally requires the complete trusted incoming session-cookie
   name/value snapshot (`existingSessionCookies`, empty only when genuinely absent).
   Ordered response descriptors are applied to that snapshot; stale input, mixed
   representations, chunk gaps and noncanonical indices are rejected. Every final
   session cookie must be written by this response. Auth.js still decrypts the final
   representation; no token concatenation or replacement encryption is introduced.
   Deletion-before-replacement and both chunk transitions are supported. Deletions
   must use the supported host-only `/` scope. Live descriptors must have future
   expiry, and existing security-attribute checks and absolute expiry bounds remain.
   The original ordered descriptors, including stale-cookie deletions, are published.
3. The source transaction contract now exposes `lockDiscordGrant`. After User then
   grant locking, core samples fresh database time and validates the locked grant's
   ownership, browser/provider/generation, unconsumed state and strict expiry.
   `claimDiscordGrant` conditionally consumes that already locked grant using this
   timestamp, within the same transaction. No production adapter is implemented;
   a future adapter must hold the lock through consumption/commit and implement
   `now()` using a fresh DB clock, not a transaction-start timestamp.
4. Direct Auth.js sign-out preserves the fixed partial-cleanup codes instead of
   collapsing them into unknown revocation. Custom/direct/server entry tests
   distinguish confirmed revocation, unconfirmed revocation, and confirmed
   revocation with unconfirmed cookie cleanup. Partial cleanup remains non-success;
   raw cookie clearing is not invoked on failure, and unknown exceptions stay sanitized.

Focused tests use fake stores, clocks, decoding, cookie writers and Auth.js entry
points. They do not demonstrate PostgreSQL locks/rollback or real encrypted-cookie
transport. Incoming snapshot completeness, committed issuance provenance and actual
cookie publication remain requirements for the separately reviewed runtime adapter.

2C-F verification: 87 tests passed across the three focused session test files;
TypeScript passed with `tsc --noEmit --incremental false`. Whitespace checks passed.
No database, provider, server, migration or real cookie-publication test was run.
