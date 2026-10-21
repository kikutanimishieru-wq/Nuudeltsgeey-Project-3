# Revocable linking authorization — DESIGN PROPOSAL ONLY

Not a migration, not an implemented session registry, not authorized to activate.
The current Auth.js JWT model has no durable session identity or revocation
registry. User ID + recent timestamp + browser cookie cannot prove that the
initiating authentication is still valid after logout or credential rotation.
No in-memory counter or client-provided generation is an acceptable substitute.

Until independently reviewed persistent support exists, LINK challenge issuance
and all LINK callbacks (including previously issued challenges) return the fixed
503 LINK_AUTHORIZATION_GENERATION_REQUIRED. This applies to Discord and Steam,
legacy and passwordless accounts. No environment flag bypasses it. Discord SIGN_IN,
legacy/admin password login and sign-out are preserved. Existing identity rows
are not changed. Internal attachment helpers remain transaction primitives and
must not be exposed through a new route that bypasses this gate.

## Proposed persistent contract

- User.authGeneration: nonnegative monotonically advancing backend integer.
- AuthSession: opaque random session ID (store a digest), owning User, generation
  at authentication, authenticatedAt, expiry and revokedAt.
- LINK challenge: exact owning account, initiating session digest, captured
  generation, provider, browser hash, fresh reauthentication time, expiry and
  one-time consumption state. Legacy challenges without these fields fail closed.
- JWT contains only server-signed references to session/generation; receiving
  those claims alone is not proof. Re-read the persistent registry when authorizing
  protected linking. Do not expose a proof issuer accepting arbitrary session IDs.

Password changes/recovery must lock the User, advance authGeneration and invalidate
old sessions/challenges atomically. Per-session logout/revocation must revoke the
session record durably before reporting successful revocation; account-wide
revocation advances generation. All paths that change credentials or revoke
sessions must adopt this protocol; a partially adopted protocol must not enable
linking. Review Auth.js sign-out endpoints as well as the custom logout route.

At issuance and callback: lock the User in consistent order, require matching
account AND live initiating session AND current generation AND fresh backend
reauthentication, browser binding and challenge expiry. Callback must repeat this
inside the attachment transaction before conditional challenge consumption and
identity writes. Failed generation/session validation must never attach/reverify
or activate competitive status. Fresh Discord reauthentication for passwordless
Steam linking must identify the same already-linked Discord account, not replace
it. State, browser secret, grant and audit protections remain mandatory.

No destructive backfill. Existing accounts/identities/NMD IDs/history stay intact.
Decide whether legacy sessions must sign in again for the new protected action;
never invent a registry entry from an unversioned legacy JWT. Admin login remains
available but old sessions do not gain linking authority automatically.

## Required approval and tests

Independent schema/session design review; separately approved schema/client source
preparation and migration; adoption by every credential/revocation/logout path;
mock tests for rotated generation, revoked/expired session, same-user different
session, stale challenge, replay and concurrent revocation; then separately approved
isolated database transaction testing and provider/session integration testing.
Do not apply schema changes, regenerate Prisma, activate provisioning or enable
linking merely because mocks pass. Keep existing Phase 4 migration files/pins intact.
