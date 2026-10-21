# Sprint 1B-G local ingress and API proxy

Source implementation and isolated mock verification only. No listener, backend,
database or provider was started. Existing frontend API-client behavior and UI
remain unchanged. This is not approval to execute the entry point.

## Architecture and configuration

Browser http://localhost:3002 -> local ingress -> Next.js frontend -> explicitly
allowlisted API route -> http://127.0.0.1:3001. The ingress binds IPv4 loopback
127.0.0.1 only. IPv6 localhost resolution/browser fallback remains unverified.

Required server-only settings, exact with no trailing slash:

```
FRONTEND_CANONICAL_ORIGIN=http://localhost:3002
BACKEND_INTERNAL_ORIGIN=http://127.0.0.1:3001
```

New command for future separate approval, from frontend/:

```
npm run dev:ingress
```

The command sets NODE_ENV=development. It is not run by this sprint. Existing
production/start/build and ordinary dev scripts are unchanged. The ingress
refuses non-development mode. No dependencies were installed.

## Enforced request provenance

Installed Next.js 15.5.28 base-server.js injects X-Forwarded-Host, -Port, -Proto
and -For before NextRequest creation. Injection is source-confirmed; direct
Requests in unit tests do not demonstrate live header transformation.

Before loading Next, the custom entry point generates a fresh 256-bit HMAC key
in a server-only environment variable. It overwrites any supplied launch key.
It also sets the private development-mode flag. Keys are never NEXT_PUBLIC,
logged, returned, written to files or forwarded upstream. Route-handler env
access is runtime access. Cross-worker propagation must be transport-verified.

Ingress rejects all incoming X-Nuudel-Ingress-* markers and forwarding headers.
After raw validation it adds an HMAC proof binding method, target path/query,
Host, Origin, Cookie, Content-Type, Content-Length and four Fetch Metadata fields
plus timestamp and random nonce. The API route requires the private key/mode,
development environment and valid proof within 60 seconds. It independently
checks host/origin, metadata, path, allowlist and expected framework forwarding
values. It strips the proof before upstream fetch by allowlisting headers.

Ordinary next dev/start has no generated key/proof and cannot silently authorize
API forwarding. Matching X-Forwarded-* values are never sufficient. Manually
setting the mode flag without a valid signature also fails. Do not copy the
private key to another process or configure it manually.

This is ingress provenance, not user authentication. Backend session, CSRF and
authorization remain authoritative. Trust assumes no hostile process can inspect
or modify this process's environment/memory or source. A compromised same-user
host is outside this boundary. Proofs are not one-time: a stolen proof can be
replayed during its 60-second lifetime within a running key epoch. It binds the
body framing but not the body bytes. No supported path exposes proofs to clients;
preventing replay after host-memory compromise is not claimed. Restart rotates
the key. No proof/header value is a standalone authenticated user identity.

## Lifecycle and shutdown boundary (Sprint 1B-I)

Lifecycle states are PREPARING, BINDING, RUNNING, STOPPING and EXIT_REQUESTED.
The first shutdown signal or startup/listener error enters STOPPING synchronously
and arms one referenced five-second termination timer. Repeated signals neither
extend that deadline nor restart cleanup. No new listener is created after
STOPPING; a pending bind receives AbortSignal cancellation and explicit close.

Do not call app.close() while app.prepare() is still pending: it could resolve
before Next has initialized anything. Instead, the fallback stays armed. If
preparation settles before the deadline, cleanup runs once; if it never settles,
the fallback invokes process.exit(1). Late completion cannot resume startup.

Cleanup independently attempts server.close(), server.closeAllConnections() and
app.close(). All promises have rejection handlers. If all cleanup calls settle
successfully, the ingress explicitly calls process.exit(130) for SIGINT or
process.exit(143) for SIGTERM (1 for startup/listener error). This is a process
termination request, NOT a verified clean-shutdown claim. Next's app.close()
internally suppresses some errors; active resources may still exist.

Rejected or hanging cleanup leaves the fallback armed and ends with an explicit
process.exit(1). The fallback is never cleared or unref'd on either outcome.
An EXIT_REQUESTED guard prevents duplicate exit calls when fake processes return
in unit tests. Real process.exit() does not return. Startup failures after Next
loading use the same shutdown mechanism; preflight failures before Next loading
return a fixed error and nonzero exit status.

These mechanisms act only on this Node process/owned server. They neither signal
unrelated processes nor prove descendant termination. They can truncate pending
output; preserve evidence with an external controller. JavaScript timers are
not an OS-enforced wall deadline: blocked event loops, native hangs, host sleep,
or a compromised runtime can delay them. The future transport harness still
requires an independent watchdog, reaping and process-group/listener checks.
No claim of process-tree cleanup follows from app.close() or an exit code alone.
No listener or shutdown fallback has been tested against a real process here.

## HMAC acceptance scope

The 60-second proof is an ingress-origin assertion, not transaction-level
anti-replay. A random nonce is signed but never consumed. Repeated verification
of the same proof succeeds before expiry. Body bytes are not signed; a different
body with identical bound framing/headers also verifies. These limitations are
explicitly demonstrated by tests, not described as attacks prevented by them.
Client-supplied proof headers are still rejected by raw ingress. The source
assumes trusted local processes, private key/proof confidentiality, and no
unreviewed route that leaks proofs or uses the signing key.

This design is acceptable for consideration ONLY for the proposed credential-free
inert-upstream transport experiment. It does not authorize real authentication,
identity linking or database mutations. Before real authentication, independently
review confidentiality, replay/body-substitution exposure, backend authority,
transport evidence and whether one-time proofs or body binding are necessary.
This sprint deliberately adds neither replay prevention nor body binding.

## Raw HTTP policy

HTTP/1.1 only; origin-form targets only; exactly one Host localhost:3002. Reject
all duplicate header names (stricter than only security headers), missing Host,
client Forwarded/X-Forwarded-*/X-Real-IP/ingress markers, malformed Origin and
malformed/combined Fetch Metadata. Missing Fetch Metadata is accepted; POST still
requires exact canonical Origin and must not have cross-site metadata.

Only GET, HEAD, and API POST are passed to Next. The API proxy retains the
narrower route/method allowlist below. No frontend Server Actions POSTs enabled.
Paths reject dot segments, percent encoding, backslashes, duplicate slashes,
fragments, controls and non-ASCII. Query encoding and repeated values are kept;
malformed percent escapes fail. Next may normalize/re-serialize accepted inputs:
any mismatch against the signed target fails closed, requiring review rather
than weakening proof validation.

Strict Node parser: insecureHTTPParser=false. Header byte cap 16 KiB; at most
64 fields after parsing, with no maxHeadersCount truncation. Duplicate/framing
checks happen on rawHeaders after Node parsing, before Next normalization.
Chunked bodies, Transfer-Encoding, Expect, Upgrade, Trailer and unusual
Connection tokens are rejected. API POST requires a canonical numeric
Content-Length <=16 KiB. GET/HEAD permit only zero or absent Content-Length.
Node's parser bounds the framed body to the declared length; the proxy also
counts actual bytes. Extra wire bytes are new HTTP input, not part of that body,
and must independently pass ingress. No body data listener steals bytes from
Next. Streaming POSTs without a Content-Length intentionally fail.

Header timeout 5 seconds, request timeout 15 seconds, parser timeout checking
interval 1 second; these are Node scheduling limits, not exact real-time bounds.
Ingress also checks incomplete body at 10 seconds and bounds the response at
60 seconds. API fetch/body deadline is 15 seconds; responses <=2 MiB; query
length <=8192 characters at the proxy. Connection cap 32, keep-alive 1 second.

HTTP upgrade, CONNECT and HMR WebSockets are denied. The guarded Server class
rejects upgrade/connect event dispatch before any listener, including Next's
automatically installed upgrade listener. No listener-order assumption is made.
Expect/continue events are rejected before dispatch. Use manual page reload:
HMR is deliberately unavailable. This behavior needs separate transport review.

## API allowlist and response policy

POST: /api/register; /api/auth/login; /api/auth/logout;
/api/identity/{steam,discord}/start.

GET: /api/auth/{session,csrf,providers}; /api/identity/status;
/api/identity/{steam,discord}/callback; /api/leaderboard; /api/tournaments;
/api/tournaments/<ASCII identifier> except mine;
/api/players/NMD-<digits>/history.

No admin, tournament-write, revocation, arbitrary Auth.js action or open-proxy
paths. Origin and Fetch Metadata are preserved. Only Cookie, Origin, Fetch
Metadata and fixed headers are forwarded. No automatic retries, no redirect
following. Redirects only from identity callbacks to canonical /identity without
query/fragment (302/303/307/308). Provider URL JSON remains backend-owned; future
UI must validate provider URL destinations before browser navigation.

All responses no-store. Separate Set-Cookie/chunks, attributes and deletions are
preserved; Domain cookies are rejected. Upstream transfers are aborted and body
cancellation requested on every rejected response, including rejection before
reading the body. The deadline stays installed through cleanup. Cleanup waits
at most one second and no later than the remaining deadline; failed or uncertain
cancellation returns PROXY_CLEANUP_UNCONFIRMED without cookies. This is a request
to terminate client transport, never evidence of backend transaction rollback.
Client cancellation reports CLIENT_CANCELLED (499); deadline expiry reports
PROXY_TIMEOUT (504). No sensitive payloads, keys or exceptions are logged.

## Backend proposal ONLY — not implemented

Before live integration, separately approve backend loopback binding, local
APP_URL=http://localhost:3002, AUTH_URL=http://localhost:3002/api/auth and private
AUTH_SECRET. Review a local-only backend ingress Host/forwarding guard against
its own Next.js transformation path. Preserve existing Origin, CSRF, rate-limit
and permission checks; leave trusted-client-IP configuration unset. Backend
remains directly reachable by trusted local processes. Production unchanged.

Current callbacks require frontend /identity (Sprint 1C). Registration does not
log in. Linking needs session and current password. Browser cookie acceptance,
provider callbacks, actual Next header serialization, signal propagation and
real session operations are unverified. Existing frontend API client migration
to relative URLs is deferred. Cookies share localhost scope across ports.

## Offline verification

From frontend/, using existing dependencies only:

```
node --test tests/backend-proxy.test.cjs tests/ingress-policy.test.cjs
./node_modules/.bin/tsc --noEmit --incremental false
node --check server/local-ingress.cjs
node --check server/ingress-policy.cjs
```

Mocks never bind a socket or load Next/backend/Prisma/PGlite/Phase 4. Entry-point
main() is exercised with fake Server, Next and process boundaries. Proxy tests
transpile only the proxy and stub server-only explicitly; other imports fail.
The server-only import is enforced by Next compilation; client-build rejection
was not exercised with a real Next build. Parser/header timeout options are
asserted in mocks, not demonstrated at runtime. Tests are not browser proof.

## Future inert-upstream transport test — not authorized

After independent source review and separate execution approval:

1. Freeze source/tool hashes; use a minimal credential-free environment and
   synthetic browser profile. Confirm 3001/3002 free; STOP on any collision.
2. Start only an owned inert upstream on 127.0.0.1:3001 and reviewed ingress.
   No real backend, provider, database or external requests. Stub responses only.
3. External controller: startup deadline 30s, total deadline 120s, bounded logs,
   and per-request deadlines. No automatic retries or fallback listeners.
4. Confirm valid traffic, raw duplicate/spoof rejection before upstream receipt,
   body/framing limits, query/proof stability, cookies, redirects, cancellation,
   timeout, ordinary-entry bypass rejection and denied upgrades/HMR.
5. Track owned process identities/groups. Stop only owned children; verify
   reaping, group absence and released listeners. Unknown cleanup means STOP.
6. Preserve sanitized evidence for independent review. No automatic cleanup of
   existing evidence, scripts or fixtures. No Sprint 1C execution is implied.
