# Phase 4 offline foundation verifier

This tool prepares foundation comparison without enabling production access.
LOCAL TEST PASS DOES NOT CERTIFY PRODUCTION COMPATIBILITY.
Production compatibility remains UNKNOWN until separately approved live evidence
and a complete independently verified expected catalog are available.

## Foundation builder implementation: mock-only, execution disabled

The prepared builder consists of:

- `phase4-build-foundation-reference.py`: exact foundation/runtime/query checks,
  minimal child environment, candidate sandbox profile, disabled authority gate,
  dormant bounded transport and UNREVIEWED artifact validation.
- `phase4-foundation-reference-worker.cjs`: fixed-request validation, mockable
  fresh-memory orchestration, generated-object relationships and separated artifact
  sections. Importing it never loads PGlite. Its real database factory is lazy and
  behind a hard-disabled gate; its CLI always refuses execution.
- `phase4_foundation_reference_queries.py`: 25 fixed catalog queries plus engine,
  freshness and ledger-absence SELECTs; transaction controls and exact row schemas.
- `test_phase4_foundation_reference.py` and
  `test-phase4-foundation-reference.cjs`: offline mocks only.

The only operational builder command is safe local planning:

```sh
python3 -B backend/scripts/phase4-build-foundation-reference.py --check-plan
```

It reads and hashes local files, returns EXECUTION_BLOCKED/exit 3, and never starts
a subprocess, sandbox or database. No execution flag or URL option exists. The
worker's CLI also refuses before reading stdin or opening the runtime. Claimed
owner approvals, sandbox signatures and network-denial booleans cannot enable it.
There is no authority trust key/receipt verifier, activation adapter, approved
staging layout or artifact-publication command in this release. Further approved
implementation/review is required to install those pieces; runtime validation
alone will not automatically activate them.

### Pinned input and runtime

Only the exact `20261012003031_foundation/migration.sql` path and bytes are accepted.
Neither builder nor worker enumerates migration directories. The request has one
foundation object, not a migration list; extra keys, alternative names/paths,
existing data-directory settings and connection URLs are rejected.

The PGlite package is pinned to 0.5.10. All 308 local package files are included in
the package-tree SHA-256, not just its main entry point:

```text
805fb863067224ff810f1f5739cd52a19a7a60059b4a43da79b431dc9ccad7ea
```

Additional explicit pins cover `dist/pglite.wasm`, `dist/initdb.wasm` and
`dist/index.cjs`. These local digest pins are ready for owner review; they are
not an independent upstream supply-chain attestation. Symlinks/special runtime
files and altered package bytes block processing. The future actual engine must
report server_version_num 180006 and PostgreSQL 18.6; embedded strings alone are
not runtime validation. Any other version requires a reviewed policy change.

Reference query/contract digest:

```text
e222f922c259cb219ff88370cf8f47126230360606b9fe701b522aa56d46fca7
```

This is separate from the existing production-verifier query pin, which is unchanged.

### Isolation boundary and missing activation evidence

The proposed child receives only LANG, LC_ALL, TZ and a private TMPDIR; it inherits
no HOME, PATH, NODE_OPTIONS, PG variables, database URLs, API keys or `.env` data.
The candidate profile denies networking, process fork, unspecified filesystem
access and `.env` reads/writes. It grants literal staged reads, the selected
Node executable and scratch-directory access. Following the preserved startup
diagnosis, the profile also grants literal root-directory read/existence access,
the exact system OpenSSL configuration file, the single `hw.pagesize_compat`
sysctl and metadata-only access to exact approved path ancestors. It does not
grant recursive reads of those ancestors or broad system/sysctl permissions.
Root scratch grants, traversal components and control characters are rejected.
These corrections are covered by an independently written exact-profile unit
fixture; they do NOT constitute a sandbox isolation attestation. Node startup
alone cannot establish network/filesystem/process denial or PGlite compatibility.

The original evidence remains under
`/private/tmp/phase4-sandbox-probes-j0ei4osc` and
`/private/tmp/phase4-startup-diagnosis-q1z3kaz0`; it must not be overwritten.
Database-free isolation retests must use a fresh private directory, hash the
exact generated profile, compare every rule against the reviewed narrow policy,
and preserve raw results. Tests may attempt only isolated localhost TCP/UDP.
Mock credentials and `.env` fixtures must be synthetic. No actual builder, worker
database factory or SQL is permitted during these probes.

If an outer tool boundary prevents a required probe, its result is UNKNOWN and
the retest stops. Do not retry elevated or otherwise bypass that boundary without
separate owner approval. A partially executed test set cannot certify isolation.
Execution authority remains uninstalled and the builder remains disabled.

Activation must bind independently tested denial of TCP/UDP/DNS, process spawning,
credential/home/repository reads, unapproved file writes and `.env` access to the
exact host, node/runtime/worker/query/profile hashes and immutable staging layout.
Positive startup and negative isolation probes require separate approval; do not
probe production. A signed/self-asserted file claiming enforcement is insufficient.
Hashes must be rechecked inside immutable staging to close verify/load races.
Never grant the whole repository/home or weaken denial rules to make startup pass.

The dormant transport has a 180-second wall limit, 120-second CPU limit and 8 MiB
per-output-file limit. Timeout handling terminates the private process group once,
waits at most five seconds and fails closed if termination is unconfirmed. It
never retries. Tests replace both process launch and signaling with mocks.
No real sandbox, child limit or process termination was exercised.

### Prepared execution and capture protocol

Only after separate future approval and activation review, the worker would:

1. Validate exact request keys and input digests before creating anything.
2. Construct one fresh `memory://` database with no extensions or reuse options.
3. Check actual engine version and empty public catalog/no unexpected schemas.
4. Begin a bounded transaction, set creation search_path to public/pg_catalog,
   apply the one pinned foundation exactly once, then commit.
5. Open a separate READ ONLY, REPEATABLE READ transaction with short timeouts and
   pg_catalog search_path; capture all fixed datasets and verify safety settings.
6. Verify Prisma ledger absence through catalogs only; never create or count it.
7. Roll back the read-only transaction and close the private in-memory resource.

Failures never produce a complete artifact or trigger reset/repair/retry/DELETE.
Closing a private client releases its memory; no cleanup SQL or filesystem cleanup
is executed. A future activation layer must preserve sanitized failure evidence,
write outputs exclusively in a private approved directory and require explicit
approval for disposing of retained files. Publication/staging is intentionally
inactive now; no reference artifact has been generated.

### Artifact format and completeness

Artifact `phase4-foundation-reference`, version 1, contains provenance, per-query
coverage, application datasets, generated-object links, environment observations,
ledger state and a canonical payload SHA-256. Every artifact remains UNREVIEWED,
reference_complete=false, exact_match_enabled=false and authenticity=NOT_ATTESTED.
A digest detects changes; it does not prove authenticity or independent review.
The parent rejects changed integrity, incomplete fields/coverage, invalid counts,
review-status promotion and misplaced owner/ACL observations.

The application datasets preserve columns/ordinal/type/default/nullability,
identity/generated attributes, constraints/definitions, indexes/validity,
enums/order, routines, triggers, views, RLS and unexpected objects. Supplementary
queries retain type/element/row relationships, ordered constraint columns and FK
actions, PK/index relationships, index opclasses/collations/options, and internal
trigger constraint/function/event/argument relationships. No raw object OIDs are
selected as semantic identities. Generated names and deparser text are retained
for later reviewed normalization, not automatically discarded.

Owner and ACL fields are removed from application rows and retained with stable
identity links in environment.application_security. Other environment datasets
capture schema grants, relation/column ACLs, default privileges, extensions,
event triggers, locale/encoding, role/database ownership and settings. These are
observations of the local environment, not expected Neon security values. RLS
configuration remains visible as application semantics. Ledger state is ABSENT,
count=null, NOT_DEFINED_BY_FOUNDATION; it is not an invented empty production ledger.

All proposed SQL remains STATICALLY REVIEWED, NOT DATABASE-VALIDATED. Captured
coverage is marked CAPTURED_UNREVIEWED and never implies semantic completeness.
Assertions on 26/192/74/52/13/67 object counts are only sanity checks. PostgreSQL
18 NOT NULL constraints and internal generated metadata remain captured for review.
The existing verifier cannot consume/approve this artifact or emit an exact match.

The exported `captureWithFactory` is a dependency-injected orchestration boundary
used with fake clients; it does not attest a sandbox or confer operational approval.
Mock fixtures deliberately are not verified PostgreSQL catalogs. Local test pass
does not prove SQL syntax, runtime catalog coverage, network isolation or actual
foundation compatibility.

### Mock test procedure

Python: `python3 -B -m unittest discover -s backend/scripts -p 'test_phase4_foundation_reference.py'`.
JavaScript tests require PHASE4_REFERENCE_MOCK_INPUT pointing to a private local
request fixture made from `prepare_request()` (source SQL/query strings only).
Then run `node --test backend/scripts/test-phase4-foundation-reference.cjs` with
that variable. Do not invoke the worker to make the fixture. The JavaScript harness
traps any PGlite import; every SQL-shaped call goes to an in-process fake client.
The Python transport tests patch subprocess.Popen and process-group signaling.
Do not run database-enabled tests, npm lifecycle scripts or a sandbox validation
command as part of this mock-only phase.

Future checkpoints: owner review of these local changes; separate approval for
activation/staging implementation; independently approved sandbox probes; isolated
database creation; exactly one foundation application; catalog capture/output;
independent artifact review and verifier integration; explicit disposal. Production
inspection, Neon changes and native synthetic testing remain separate approvals.

## Current status

REFERENCE INCOMPLETE — LIVE COMPARISON BLOCKED

The authoritative file is
`backend/prisma/migrations/20261012003031_foundation/migration.sql`, SHA-256:

```text
a8ae6fd95d38a2ea0192d471485e2fdf6abcb54f683d8ad0025bfd68088d73bc
```

Every CLI mode verifies these exact bytes before proceeding. A mismatch stops
processing. No environment variable or CLI argument can replace this foundation,
query pin, production identity, or reference completeness state.

The hash-verified SQL establishes 26 tables, 192 columns, 26 primary keys,
48 foreign keys, 26 explicit indexes plus 26 primary-key indexes, and 13 enums
with 67 labels. It declares no application sequences, routines, user triggers,
identity/generated columns, views or RLS policies. Counts are sanity checks.

The limited evidence extractor reads table names and ordered enum labels only
from those exact pinned bytes. It is NOT a PostgreSQL-aware parser. It cannot
produce a complete canonical reference for columns, constraints, indexes,
ownership, privileges, implicit objects or platform configuration. No suitable
installed PostgreSQL-aware Python parser was found. No dependencies were added.

The existing `phase4-schema-check.cjs reference` path replays all seven migrations
in PGlite. Do not invoke it to fill this gap under the current authorization.
The remote path retrieves migration row contents and is also unsuitable here.
The final 37-table fingerprint is not a foundation reference.

## Offline reference completeness review (2026-10-19)

The pinned hash was reverified. No installed Python `pglast`, `pg_query`,
`sqlglot` or `sqlparse` module, or SQL-related Python distribution, was found.
The backend dependency lock contains no standalone `node-sql-parser`,
`pgsql-ast-parser`, `libpg-query`, `pg-query` or `sql-parser` dependency.
PGlite 0.5.10's installed `index.d.ts` describes its exported `parse` namespace
as query-result parsing; `protocol.serialize.parse` creates protocol messages.
Its `formatQuery` requires an existing database interface. These are not an
offline SQL AST/catalog generator. No PGlite instance, Prisma engine or SQL
execution path was started. No dependency was installed.

The migration's declarations can be read exactly, but declaration evidence must
not be promoted to a complete runtime catalog. In particular, unqualified object
and enum names require an approved creation/search-path context; `public` is the
existing application's intended schema, not a schema assignment written in each
CREATE statement. Built-in type aliases and defaults also need semantic type
resolution, not string replacement.

| Comparison property | Evidence and completeness |
| --- | --- |
| Foundation bytes | COMPLETE: exact SHA-256 match. |
| Declared table names | COMPLETE limited-source evidence: 26 CREATE TABLE declarations; extracted by the existing pinned-byte evidence reader. |
| Enum names and label order | COMPLETE limited-source evidence: 13 CREATE TYPE declarations, 67 ordered labels. Runtime schema/type identities and generated array types remain unverified. |
| Column names/order/type declarations | 192 exact declarations available in SQL; COMPLETE CANONICAL REFERENCE NOT GENERATED. There are 116 TEXT, 23 INTEGER, 33 TIMESTAMP(3), 4 BOOLEAN, 3 JSONB and 13 enum-typed columns. Alias resolution, typmods, implicit collation, storage/compression and rendered forms remain unresolved. |
| Nullability/default declarations | 145 NOT NULL and 47 nullable declarations; defaults are literal strings, integers, booleans or CURRENT_TIMESTAMP. No identity/generated declarations. Source intent is explicit; complete canonical column/default metadata is still INCOMPLETE. |
| Primary keys | 26 explicitly named primary keys, each on id. Ordered key declarations are in SQL; generated index/catalog representations are INCOMPLETE. |
| Foreign keys | 48 named FK declarations with ordered local/reference columns. Delete/update actions: 30 CASCADE/CASCADE, 15 SET NULL/CASCADE, 3 RESTRICT/CASCADE. Full canonical constraint metadata/internal triggers remain INCOMPLETE. |
| Unique/check constraints | No explicitly declared UNIQUE or CHECK constraints. Unique indexes must not be misclassified as UNIQUE constraints. PostgreSQL 18 NOT NULL constraints need separate treatment. |
| Explicit indexes | 20 unique and 6 nonunique declarations with exact ordered columns. The expected total of 52 includes 26 PK indexes. Generated operator classes, collations, sort defaults, rendered definitions and runtime validity/readiness require a reference. |
| Sequences, routines, user triggers, views, RLS policies | No declarations in this migration. This establishes migration intent, not absence of preexisting/platform objects. IdentitySequence is an application TABLE, not a PostgreSQL sequence. |
| PostgreSQL-generated objects | INCOMPLETE: internal FK triggers, implicit row/array types, PK indexes, NOT NULL representation and implementation defaults. |
| Platform/security | SEPARATE, INCOMPLETE: creation role, schema/relation/type ownership, effective/default ACLs, grantors, schema/database defaults, extensions, collation environment and search path are not established by this migration. |
| Prisma ledger | SEPARATE, INCOMPLETE: the migration does not create the ledger or establish its structure/count. A reference cannot invent an empty production ledger. |

These additional source counts were obtained by static inspection of the exact
pinned text, not a general PostgreSQL parser or database execution. They are
sanity evidence only. No complete artifact was integrated and no comparison
property was silently excluded to allow an exact match. Existing comparison
code, query pins, native/migration guards and INDETERMINATE behavior are unchanged.

The smallest next reference step requires separate owner approval: prepare and
review a foundation-only reference builder for a disposable, isolated PostgreSQL
18 environment with no production/Neon credentials or network access. Only after
explicit authorization may it execute the one pinned foundation and capture the
generated catalog. Do not use the current helper unchanged: it replays all seven
migrations. Record engine/build, locale/collation, role and creation/search-path
context, foundation hash and complete query coverage. Keep environment/security
baselines separate from application structure and ledger assessment; a local
database reference alone cannot certify Neon platform ACLs or production state.
Review the resulting artifact and adapter before enabling exact-match comparison.
No reference execution or preparation beyond this documented proposal is implied.

## Offline operator commands

From the repository root:

```sh
python3 -B backend/scripts/phase4-foundation-verify.py --verify-reference
python3 -B backend/scripts/phase4-foundation-verify.py --validate-queries
python3 -B backend/scripts/phase4-foundation-verify.py --compare-capture /absolute/private/capture.json
```

No command connects to a database or starts a process/service. No `.env` file,
connection URL, password or ambient database environment variable is loaded.
Unknown options and abbreviated flags are rejected without echoing their values.
There is no connect, approve, execute, reference-override or query-override mode.

Exit codes: 0 = static allowlist validation passed; 2 = definite offline catalog
difference or invalid CLI syntax; 3 = incomplete reference/capture or rejected
input/pin. `--verify-reference` deliberately returns 3 while the reference is
incomplete. An exact-match success is intentionally unreachable in this release.
Do not treat a static query pass as permission to connect.

## Capture contract, version 1

This is an offline semantic adapter format, NOT raw SQL output. The future
collector and adapter are not implemented. Captures are untrusted local files;
their claimed identity/approval/coverage is not independent evidence.

Required top-level keys:

- `format_version`: integer 1.
- `foundation_sha256`, `query_plan_sha256`: exact repository pins.
- `context`: exact keys documented in `validate_capture`: project, branch, branch
  name, endpoint, hostname, database, role and approved role, server version,
  transaction mode/isolation, TLS policy, identity/visibility claims, UTC capture
  timestamp. Only production identity in project `rough-snow-56584532`, branch
  `br-wispy-mountain-b5nku4bf`, is within this format's intended scope. Endpoint
  claims are checked for consistency but are NOT authenticated or independently
  pinned here. A future collector must pin a separately verified exact endpoint.
- `coverage`: every catalog section must explicitly be `true`. Claims alone do
  not establish complete collection.
- `catalog`: every section below must be present, even if its list is empty.
- `ledger`: `state: "counted"`, nonnegative integer `count`, and
  `structure_reviewed: true`. Missing, inaccessible or unreviewed ledger state
  yields INDETERMINATE. Migration row contents are forbidden.
- `diagnostic_oids`: optional-in-content integer list (required key; normally
  empty). Excluded from semantic comparison; raw OIDs in semantic rows rejected.

Catalog sections are `schemas`, `tables`, `columns`, `constraints`, `indexes`,
`types`, `enums`, `sequences`, `routines`, `triggers`, `views`, `policies`,
`privileges`, `default_privileges`, `extensions`, `event_triggers`, `rules`,
and `unexpected`. Each row has exactly `identity` (schema-qualified string array)
and `properties` (the exact field set in `FIELDS`). Overloaded routines include
argument identities. Ledger relation/column/index/constraint rows must be
separated from application rows by the future adapter; they must not disappear
from the raw capture or receive an invented structure baseline.

The contract requires explicit properties for column order/type/default/
nullability/identity/generated/collation, FK definition/actions/validation/
deferral, index definitions/validity, enum label order, sequence definition/
ownership, routine definitions/security, triggers, views, RLS, grants including
grantor/grantability, and unexpected objects. Unknown sections/fields, duplicate
identities/JSON keys, nonfinite values, bad required booleans, unsupported server
versions, URLs, symlink inputs, nonregular/oversized files and excessive nesting
fail closed. This does not amount to full semantic authenticity validation.

## Comparison coverage and verdicts

The pure `compare_catalogs` primitive compares all declared properties, with
stable row sorting and no raw-OID equality. Ordered property lists remain ordered;
there is no unsafe whitespace/cast/SQL-literal rewriting. A future adapter must
canonicalize ACL sets by principal, grantor, privilege and grantability without
assuming the inspection role owns objects. No global role-name substitution is
permitted. Generated internal FK trigger names alone can be normalized when
bound to a present FK and enabled; the remaining definition and multiplicity
remain compared. Unknown/disabled internal triggers are not ignored.

Primitive tests use explicitly synthetic examples, not a verified foundation
artifact. They demonstrate comparison behavior, not reference correctness.

`--compare-capture` only establishes definite differences supported by limited
pinned-source evidence: table identity/kind, enum identity/order, unexpected
sequences/routines/views/policies/event triggers, user triggers, and enabled RLS.
Other property comparisons are prepared/tested by the pure primitive but are
NOT wired to a complete authoritative reference. Matching limited evidence
always yields INDETERMINATE; it never produces EXACT FOUNDATION MATCH.

Verdicts:

- EXACT FOUNDATION MATCH: reserved; impossible until complete reference, capture,
  normalization and ledger/security review requirements are implemented and
  independently verified under separate approval.
- MIGRATED OR OTHERWISE DIFFERENT: definite difference in the supplied offline
  capture versus pinned-source evidence. This does not authenticate the capture
  or establish current production state.
- INDETERMINATE: malformed/incomplete inputs, unresolved evidence, normalization,
  visibility, ledger state or matching-but-incomplete reference.

Ledger count is reported separately. Neither zero nor a positive count establishes
schema compatibility. Outputs contain fixed categories, section codes and counts,
never object names, definitions, raw exceptions or input paths. Sensitive literals
in defaults/function definitions remain private in the input file.

## SQL plan and safety review

`phase4_foundation_queries.py` contains 22 fixed SELECT statements covering Q1-Q8:
identity/TLS, schemas/relations, columns, constraints/indexes, types/enums/sequences,
routines/triggers/views/RLS, ACLs/default grants/extensions/event triggers/rules/
unexpected namespace dependencies, and ledger COUNT only. The statements use
qualified built-in catalog functions and do not execute inspected application
functions or read application rows. Routine deparsing excludes aggregate/window
routine kinds; unexpected routines remain reported. Sequence state is not read.

The query bundle and transaction plan have a fixed SHA-256 allowlist. Any textual
change fails static validation until separately reviewed and repinned. Additional
lexical checks reject multiple statements, comments and mutation keywords. This
is integrity checking and static review, NOT a full SQL parser or runtime proof.

Proposed transaction: REPEATABLE READ, READ ONLY; local statement timeout 10s,
lock timeout 1s, idle-in-transaction timeout 30s, search_path pg_catalog; ROLLBACK.
A future collector must impose connect timeout 5s and a bounded total duration,
reject unknown settings and close on the first error without retry. Q8 may run
only after confirming the ledger is the expected ordinary table, with adequate
permissions and no unresolved RLS/structure concerns. No existence or content
query against application tables is included.

Static target is PostgreSQL 18. `attcompression` and `indnullsnotdistinct` are
version-dependent catalog fields; PG18 NOT NULL constraint representation needs
a separately reviewed reference rule. No field is silently dropped to make a
match. Deparser text, collations, default grants, extensions and server-specific
objects can differ from local expectations. System-catalog visibility and
platform defaults remain unverified. No SQL was run to validate runtime syntax,
permissions, execution plans, catalog completeness or performance.

## Future authorization and STOP conditions

`collect_live` is an inert function that always raises LIVE_COLLECTION_DISABLED,
including when given a claimed approval or callback. It has no driver or network
code. Existing Phase 4 launchers and guards remain unchanged.

Separate approvals are required for further local verifier work; current Neon
metadata verification; a read-only production PostgreSQL inspection; schema-only
branch creation; target-pin updates; migration writes; native synthetic writes;
and eventual branch disposal. No approval implies another stage.

Before any future collection: independently pin project/branch/direct endpoint;
approve an existing read-only role without privilege changes; require trusted
hostname-verifying TLS; review an immutable collector/adapter and complete
expected artifact; confirm catalog visibility and ledger/security baselines.
Read-only transaction alone does not make arbitrary SELECT statements safe.

STOP on identity/TLS/permission/version ambiguity, incomplete reference/capture,
unexplained objects, timeout, concurrent DDL uncertainty or missing ledger review.
Do not retry, query application records, weaken a guard or infer an exact match.
INDETERMINATE and definite differences block use of production as parent for the
unchanged Phase 4 migration rehearsal. Even an eventual exact catalog match
requires separate schema-only initialization/isolation and creation approval.

## Local verification

The new Python tests exercise comparison, malformed/tampered inputs, ledger
separation, redaction, disabled execution and socket/process traps without SQL.
Run `python3 -B -m unittest discover -s backend/scripts -p 'test_phase4_foundation_verify.py'`.
Any broader JavaScript check must set `PHASE4_NO_DATABASE_TESTS=1` and inspect
the selected files first. Never run migration/native launchers or npm lifecycle
scripts as verifier checks. No PostgreSQL/PGlite/Docker execution is authorized.
