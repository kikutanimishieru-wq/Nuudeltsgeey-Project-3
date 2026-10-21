# Phase C2: fixed runtime assets and WASM compilation

Gate 1 implements source, mock tests and this guide only. No real diagnostic,
sandbox activation, WASM compilation, runtime import or database operation is
authorized by Gate 1. The foundation builder remains disabled and unmodified.

## Scope and files

- `scripts/phase4-runtime-assets-controller.py`: verifies pins, stages exclusively,
  launches one sandboxed process after Gate 2 approval, preserves evidence.
- `scripts/phase4-runtime-assets-diagnostic.cjs`: reads four fixed assets and
  compiles two verified byte buffers; importing the definitions performs no work.
- `scripts/test_phase4_runtime_assets.py`: mocked filesystem/process/publication
  boundaries; never launches the diagnostic or creates real staging directories.
- `scripts/test-phase4-runtime-assets.cjs`: synthetic byte objects and fake
  compilation. Real WebAssembly compilation and instantiation functions are
  replaced with throwing guards. Runtime-package imports are rejected.

No npm scripts, application imports, foundation SQL, Prisma or builder functions
are used. Node imports only `node:fs` and `node:crypto`. The worker does not
evaluate `index.cjs`; it reads that file and `pglite.data` strictly as bytes.
It calls only WebAssembly.compile for the two WASM assets, sequentially. It never
instantiates modules, calls exports or initializes PGlite/PostgreSQL.

## Fixed inputs

Profile: `/private/tmp/phase4-isolation-retest-qwhtwx0c/corrected.sb`.
Its unchanged SHA-256 is
`5585d1b138327d80ec67da77f9dcec9d50f827a49313ae22350e1d73f98c02d1`.
No profile is generated, edited or substituted. The Phase B configuration and
fixtures are never written or removed. The existing configuration does not block
C2: C2 neither reads nor recreates it.

Runtime: `backend/node_modules/@electric-sql/pglite`, version pinned by the
308-file tree digest
`805fb863067224ff810f1f5739cd52a19a7a60059b4a43da79b431dc9ccad7ea`.
The entire installed tree is rehashed without importing any of its modules.

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| index.cjs | 2066577 | 64bc0b76b47b72ec1665a9569998751064dc36fe51bffa5d8717ce233631f021 |
| pglite.wasm | 10498455 | 864c7651fe2f23c38ff9e047a0b8851af0a5dbcbbb244a6a985bc254f274659e |
| initdb.wasm | 300129 | b33b41af366b4f7909085bb360b37587e5fa57a26113d84c21f23f9bfd63c0f8 |
| pglite.data | 6248214 | 12384e109f1cea6edb978550d0445f8958ad4089cbbe3222d657f56e2e817d4b |

The existing `/usr/local/bin/node` digest is pinned to
`49098713938c2537a0cbca663d79b427b8faeed50c34de1e89177778d4c447e8`.
The corrected controller and Phase A4 publication helper source files are pinned
and imported as definitions only; their launchers are never invoked. Their
original files remain unchanged. Updating any pin requires another review.

## Staging and verification-to-use handling

On approved execution only, the controller creates an exclusive private
`/private/tmp/phase4-isolation-retest-qwhtwx0c/scratch/phase4-c2-assets-*`
directory. It prints and records the location as STAGING_INTENT before copying
any asset, so partial staging remains attributable. A publication failure stops
copying. A new `/private/tmp/phase4-c2-evidence-*` directory holds evidence outside
the sandbox's scratch read grant.

Staging contains only `diagnostic.cjs`, `assets/` with four files and an empty
`tmp/`. Files use O_EXCL/O_NOFOLLOW, mode 0400, bounded writes, flush, fsync,
successful close and directory synchronization. Directories use private modes.
Nothing is deleted, renamed, overwritten or automatically cleaned up. Even
partial files/directories remain preserved on failure.

The parent retains verified source/asset buffers from the original reads. It
copies those buffers, rechecks staged hashes before launch and checks staged
files and the original profile/Node pins again after the child exits. Symlink
inputs/ancestors, special files, changed sizes/timestamps, unexpected entries or
temporary writes reject the run.

The diagnostic source is passed to Node using `-e` from the already verified
source buffer. It is NOT reopened as executable JS from staging. A staged source
copy is retained and checked for audit. The fixed `index.cjs` asset is never
required. Inside the child each asset is read through an O_NOFOLLOW descriptor,
bounded by its exact size. Size, metadata and SHA-256 checks precede compilation;
both compiles use exactly the same private buffers that passed verification.

Residual races remain: scratch is writable by the child policy, readonly mode
bits do not establish immutable storage against the same user, ancestor checks
are not atomic directory-fd walks, and the OS reopens Node/profile paths during
execution. Before/after hashes cannot detect every change-and-restore attack.
The exact profile is not broadened to address these limitations. Gate 2 requires
a trusted designated host/operator with no competing modifications. If those
conditions cannot be established, STOP; this is a compatibility diagnostic, not
a hostile-host attestation or trusted foundation-reference generator.

## Execution and termination boundaries

The child receives only LANG=C, LC_ALL=C, TZ=UTC and a private staged TMPDIR.
There is no HOME, PATH, NODE_OPTIONS, database URL, credential inheritance or
network module. No new network probes are performed. Existing sandbox network,
fork and .env denials remain in force. No child subprocess is requested by the
diagnostic.

The wall deadline is 180 seconds, with the reviewed controller limiting each
captured stream to 64 KiB (overflow capture can include one final read chunk).
The diagnostic itself limits structured stdout to 8 KiB and rejects short writes.
One normal process launch is allowed. Timeout, interruption or output overflow
is failure, even when cleanup succeeds. No timeout outcome is a passing C2 test.
There is no new hard memory/CPU limit: compilation memory/CPU requirements remain
unknown and the parent enforces the wall deadline independently of Node's loop.

Cleanup attempts precede process-report publication. Normal completion requires
exit zero, empty stderr, no transport/cleanup error, child reaping and verified
group absence. SIGKILL EPERM is retained as unconfirmed signal delivery; it is
acceptable for normal exit only when reaping and group absence independently
succeed. No nonzero group signal follows child reaping. Later ESRCH establishes
absence at that instant, not proof the group was never reused. Persistent groups
or permission ambiguity mean UNKNOWN and STOP. Escaped descendants, parent
SIGKILL/power loss and malicious host behavior remain outside the guarantee.

## Evidence and acceptance

Required files are `inputs.json`, `staging.json`, `process.json`,
`diagnostic.json`, `summary.json`, plus `completion.json`.

- Inputs bind the profile, Node, installed runtime, diagnostic, controller and
  helper hashes. Staging intent records the exclusive path and expected assets.
- Process evidence preserves the actual command, output, pid/pgid, return code,
  interruption/timeout flags and termination outcome.
- Successful diagnostic output is COMPILED_UNREVIEWED with four exact asset
  records. Only pglite.wasm/initdb.wasm say COMPILED. The other two records say
  NOT_REQUESTED. Capability booleans describe the source's intended scope, not
  independent tracing or proof about all Node/V8 internals.
- Summary is always PROVISIONAL. A passing result is not sufficient for acceptance.
- A completion candidate hashes the exact required file set after synchronized
  publication. Files use exclusive creation and the Phase A4 synchronized writer;
  publication errors never retry and never establish completion.
- Only after successful candidate synchronization can the controller flush a
  C2_FINALIZATION_RECEIPT containing its unique token and completion-file digest.
  The application boundary is the Phase A4 `application_finalized = True`
  assignment after cancellation checking. Interpreter shutdown is separate;
  SystemExit does not guarantee an exit-status override during teardown.

Independent acceptance requires all expected outcomes and matching actual hashes,
the matching preserved receipt, independently captured exit status exactly zero,
an explicit no-interruption/no-anomaly operator assessment and independent review
of the raw reports. `acceptance_ok()` checks manifest integrity/status gates; it
does not inspect every report semantically or automate independent review. Missing
or uncertain receipt/status/assessment, warnings, malformed JSON, partial evidence,
nonzero exits, or any mismatch mean UNKNOWN/INCOMPLETE, never PASS. Artifacts alone
cannot establish success. Unkeyed hashes do not establish authenticity.

If writing evidence fails, preserve partial files and terminal output; no cleanup
or retry follows. Preflight errors can occur before an evidence directory exists;
preserve their terminal output. If even terminal diagnostics fail, no acceptance
is possible. fsync acknowledges the filesystem contract, not every physical
power-loss/storage guarantee. No claim about PGlite initialization, PostgreSQL
version, SQL execution or reference completeness follows from a successful C2 run.

## Gate 1 mock verification

Inspect commands before running. These tests do not launch the real diagnostic:

```sh
python3 -B -m unittest discover -s backend/scripts -p test_phase4_runtime_assets.py -v
node --test backend/scripts/test-phase4-runtime-assets.cjs
```

No npm lifecycle scripts, dependency installation or database-enabled tests are
part of Gate 1. Syntax-only checking is allowed; real WASM compilation is not.

## Gate 2 command for separate review — NOT AUTHORIZED

First independently review the implementation, current file hashes, exact
command, trusted host assumptions and limits, then obtain separate owner approval
for one attempt. The acknowledgement flag is not an authorization source.

From `/Users/mishierukikutani/Nuudeltsgeey-Project-3`:

```sh
python3 -B backend/scripts/phase4-runtime-assets-controller.py --owner-approved-c2-diagnostic
phase4_c2_exit_status=$?
printf 'PHASE4_C2_EXIT_STATUS=%s\n' "$phase4_c2_exit_status"
```

Do not execute this command during Gate 1. Preserve all terminal output and the
immediately captured shell status. Never bypass sandbox failure, retry, change
the profile or remove a previous staging/evidence directory to make the run pass.
STOP after one attempt and evidence review. Any later PGlite import/initialization,
SQL, foundation capture, builder activation or disposal needs separate approval.

## Pre-execution hardening — mock implementation only

The successful mocked `main()` test runs the real staging/orchestration and
finalization logic with in-memory file publication, fake directory creation,
fake process results, and mocked signal installation. It verifies one launch,
minimal environment, staging intent, cleanup-before-publication ordering, the
complete evidence set, matching receipt and acceptance gates. It does not test
real filesystem synchronization or sandbox activation.

The Node `-e` routing test evaluates the diagnostic source and the exact reviewed
wrapper in a JavaScript VM with synthetic argv, fake filesystem/hash operations,
and fake WASM compilation. It exercises successful CLI setup, asset verification,
compilation-buffer identity and output publication. No diagnostic subprocess is
launched and no runtime bytes or actual WebAssembly compiler are used. A VM is a
test adapter, not an additional security boundary or sandbox enforcement proof.

Direct execution of the diagnostic file now refuses with exit code 2 and
DIRECT_DIAGNOSTIC_EXECUTION_DISABLED before accessing assets. Only the reviewed
controller invokes the exported CLI through verified-source `-e`. This prevents
accidental bypass; an operator able to execute arbitrary JavaScript can still
call exported functions. Approval is procedural, not established by a flag or
entry-point check.

Post-preflight summary failures retain allowlisted fixed controller Stop codes.
Other exceptions map to fixed generic interruption, I/O, invalid-evidence or
unexpected-failure codes; arbitrary exception text/classes are not published.
Finalization failures emit a sanitized C2_INCOMPLETE reason. If finalization
rejects an earlier failed run, its event reports DIAGNOSTIC_NOT_PASSED while the
preserved provisional summary retains the original sanitized cause. Preflight
failures still stop before staging and may precede evidence creation; preserve
terminal output as described above.

The diagnostic source pin changes with this hardening. The Phase B profile and
configuration, Node pin, runtime pins, existing helpers and disabled foundation
builder/worker remain unchanged. The previous Gate 2 source review covers the
old source hashes only. Fresh independent review of all changed files is required
before requesting separate approval for one real diagnostic attempt. None of the
commands in the proposed execution section is authorized by this hardening task.

## Targeted correction: pinned Node size verification

The initial Gate 3 attempt stopped before evidence/staging creation because the
248,201,648-byte pinned Node executable exceeded the generic 64 MiB input ceiling.
The generic `checked_read()` ceiling remains unchanged. `verify_node()` has no
path/size/hash override arguments: it verifies only `/usr/local/bin/node`, exact
size 248201648 and the existing Node SHA-256 pin. All three initial/pre-launch/
post-run Node checks use this dedicated verifier.

Node is opened read-only with O_NOFOLLOW/O_NONBLOCK after leaf and ancestor
symlink rejection. Descriptor metadata must show a regular root-owned file with
no group/world write bits. SHA-256 is accumulated through reads of at most 1 MiB,
with an extra one-byte EOF check; the executable is never retained in full memory.
Wrong size/hash, premature EOF, growth, changed device/inode/mode/owner/size/
timestamps, read/stat errors or descriptor-close errors reject verification.
No retry is introduced. Node is not executed by these verification routines.

The mock tests simulate the full advertised Node size with bounded synthetic
chunks and fake digest state; they never open or execute the real Node binary.
They also cover unsafe metadata, symlinks, I/O/close failure, all three call sites,
the unchanged generic limit, and preflight failure before evidence or launch.
The filesystem ancestor and executable-reopen races described above remain;
this does not establish a hostile-host or immutable-file guarantee.

Only controller/test/document hashes change. Node/runtime/sandbox/helper pins and
the disabled foundation builder/worker are preserved. Independent source review
of the correction and separate owner execution approval are required. This task
permits only offline Python mock regressions; it does not authorize Node, sandbox,
WASM, database or foundation-reference execution, or an automatic Gate 3 retry.
