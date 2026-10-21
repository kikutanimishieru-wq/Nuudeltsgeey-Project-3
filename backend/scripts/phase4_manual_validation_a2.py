"""Complete database-free manual procedure; NEVER run without owner approval.

Import defines functions only. No builder imports, SQL, third-party modules or
external destinations. No cleanup/deletion. A failed attempt is never retried.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import sys
import tempfile
import uuid

from phase4_manual_controller_corrected import Cancellation, completion_ok, run_probe

ROOT = Path('/private/tmp/phase4-isolation-retest-qwhtwx0c')
NODE = '/usr/local/bin/node'
SANDBOX = '/usr/bin/sandbox-exec'
CONFIG = ROOT / 'sandbox-config.json'
PINS = {
    ROOT / 'corrected.sb': '5585d1b138327d80ec67da77f9dcec9d50f827a49313ae22350e1d73f98c02d1',
    ROOT / 'reviewed-expected.sb': '5585d1b138327d80ec67da77f9dcec9d50f827a49313ae22350e1d73f98c02d1',
    ROOT / 'probe.cjs': '1efb758ca63c13722291b4f8104c17907fc3b3db1576ac1d013595f9bb9893d9',
    ROOT / 'approved.txt': '03375ca59d2bc8d8cad41a86a2cecc320f17eff013322723cb7bbfb225f3fed5',
    ROOT / 'denied.txt': '3eba3889f78f50ee7b49296b138d70bd7d355e8bdda77fe54c99da2163ef8c13',
    ROOT / 'scratch/.env.mock': 'ab25d583d4a5841469d66f5f9cc58c36579316a5853fbf04078286aa2cc14aed',
    Path(NODE): '49098713938c2537a0cbca663d79b427b8faeed50c34de1e89177778d4c447e8',
}
CREDENTIAL_KEYS = ['DATABASE_URL', 'DIRECT_URL', 'PGPASSWORD', 'NEON_API_KEY', 'NODE_OPTIONS', 'HOME']
CHECKS = ('approved_read', 'denied_read', 'mock_env_read', 'permitted_write',
          'outside_write', 'subprocess', 'localhost_tcp', 'localhost_udp', 'credentials')
DENIED = {'denied_read', 'mock_env_read', 'outside_write', 'subprocess', 'localhost_tcp', 'localhost_udp'}
REPORT_NAMES = ('startup-control', 'startup-sandbox', 'positive-control', *CHECKS, 'timeout')
REQUIRED_FILES = frozenset({'input-pins.json', 'control-config.json',
                            'fixed-sandbox-config.json', 'summary.json'} |
                           {str(i) + '-' + name + '.json'
                            for i, name in enumerate(REPORT_NAMES, 1)})


class Stop(RuntimeError):
    pass


class ManualCancellation(Cancellation):
    """Application cancellation only; interpreter teardown is outside its guarantee."""
    terminal_phase = False
    application_finalized = False

    def handle_sigint(self, signum, frame):
        self.requested = True
        if self.terminal_phase:
            # During ordinary application execution finalize catches this and
            # returns nonzero. During interpreter shutdown it is best effort:
            # SystemExit is not a guaranteed override of the process exit status.
            raise SystemExit(130)

    def arm_terminal_phase(self):
        # A signal before this assignment sets requested; a signal afterwards
        # raises during ordinary application execution, including publication.
        self.terminal_phase = True
        if self.requested:
            raise Stop('INTERRUPTED')

    def mark_application_complete(self):
        if not self.terminal_phase:
            raise Stop('FINALIZATION_NOT_ARMED')
        check_cancelled(self)
        # THE APPLICATION-FINALIZATION BOUNDARY. Required evidence is synced,
        # receipt output has returned with flush=True, and cancellation was
        # checked. This is NOT interpreter shutdown or proof of process exit.
        self.application_finalized = True


def verify_inputs(*, pins=None, config=CONFIG):
    # lexists includes dangling symlinks. Never replace a previous config.
    if os.path.lexists(config):
        raise Stop('EXISTING_CONFIGURATION_NO_RETRY')
    for path, expected in (PINS if pins is None else pins).items():
        path = Path(path)
        for ancestor in (path, *path.parents):
            if ancestor.is_symlink():
                raise Stop('SYMLINK_INPUT')
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise Stop('PIN_MISMATCH:' + path.name)
    for path in (ROOT, ROOT / 'scratch'):
        if path.is_symlink() or not path.is_dir():
            raise Stop('INVALID_FIXED_DIRECTORY')


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def save_exclusive(path, value):
    """Return only after write, flush, fsync, close and namespace sync succeed.

    On any exception leave the partial file untouched. Its existence is never a
    publication acknowledgement. No deletion, rename, overwrite or retry.
    """
    payload = (json.dumps(value, indent=2) + '\n').encode('utf8')
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        stream = os.fdopen(fd, 'wb')
    except BaseException:
        os.close(fd)
        raise
    try:
        if stream.write(payload) != len(payload):
            raise Stop('SHORT_EVIDENCE_WRITE')
        stream.flush()
        os.fsync(stream.fileno())
    finally:
        stream.close()
    sync_directory(Path(path).parent)


def check_cancelled(cancellation):
    if cancellation.requested:
        raise Stop('INTERRUPTED')


def acceptance_ok(summary, completion, receipt, exit_status, actual_hashes, *,
                  interruption_observed=None):
    """Offline review predicate. No file's existence or claimed state suffices.

    Receipt and exit status must be independently preserved by the operator;
    never reconstruct them from the files after a crash. Authenticity against
    hostile modification is not provided by these unkeyed integrity digests.
    interruption_observed must be an independent operator assessment, including
    post-boundary/teardown anomalies. Unknown (the default) or observed
    interruption rejects acceptance, even when exit_status is zero.
    """
    try:
        return (interruption_observed is False and
                type(exit_status) is int and exit_status == 0 and
                summary['state'] == 'PROVISIONAL' and
                summary['probe_result'] == 'PASSED' and
                completion['state'] == 'COMPLETION_CANDIDATE' and
                completion['protocol'] == 1 and
                receipt['event'] == 'FINALIZATION_RECEIPT' and
                receipt['token'] == completion['token'] and
                receipt['completion_sha256'] == actual_hashes['completion.json'] and
                hashlib.sha256((json.dumps(completion, indent=2) + '\n').encode()).hexdigest()
                == actual_hashes['completion.json'] and
                set(actual_hashes) == REQUIRED_FILES | {'completion.json'} and
                hashlib.sha256((json.dumps(summary, indent=2) + '\n').encode()).hexdigest()
                == actual_hashes['summary.json'] and
                completion['files'] == {k: v for k, v in actual_hashes.items()
                                        if k != 'completion.json'} and
                set(completion['files']) == set(completion['required_files']) and
                len(completion['required_files']) == len(set(completion['required_files'])))
    except (KeyError, TypeError, AttributeError):
        return False


def finalize(evidence, summary, cancellation, required_paths, *, emit=print):
    """A candidate marker is valid only with a matching receipt AND exit zero.

    SIGINT handled during application execution/publication rejects completion
    and never rewrites candidates. Successful mark_application_complete defines
    the application boundary. A later handler remains best effort, with no claim
    that SystemExit controls interpreter teardown or the eventual process status.
    """
    try:
        check_cancelled(cancellation)
        save_exclusive(evidence / 'summary.json', summary)
        check_cancelled(cancellation)
        if summary['probe_result'] != 'PASSED':
            raise Stop('PROBES_INCOMPLETE')
        paths = dict(required_paths)
        paths['summary.json'] = evidence / 'summary.json'
        if set(paths) != REQUIRED_FILES:
            raise Stop('INCOMPLETE_REQUIRED_EVIDENCE')
        hashes = {name: hashlib.sha256(path.read_bytes()).hexdigest()
                  for name, path in paths.items()}
        check_cancelled(cancellation)
        completion = dict(protocol=1, state='COMPLETION_CANDIDATE', token=uuid.uuid4().hex,
                          required_files=sorted(paths), files=hashes)
        save_exclusive(evidence / 'completion.json', completion)
        check_cancelled(cancellation)
        digest = hashlib.sha256((evidence / 'completion.json').read_bytes()).hexdigest()
        cancellation.arm_terminal_phase()
        emit(json.dumps(dict(event='FINALIZATION_RECEIPT', token=completion['token'],
                             completion_sha256=digest)), flush=True)
        cancellation.mark_application_complete()
        return 0
    except BaseException as exc:
        # Publication or diagnostic failure must never turn into exit zero.
        try:
            emit(json.dumps(dict(event='INCOMPLETE', state='UNKNOWN',
                                 reason=type(exc).__name__ + ':' + str(exc))),
                 file=sys.stderr, flush=True)
        except BaseException:
            pass
        return 1


def minimal_environment():
    # Construct from literals; never copy os.environ (even when it is synthetic).
    return {'LANG': 'C', 'LC_ALL': 'C', 'TZ': 'UTC', 'TMPDIR': str(ROOT / 'scratch')}


def probe_source(check):
    """One restriction per process: a denial failure stops subsequent probes."""
    prelude = ('const fs=require("node:fs");const c=JSON.parse(fs.readFileSync(' +
               json.dumps(str(CONFIG)) + ',"utf8"));' +
               'const emit=x=>process.stdout.write(JSON.stringify(x)+"\\n");' +
               'const fail=e=>emit({allowed:false,code:e.code||"OTHER"});')
    operations = {
        'approved_read': 'if(fs.readFileSync(c.approved,"utf8")!=="SYNTHETIC_APPROVED")throw Error("BAD_FIXTURE");',
        'denied_read': 'fs.readFileSync(c.denied,"utf8");',
        'mock_env_read': 'fs.readFileSync(c.mockEnv,"utf8");',
        'permitted_write': 'fs.writeFileSync(c.permittedWrite,"SYNTHETIC_WRITE",{flag:"wx",mode:384});',
        'outside_write': 'fs.writeFileSync(c.outsideWrite,"SYNTHETIC_WRITE",{flag:"wx",mode:384});',
        'subprocess': 'const p=require("node:child_process").spawnSync("/usr/bin/true",[],{env:{},timeout:700,stdio:"ignore"});if(p.error)throw p.error;if(p.status!==0)throw Error("UNEXPECTED_EXIT");',
    }
    if check in operations:
        return prelude + 'try{' + operations[check] + 'emit({allowed:true});}catch(e){fail(e);}'
    if check == 'credentials':
        return prelude + 'emit({presence:Object.fromEntries(' + json.dumps(CREDENTIAL_KEYS) + '.map(k=>[k,Object.hasOwn(process.env,k)]))});'
    if check == 'localhost_tcp':
        return prelude + '''const s=require('node:net').createConnection({host:'127.0.0.1',port:c.tcpPort});
let done=false;const finish=x=>{if(!done){done=true;s.destroy();emit(x);}};
s.setTimeout(700,()=>finish({allowed:null,code:'TIMEOUT'}));
s.once('connect',()=>finish({allowed:true}));s.once('error',e=>finish({allowed:false,code:e.code||'OTHER'}));'''
    if check == 'localhost_udp':
        return prelude + '''let s,done=false;const finish=x=>{if(!done){done=true;clearTimeout(t);if(s){try{s.close();}catch{}}emit(x);}};
const t=setTimeout(()=>finish({allowed:null,code:'TIMEOUT'}),700);
try{s=require('node:dgram').createSocket('udp4');s.once('error',e=>finish({allowed:false,code:e.code||'OTHER'}));
s.send(Buffer.from('PHASE4_LOCALHOST_PROBE'),c.udpPort,'127.0.0.1',e=>finish(e?{allowed:false,code:e.code||'OTHER'}:{allowed:true}));}catch(e){finish({allowed:false,code:e.code||'OTHER'});}'''
    raise Stop('UNKNOWN_CHECK')


def permission_ok(value, allowed):
    return (value.get('allowed') is allowed and
            (allowed or value.get('code') in ('EPERM', 'EACCES')))


def orchestrate(ops):
    """Injectable orchestration: tests supply a completely synthetic adapter."""
    ops.startup(False)
    ops.startup(True)
    baseline = ops.control()
    for check in CHECKS:
        if check == 'credentials':
            if baseline.get('credential_presence') != dict.fromkeys(CREDENTIAL_KEYS, False):
                raise Stop('CONTROL_CREDENTIAL_ISOLATION_UNKNOWN')
        elif not permission_ok(baseline.get(check, {}), True):
            raise Stop('CONTROL_UNKNOWN:' + check)
    ops.confirm_local_delivery()
    for check in CHECKS:
        value = ops.check(check)
        if check == 'credentials':
            passed = value.get('presence') == dict.fromkeys(CREDENTIAL_KEYS, False)
        else:
            passed = permission_ok(value, check not in DENIED)
        if not passed:
            raise Stop('FAIL_OR_UNKNOWN:' + check)
    ops.timeout()


class ManualOperations:
    def __init__(self, evidence, cancellation):
        self.evidence, self.cancellation = evidence, cancellation
        self.environment = minimal_environment()
        self.tcp = self.udp = None
        self.sequence = 0
        self.required_paths = {}

    def publish(self, label, path, value):
        save_exclusive(path, value)
        self.required_paths[label] = path

    def run(self, name, command, *, expected=None, timeout_expected=False):
        report = run_probe(command, self.environment, ROOT, self.cancellation,
                           timeout=1 if timeout_expected else 4)
        self.sequence += 1
        # Child cleanup already completed before publication can fail.
        try:
            label = str(self.sequence) + '-' + name + '.json'
            self.publish(label, self.evidence / label, report)
        except BaseException:
            print(json.dumps({'publication': 'UNKNOWN', 'report': report}), file=sys.stderr)
            raise Stop('EVIDENCE_PUBLICATION_UNKNOWN')
        if not completion_ok(report, expected_stdout=report.get('stdout') if expected is None else expected,
                             timeout_expected=timeout_expected):
            raise Stop('PROCESS_OR_TERMINATION_UNKNOWN:' + name)
        return report['stdout']

    def startup(self, sandboxed):
        command = [NODE, '-e', 'process.stdout.write("STARTUP_OK\\n")']
        if sandboxed:
            command = [SANDBOX, '-f', str(ROOT / 'corrected.sb'), *command]
        self.run('startup-sandbox' if sandboxed else 'startup-control', command, expected='STARTUP_OK\n')

    def control(self):
        self.tcp = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.tcp.settimeout(1)
        self.tcp.bind(('127.0.0.1', 0))
        self.tcp.listen(1)
        self.udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.udp.settimeout(1)
        self.udp.bind(('127.0.0.1', 0))
        run_id = uuid.uuid4().hex
        def configuration(label):
            return dict(approved=str(ROOT / 'approved.txt'), denied=str(ROOT / 'denied.txt'),
                        mockEnv=str(ROOT / 'scratch/.env.mock'),
                        permittedWrite=str(ROOT / 'scratch' / (run_id + '-' + label)),
                        outsideWrite=str(ROOT / (run_id + '-' + label)),
                        tcpPort=self.tcp.getsockname()[1], udpPort=self.udp.getsockname()[1])
        control = self.evidence / 'control-config.json'
        self.publish('control-config.json', control, configuration('control'))
        self.publish('fixed-sandbox-config.json', CONFIG, configuration('sandbox'))
        return json.loads(self.run('positive-control', [NODE, str(ROOT / 'probe.cjs'), str(control)]))

    def confirm_local_delivery(self):
        connection, address = self.tcp.accept()
        connection.close()
        data, sender = self.udp.recvfrom(128)
        if address[0] != '127.0.0.1' or sender[0] != '127.0.0.1' or data != b'PHASE4_LOCALHOST_PROBE':
            raise Stop('LOCAL_DELIVERY_UNKNOWN')

    def check(self, check):
        return json.loads(self.run(check, [SANDBOX, '-f', str(ROOT / 'corrected.sb'),
                                          NODE, '-e', probe_source(check)]))

    def timeout(self):
        self.run('timeout', [SANDBOX, '-f', str(ROOT / 'corrected.sb'), NODE,
                            str(ROOT / 'probe.cjs'), 'wait'],
                 expected='PROBE_WAIT_STARTED\n', timeout_expected=True)

    def close(self):
        errors = []
        for sock in (self.tcp, self.udp):
            if sock is not None:
                try:
                    sock.close()
                except BaseException as exc:
                    errors.append(type(exc).__name__)
        if errors:
            raise Stop('SOCKET_CLEANUP_UNKNOWN:' + ','.join(errors))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--owner-approved-manual-validation', action='store_true', required=True)
    parser.parse_args(argv)
    # This acknowledgement is NOT an authorization source. Obtain owner approval.
    verify_inputs()
    evidence = Path(tempfile.mkdtemp(prefix='phase4-owner-validation-a2-', dir='/private/tmp'))
    print('Preserve evidence:', evidence, flush=True)
    cancellation = ManualCancellation()
    # Retained as best effort after the application boundary; not a guarantee
    # about interpreter teardown. This CLI does not restore embedded handlers.
    signal.signal(signal.SIGINT, cancellation.handle_sigint)
    ops = ManualOperations(evidence, cancellation)
    summary = dict(builder_enabled=False, database_execution=False,
                   protocol=1, state='PROVISIONAL', probe_result='UNKNOWN')
    try:
        sync_directory(evidence.parent)
        ops.publish('input-pins.json', evidence / 'input-pins.json',
                    {str(path): digest for path, digest in PINS.items()})
        orchestrate(ops)
        check_cancelled(cancellation)
        if ops.sequence != 13 or len(ops.required_paths) != 16:
            raise Stop('INCOMPLETE_REPORT_SET')
        summary['probe_result'] = 'PASSED'
    except BaseException as exc:
        summary['reason'] = str(exc)
    finally:
        try:
            ops.close()
        except BaseException as exc:
            summary.update(probe_result='UNKNOWN', cleanup_error=str(exc))
        if cancellation.requested:
            summary.update(probe_result='UNKNOWN', reason='INTERRUPTED')
    return finalize(evidence, summary, cancellation, ops.required_paths)


if __name__ == '__main__':
    sys.exit(main())
