# Sprint 1B-N — synthetic transport harness core (not authorized to execute)

## Implementation boundary

This implementation provides the case matrix, wire-request renderer, preflight
contract, exclusive evidence publisher, orchestration state machine, independent
watchdog core/pipe-loop contract and inert upstream engine. It deliberately does
NOT provide an operational macOS network/quota/process-identity adapter, a live
HTTP response evaluator or an executable IPC launcher. Those missing reviewed
adapters are execution blockers, not checks satisfied by mocks. All three CLI
entry points currently return BLOCKED without launching anything. No '--execute'
flag or approval JSON boolean enables them. No dynamic adapter imports exist.

The watchdog is designed to execute in its own process and OWN process creation
and reaping. The supervisor is only an IPC client; it cannot own the watchdog's
children or race it to reap them. The supplied tests use fake boundaries and do
not demonstrate a functioning separate OS watchdog or complete transport run.
Real platform implementation/IPC integration requires separate owner approval.

## Source files

frontend/tests/transport/{supervisor.py,watchdog.py,inert-upstream.cjs,cases.json}
plus test_transport_mock.py and inert-upstream.test.cjs. Existing ingress mock
tests include the missing lifecycle cases. No backend application code imported.

## Phase order

A: reviewed local ingress -> actual Next frontend -> allowlisted proxy -> inert
upstream. B: ordinary Next -> proxy denial, with no ingress key or mode.
B is eligible ONLY after every A case passed, direct children were reaped, owned
groups disappeared and both listeners were released. Unknown cleanup blocks B.
No failed case, launch or uncertain cleanup is automatically retried. Each run
object is single-use; cleanup observation is not automatically repeated.

## Preflight — defaults remain BLOCKED

A future independently reviewed adapter must verify these against the exact run:

- Owner review references and separate one-attempt execution approval.
- Exact expected SHA-256 pins for supervisor, watchdog, upstream, cases, Node,
  Python, complete Next/runtime and frontend trees, network and storage policies.
- Owner-controlled isolated workspace, no symlinks/unsafe ancestors, no competing
  writers, quota and fixed free-space reserve; no preserved source/evidence reuse.
- Source/import inventory excluding backend, Prisma/PGlite, .env*, .git, existing
  .next and production configuration; denied filesystem access to those paths.
- Real OS network enforcement inherited by every launched descendant; only the
  two loopback service ports permitted. A loopback bind/telemetry flag is NOT
  proof of no outbound access. Disabled telemetry/update behavior needs review.
- Real storage quota covering Next output, tmp, logs, evidence and all allowed
  writable state. A directory-size poll is NOT enforcement.
- Independent watchdog launch, dedicated sessions/groups, ownership reservation,
  non-reaping exit observation, safe signals, direct-child reaping and listener
  inspection. Unsupported Darwin primitives must BLOCK, never fall back to PID.

Input validation accepts review references, but references alone are not proof:
the independently verifying control adapter must establish their applicability.
No production approval record or source pin is manufactured by implementation.
Current network/storage/platform verification status: UNVERIFIED, BLOCKED.

## Future workspace and evidence

Owner-approved root outside repository/Phase 4 scratch/evidence:
/Users/mishierukikutani/Nuudeltsgeey-Transport-Quarantine/<exclusive-run-id>/

Use private inputs/, frontend-work/, tmp/, evidence/ locations. Stage reviewed
frontend structure and read-only dependencies only after separate authorization.
Next must write only in the isolated working copy. This sprint stages nothing.
Exclusive directory creation 0700, files 0600, O_EXCL/O_NOFOLLOW; never overwrite,
rename, resume or delete partial evidence. The publisher writes/fsyncs/closes
files and fsyncs the directory. Failures leave incomplete files and stop the run.
No automatic cleanup. Final status remains REVIEW_REQUIRED, not accepted PASS.
Independent review must hash the inventory and capture process exit/cleanup
observations before accepting any result. A completion file alone is insufficient.

Publication cap: 1 MiB/file, 16 MiB total; logs 1 MiB/process and 8 MiB aggregate
must be enforced by the missing stream/IPC adapter. Generated output quota 2 GiB;
all remaining writable surfaces need explicit quota inventory before execution.
Hashing utilities do bounded reads and detect file change. Every existing path component is opened using directory descriptors and
O_NOFOLLOW, with ownership/permission checks. No path check alone prevents a
hostile same-user process changing already-open directory contents; reviewed
workspace isolation remains required and default execution stays blocked.

Only fixed case IDs, statuses, counts, safe identity records and hashes may be
published. Never raw proofs, keys, cookies, passwords, URLs with tickets or full
environments. Inert upstream emits target hashes/exact-match booleans, not query
strings or body contents. Credentials in cases are explicitly synthetic.

## Watchdog contract and limits

Monotonic: startup 30s, ordinary request 5s, timeout case 18s, total 180s.
Reserve final nine seconds for TERM (7s grace) then KILL (2s observation). No
extensions. The watchdog progresses when supervisor is silent/disconnected and
does not await ingress cleanup promises. Independent controller failure and
host-sleep detection must be handled by the reviewed platform adapter.

Identity includes opaque owned-child handle, PID, PGID=PID, SID=PID and birth
identity. Before EACH signal the adapter must verify direct-child ownership and
keep the leader unreaped to prevent identity reuse. An exited leader is not
proof that descendants are gone. Inspect descendants before reaping; surviving
members retain the reservation and remain eligible for bounded escalation.
After reaping, only observation is allowed: a reused group/listener produces
UNKNOWN, never a signal to its new owner. EPERM, ambiguous identity, inspection
errors and unconfirmed cleanup stop the experiment. No PID-only kill fallback.
No claim is made that non-child descendants can be reaped by this watchdog.

OS inspection/signaling primitives and pipe deadline behavior remain unimplemented
pending review. The core algorithms are simulation-tested, not kernel-verified.
No hard total-memory limit is established. An external native hang/host failure
can defeat a Python event loop; no absolute host-failure guarantee is claimed.

## Synthetic upstream and requests

Only fixed cases.json responses. No forwarding, backend imports, filesystem
writes or provider/database access. Engine is import-safe; HTTP construction is
an explicit function requiring a reviewed caller. CLI is blocked. Its eventual
launcher must pin cases, use bounded owned pipes for arm/finish/count commands,
and enforce deadlines/output caps. No HTTP management/control endpoint exists.
Every case has expected response categories, semantic checks and 0/1 upstream
request count. Any extra request is a violation, not a tolerated retry.

Raw request renderer preserves duplicate headers and encoded/repeated queries.
Future raw client connects only to 127.0.0.1:3002, with Host localhost:3002, no DNS,
no redirects/retries and a synthetic cookie jar. Slow tests send finite bytes;
no background connection storms. Browser operation is not part of the first run.
Inert upstream opens no outbound connections. Actual response parsing, semantic
checks and disconnect/close correlation are pending live-adapter implementation.
Do not claim that a mock supplying true check values proves those properties.

## Safe verification performed/allowed

Use existing interpreters and dependencies only. Commands for offline verification:

```
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s frontend/tests/transport -p test_transport_mock.py
node --test frontend/tests/transport/inert-upstream.test.cjs frontend/tests/ingress-policy.test.cjs frontend/tests/backend-proxy.test.cjs
```

Python mocks replace every filesystem publication boundary; no real quarantine
is created. Node mocks create no listeners and do not import Next. No subprocess,
HTTP request, port scan, signal, backend, Prisma, PGlite or Phase 4 tool executes.
Syntax checks should use ast.parse rather than py_compile to avoid writing pyc.

## Independent review checklist and approvals

1. Review all source/cases and mock isolation; freeze expected source/tool hashes.
2. Review missing live platform/IPC/client adapters separately before implementation.
3. Independently validate network, quota, credential and process-ownership controls.
4. Review bounded startup/shutdown, parent-crash and identity-reuse behavior with
   mock tests, then separately authorized harmless platform validation if needed.
5. Obtain explicit one-attempt A/B execution approval; no current CLI can run it.
6. Independently verify preserved results. Unknown means STOP, no automatic retry.

No real authentication, provider, database, VM, PGlite or subsequent sprint is
authorized. Phase B/C2/Gate 4 evidence and existing unrelated work are untouched.

## Sprint 1B-N — corrected core invariants (candidate for independent review)

Execution remains blocked. This revision supplies no real owner-approval verifier,
process launcher, IPC transport, network policy or storage quota adapter. Approval
strings in a JSON document grant no authority. `AuthorizationGate()` without
trusted adapters refuses issuance; every CLI still returns BLOCKED. A caller
injecting arbitrary trusted Python code is outside this in-process capability
model, which is not a sandbox against hostile code in the interpreter.

The gate first validates the case schema and exact inventory pin, then verifies
input/control evidence through injected trusted adapters. It retains a private
canonical snapshot of run ID, all source/tool hashes, case-manifest digest and
fixed deadlines. Issued opaque objects are identity-checked, expire after 30
monotonic seconds and can be consumed once. Altering the run, cases, hashes or
deadlines invalidates the capability. `Supervisor.run()` consumes it before any
bridge call; its case copy cannot be replaced by a caller or mutated by a bridge.
The default gate cannot issue a capability, even with plausible approval strings.
The future adapter must revalidate inputs at use and enforce the same run-wide
clock; mocks cannot establish protection against competing same-user writers.

### Inventory and strict results

The original 31-case file SHA-256 is retained in `ORIGINAL_31_FILE_DIGEST` as a
historical identity, not a new approval. The expanded candidate has 38 cases.
`CASE_FILE_DIGEST` pins its exact bytes; `CASE_DIGEST` pins canonical sorted-key
JSON. Independent review must approve these candidate pins before any adapter
implementation or execution decision. Changing the matrix requires changing and
reviewing both pins, not accepting a freshly computed hash automatically.

Every case has an explicit 5-second deadline, or 18 seconds for slow headers,
slow body and upstream timeout. The reviewed fixed policy remains 30 seconds for
startup, 180 seconds total across both phases, including nine seconds reserved
for cleanup. Header pairs preserve deliberate duplicate-header fixtures. Method,
scenario, body, headers, response categories and semantic checks are allowlisted
and typed; unexpected fields, duplicate IDs/checks, empty checks and booleans in
integer fields are rejected. Intentional malformed HTTP fixtures remain bounded.

Added cases: wrong Host, wrong Origin, duplicate Content-Length, standalone
Transfer-Encoding (without an automatically added Content-Length), unknown route,
response overflow and signed-out session after logout. WebSocket handshake uses
a valid 16-byte key. Unknown API routes expect HTTP 404. Response overflow emits
2 MiB + 1 byte, exceeding the unchanged proxy's 2 MiB response ceiling, and
expects HTTP 413 plus observed upstream cancellation. Cleanup failure is not
silently accepted as an equivalent response. Session follow-up requires the
future synthetic cookie jar to apply logout deletion, not blindly reuse a cookie.

A result has exactly `status`, `unknown`, `response`, `upstream_requests`, and
`checks`. Status must be PASS, unknown must be literal false, counts must be real
integers, and every nonempty required semantic check must be present and literal
true. Missing, extra, FAIL, UNKNOWN, truthy strings and integer booleans fail.
Status categories alone do not establish semantic success; the missing HTTP
adapter must measure these properties independently.

### Supervision and cleanup

The watchdog binds all messages to run, phase and case identifiers with a strict
message schema. The trusted future launch adapter supplies an immutable ordered
case/deadline plan from the authorization snapshot. READY requires both verified
owned children (`frontend`, `upstream`). Requests must follow that plan exactly;
PHASE_DONE requires all planned cases to have completed successfully. Phase B
requires passed Phase A AND CLEAN cleanup; neither startup nor an early STOP can
satisfy that condition. Total deadline never resets at the phase boundary.

`test_status` is separate from cleanup state: failed tests can have CLEAN cleanup
without becoming a successful test run. All ownership, exit, descendant, reaping,
group and listener observations require literal true. Ambiguity stays UNKNOWN.
Leaders remain unreaped until exit and descendant absence are confirmed. After
any reap attempt, including an uncertain one, that identity is never signaled
again. Later absence observations cannot prove that a group was never reused.

Bounded record exhaustion sets a sticky UNKNOWN fault without disabling the
termination state machine. IPC failure stops further channel use and supervision
continues through its monotonic deadline using the independently owned platform
clock. Signaling always rechecks reservation. Adapters must be bounded and
nonblocking; identity retention, OS process inspection, signals, host sleep and
parent-crash handling are not demonstrated by mocks. No operational Darwin
adapter is provided. Registration must be coupled to owned launch without an
unregistered-child gap; accepting arbitrary PID lists is prohibited.

### Upstream completion and attribution

Every wire request carries the synthetic `transport-case=<unique-case-id>`
cookie; when logged in it is combined with the synthetic session in one Cookie
header. It is an attribution marker, not authentication or an anti-replay secret.
The future adapter must preserve it to the inert upstream. Before counting a
request the engine checks its exact armed case marker, method and target. A late
previous-case request permanently stops the engine instead of being attributed
to the next case. Per-case and total counters persist and completed IDs cannot
be rearmed. Arming takes a private case snapshot.

Case completion requires the exact count and no in-flight response. `finish` or
`close` events settle responses, not calling `end()` alone. Unexpected requests,
publication failures and body overflows permanently stop the engine. The
`disconnect-after-barrier` case waits for the owned IPC `REQUEST_RECEIVED` event
before the client disconnects. No HTTP ACK is emitted: the real proxy buffers
upstream responses. The future IPC adapter must correlate and bound this barrier;
its transport is not implemented here. Cancellation must be independently
observed, not inferred from client disconnection alone.

### Local verification and remaining approvals

Only isolated mock tests and syntax/static checks are authorized for this sprint.
Mocks start no listeners, children or real Next.js instances. File-publication
failure tests replace filesystem calls and preserve no live quarantine workspace.
Tests do not prove kernel-enforced identity, quota, networking, watchdog scheduling,
HTTP parser behavior or Next.js transport compatibility.

Next step is independent CORE review. Only after review should proportionate
platform adapter design be considered. Separate implementation, control validation
and one-attempt execution approvals remain mandatory; no command to execute the
experiment is provided. No Phase 4 evidence, frontend ingress/proxy or backend is
changed by this sprint.

Sprint 1B-N local verification: 33 Python mock tests and 147 JavaScript tests
passed (23 upstream mocks plus 124 existing ingress/proxy regressions); no skipped
or failed tests in the final runs. Python AST and Node syntax checks passed.
Earlier development runs exposed a misspelled inventory constant, which was
corrected before the final successful runs. No live transport behavior is proven.
