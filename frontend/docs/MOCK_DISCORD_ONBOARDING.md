# Discord-only onboarding — frontend demonstration

This sprint adds UI only. It neither creates an account nor establishes an Auth.js
session. No OAuth, identity provider, API proxy, ingress or backend contract has
been changed. Admin authentication and existing accounts remain untouched.

## Routes and review flow

- `/login`: choose **Discord-оор үргэлжлүүлэх**, then explicitly choose the mock
  success, failure or cancellation outcome. Success navigates to `/account`.
- `/account`: MongolWarrior, mock NMD ID, Discord/Steam status and eligibility.
  Choose **Steam холбох (демо)** to display both identities as verified.
- `/account/identity`: inspect each provider and the restriction override.
- Top navigation and sidebar link to login when signed out and account when in a
  mock account state. **Демо гарах** resets only the in-memory demo state.
- Expand **Демо төлөв сонгох** to inspect all six states, including an account
  with both identities connected but restricted. Reset starts from signed out.

Review these routes only in a separately approved frontend preview. This sprint
starts no server. Do not start the backend or enable ingress/transport tools to
review this demonstration. Existing tournament/leaderboard pages still have their
pre-existing public API reads; those reads are not part of mock onboarding and
may show unavailable states without a backend. Discovery links do not submit
registration, hosting or joining requests.

## State and authority

`MockAuthProvider` lives at the application root so client-side navigation keeps
one demo state. It uses a pure reducer and React memory only: no cookies, browser
storage, session APIs or tokens. Refresh/new-tab navigation resets the state.
Progress is intentionally manual rather than a simulated external callback.

Signed out, progress and failure permit browsing only. Discord-only permits
browsing and displays missing Steam verification. Verified permits host/join
*display status only*. Restricted denies host/join display regardless of both
identity connections. No host/join mutation controls are enabled. Preview state
selection is intentionally available to anyone and grants no backend authority.

## Visual scope

Existing layouts, homepage and tournament cards are preserved. The checked-in
legacy stylesheet uses blue/gold and Arial. New onboarding routes scope a dark
green/lime palette without globally changing those legacy pages. Discord uses its
blurple button and inline icon. DM Sans / Barlow Condensed are specified in font
stacks; no local font assets are provided, so installed fonts or fallbacks apply.
No remote font request, dependency or font download is introduced. The existing
nine-rank data is unchanged; the demo does not assign a fabricated ranking.

## Safe offline verification

From the repository root, using existing dependencies:

```
node --test frontend/tests/mock-onboarding.test.cjs
./frontend/node_modules/.bin/tsc --project frontend/tsconfig.json --noEmit --incremental false
```

Tests transpile local modules in an allowlisted VM loader, render React to static
markup, check reducer transitions and invoke captured demo button callbacks.
Next Link/router are mocks; there are no listeners, backend imports, HTTP calls,
providers or database operations. This is not a browser layout or end-to-end test.

## Sprint 2 prerequisites — separate approval required

Review passwordless schema/account provisioning, stable Discord-ID uniqueness and
concurrent sign-in handling, legacy/admin migration, fresh Discord reauthentication
for Steam linking, restricted/revoked identity behavior and account-status policy.
Then implement reviewed backend contracts and same-origin cookie/callback handling.
The current backend does not auto-create accounts from Discord; this UI must not
be wired directly to it as if it did. Backend authorization remains authoritative.
Mock state must never become an authorization input. Real integration and browser
end-to-end verification require separate approval. Transport harness and foundation
builder remain disabled; Phase 4 evidence is not involved.
