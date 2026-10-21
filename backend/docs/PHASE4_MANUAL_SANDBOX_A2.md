# Phase A2 manual sandbox validation procedure — Phase A4 completion boundary

Status: prepared for review; Phase B has NOT been authorized or executed.
This procedure does not activate the foundation builder. No database, SQL,
PGlite, Neon or third-party runtime imports occur.

## Files and prerequisites

The complete procedure is `backend/scripts/phase4_manual_validation_a2.py`.
It imports only the corrected transport in
`backend/scripts/phase4_manual_controller_corrected.py` plus Python standard
library modules. The original preserved `retest.py` is not executed.

The unchanged sandbox profile is
`/private/tmp/phase4-isolation-retest-qwhtwx0c/corrected.sb`, SHA-256
`5585d1b138327d80ec67da77f9dcec9d50f827a49313ae22350e1d73f98c02d1`.
All pinned fixture hashes and the Node executable hash appear in the procedure's
`PINS` map. Symlink inputs/ancestors, missing inputs, changed hashes, invalid
fixed directories, or any existing `sandbox-config.json` cause STOP. The
configured runtime is exactly `/usr/local/bin/node`; no PATH lookup occurs.

## Proposed operator commands — NOT AUTHORIZED

First obtain separate explicit owner approval for one database-free manual
validation attempt in macOS Terminal. Review the complete files and compare
their hashes with the latest Phase A4 report. Merely passing the CLI flag below is not
owner authorization. Do not run this from the restricted agent environment or
attempt to bypass a sandbox activation failure.

Working directory: `/Users/mishierukikutani/Nuudeltsgeey-Project-3`.

```sh
cd /Users/mishierukikutani/Nuudeltsgeey-Project-3
shasum -a 256 backend/scripts/phase4_manual_controller_corrected.py backend/scripts/phase4_manual_validation_a2.py
python3 -B backend/scripts/phase4_manual_validation_a2.py --owner-approved-manual-validation
phase4_validation_status=$?
printf 'PHASE4_EXIT_STATUS=%s\n' "$phase4_validation_status"
```

Do not execute the validation command until approval is granted. Preserve its
terminal output and the immediately captured shell exit status. A missing exit
status or receipt makes the run INCOMPLETE; do not reconstruct either from the
artifact contents. No additional
arguments, credentials, `.env` loading, environment exports or dependency
installation are required. Children receive only LANG, LC_ALL, TZ and the fixed
scratch TMPDIR, constructed from literals. Parent credentials are not copied.

## Complete sequence and comparison with the earlier procedure

1. Verify fixed fixture/profile/runtime pins and configuration absence.
2. Allocate a fresh exclusive private `/private/tmp/phase4-owner-validation-a2-*`
   evidence directory; print its path. Never reuse an old directory.
3. Run the unsandboxed Node startup control, then sandboxed Node startup.
4. Bind TCP and UDP positive-control listeners to `127.0.0.1` only. Exclusively
   create the control configuration in the new evidence directory and the fixed
   sandbox configuration at the exact path permitted by the unchanged profile.
5. Run the preserved synthetic probe without sandbox to establish successful
   approved/denied/mock-env reads, inside/outside writes, subprocess execution,
   TCP and UDP delivery. Verify receipt at the local listeners and the absence
   of all six credential/environment keys.
6. Run one sandboxed operation per process, stopping immediately on an unexpected
   result: approved read; denied read; mock `.env` denial; scratch write;
   outside write denial; subprocess denial; TCP denial; UDP denial; credential
   isolation. Permission denials require EPERM or EACCES. ENOENT, connection
   refusal, timeout, malformed output, unexpected exits and other errors are
   failures or UNKNOWN, never evidence of successful isolation.
7. Run the preserved probe's supported `wait` mode. Require the exact marker,
   actual timeout, confirmed SIGKILL delivery, exit -9, child reaping and verified
   process-group absence. No other outcome passes this test.
8. Finish socket cleanup, publish a provisional summary, then a completion
   candidate and terminal receipt using the protocol below. Preserve all evidence
   and the shell exit status for independent review. No single artifact means PASS.

All original isolation categories are retained. The corrected transport covers
successful Popen return with cleanup even on selector/pipe setup failure.
Termination occurs before report publication. Pipe and selector cleanup failures
cannot silently skip remaining cleanup. Unconfirmed termination is UNKNOWN.
Normal completion requires exit 0, matching stdout, empty stderr, reaping and
group absence; it does not require successful signal delivery. EPERM is retained
as unconfirmed delivery and is never sufficient for timeout success.

## Evidence and STOP procedure

Every configuration, probe report, summary and completion candidate uses exclusive
creation with mode 0600. Success requires full write, flush, file fsync, successful
close and parent-directory fsync. The evidence directory's creation is also
synchronized in its parent before probes run. Unsupported directory sync or any
write/flush/fsync/close/publication failure stops the attempt; no fallback relaxes
these checks. The partial file remains preserved and unaccepted. A close error
does not cause a blind descriptor-close retry, which could affect a reused descriptor.

The fresh evidence directory has mode 0700. Unique write targets use UUID names
and Node's `wx` flag. No existing file is truncated or deleted. The fixed fixture
paths are retained because relocating them would invalidate the reviewed profile.
The new evidence directory itself does not need sandbox access; only the
unsandboxed positive control reads its control configuration.

On any unexpected permission, sandbox activation failure, interruption, timeout
failure, unknown group state or publication error: STOP. Ctrl-C requests
cancellation without interrupting Popen bookkeeping. Do not rerun. Do not remove
the configuration. Preserve the printed evidence directory, terminal output,
fixed profile, fixtures, newly created configuration and any write targets.
Request review. Do not send signals to a saved PID/PGID manually; it may have
been reused. If per-probe publication fails, the procedure attempts to print the
in-memory report to stderr. Finalization failures emit an INCOMPLETE/UNKNOWN
diagnostic and return nonzero; save terminal output manually without
overwriting existing evidence. Partial files remain preserved. Failure diagnostics
are best effort if the terminal itself fails; diagnostic failure never permits
exit zero or acceptance.

## Finalization protocol, version 1

1. All probe reports and configurations must first return successfully from the
   synchronized exclusive writer. Child termination and socket cleanup finish
   before finalization begins. The expected set is exactly 13 probe reports,
   input pins, the control configuration and the fixed sandbox configuration.
2. `summary.json` is always `state: PROVISIONAL`. Its `probe_result: PASSED`
   means only that the probe logic completed. Its existence, readable contents
   or apparent success is never a finalized PASS.
3. After successful summary publication, hash the exact required file set. Then
   exclusively publish `completion.json`, with `state: COMPLETION_CANDIDATE`,
   protocol version, a unique token and the hashes of every required file,
   including the summary. Only after its write/flush/fsync/close/directory-sync
   operations return successfully may the procedure issue a terminal receipt.
4. Check cancellation after summary publication and again after completion
   publication. Before emitting a receipt, switch from flag-only cancellation
   to raising SystemExit during ordinary application execution. The finalizer
   catches that exception and returns nonzero. If cancellation was already
   requested, STOP. This covers application execution and evidence publication;
   it is not a guarantee about interpreter teardown.
5. Flush the `FINALIZATION_RECEIPT` line containing the token and completion-file
   digest. After output returns successfully with flush=True, call
   `mark_application_complete()`. That method checks cancellation and sets
   `application_finalized = True`. **This assignment is the exact application-
   finalization boundary.** All required evidence synchronization, child/socket
   cleanup and receipt publication precede it. The flag is internal state, not
   a persisted PASS assertion. The receipt alone cannot prove the boundary was
   crossed; failure between receipt output and the boundary still rejects the run.
   A zero application return is possible only after this boundary. Python's
   subsequent `sys.exit(main())` and interpreter shutdown are separate stages.
6. Independent acceptance requires **all** of: the actual complete file set and
   matching hashes; the provisional passed summary; a matching completion
   candidate; the preserved matching terminal receipt; and the independently
   captured exit status exactly zero; an independent operator assessment of no
   observed interruption or shutdown anomaly; and independent review of the
   complete evidence. `acceptance_ok()` expresses the integrity
   and completeness predicate for parsed artifacts and actual file hashes; it
   does not read files or generate missing receipts/statuses. No other output,
   file existence or claimed outcome substitutes for these conditions. Any
   missing/uncertain element means UNKNOWN/INCOMPLETE, never PASS. Its required
   assessment is supplied explicitly as `interruption_observed=False`; the
   default None and True both reject acceptance. This assessment must not be
   inferred from artifacts or a zero status. The predicate does not automate
   independent review or detect every signal/shutdown event.

The SIGINT handler remains installed after the application boundary on a best-
effort basis. Raising SystemExit in ordinary application code normally requests
nonzero termination; during interpreter teardown it may be ignored or reported
as an unraisable exception. **No guaranteed exit-status override during teardown
is claimed.** A post-boundary interruption, shutdown warning, ambiguous timing,
missing transcript, or uncertain status makes the attempt UNKNOWN/INCOMPLETE
even if artifacts appear complete and the shell reports zero. Preserve all
evidence and request review; never retry or accept from artifacts alone. An
unobserved late signal is outside the guarantee. The code does not install an
atexit callback, use os._exit, or claim mock tests establish shutdown behavior.

`fixed-sandbox-config.json` in the manifest is a logical name for the unchanged
fixed `sandbox-config.json` path, not an additional file in the evidence directory.
Nothing is overwritten, deleted or renamed on failed publication. Even a fully
readable candidate left by an fsync/close failure remains unaccepted without a
valid receipt and zero exit status. This is deliberately a multi-part completion
protocol, not a self-authenticating PASS file. Unkeyed hashes do not protect
against hostile same-user rewriting of all artifacts and the transcript.

## Limits

Mock unit tests establish controller/orchestration decisions, not macOS sandbox
enforcement. No real sandbox activation, localhost probe or runtime execution
has been performed during Phase A2/A3/A4. Post-reaping group checks use only signal 0.
The controller polls until ESRCH or its deadline; later ESRCH confirms absence
at the time checked, but cannot prove the group was never reused in between.
A group still present at the deadline or a permission-ambiguous check blocks
success. No nonzero signal targets a reaped leader's potentially reused group.
Trusted synthetic
probes must not escape their dedicated group. Parent SIGKILL, power loss, hostile
same-user file races, or arbitrary descendants escaping the group are outside
this controller's guarantees. Normal stdout EOF followed by a still-running
leader can conservatively produce an unexpected -9 and STOP.

SIGKILL cannot be handled. A killed process, shell crash or power loss before
independently preserved successful exit status leaves the run INCOMPLETE, even
if completion candidates or receipts survived. If all acceptance evidence and
the completed zero exit were already preserved, a later unrelated power loss
does not retroactively classify that completed run as interrupted. File and
directory fsync acknowledge the OS/filesystem contract; they do not prove
physical durability against every storage-controller, filesystem or hardware
failure. Lost, corrupt or uncertain evidence always invalidates acceptance.
No claim of crash recovery or sandbox enforcement is established by mock tests.

An attempt that creates the fixed configuration consumes that setup even if it
fails. Reusing or relocating the setup requires another reviewed plan and owner
approval; this procedure never removes it automatically. Passing these probes
only permits independent review. It does not validate PGlite-specific filesystem
needs, authorize database execution or enable the foundation builder.
