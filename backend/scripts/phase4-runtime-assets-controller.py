#!/usr/bin/env python3
"""Prepared C2 Gate 2 command. Gate 1 permits mock tests ONLY; do not run main.

No runtime imports, database creation, SQL, network or automatic deletion.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import sys
import tempfile
import uuid

from phase4_manual_controller_corrected import run_probe, completion_ok
from phase4_manual_validation_a2 import ManualCancellation, check_cancelled, save_exclusive, sync_directory, Stop as HelperStop

SCRIPTS = Path(__file__).resolve().parent
RUNTIME = SCRIPTS.parent / 'node_modules/@electric-sql/pglite'
ROOT = Path('/private/tmp/phase4-isolation-retest-qwhtwx0c')
SCRATCH = ROOT / 'scratch'
PROFILE = ROOT / 'corrected.sb'
NODE = Path('/usr/local/bin/node')
NODE_SIZE = 248201648
NODE_READ_CHUNK = 1024 * 1024
DIAGNOSTIC = SCRIPTS / 'phase4-runtime-assets-diagnostic.cjs'
PROFILE_PIN = '5585d1b138327d80ec67da77f9dcec9d50f827a49313ae22350e1d73f98c02d1'
NODE_PIN = '49098713938c2537a0cbca663d79b427b8faeed50c34de1e89177778d4c447e8'
TREE_PIN = '805fb863067224ff810f1f5739cd52a19a7a60059b4a43da79b431dc9ccad7ea'
# Set to the reviewed source digest after local implementation; never an override.
DIAGNOSTIC_PIN = '026fe88c8090ff434392ef2e59dbf15a2b808fa3b73adb17b090c8a89bffa30e'
HELPERS = {
    SCRIPTS / 'phase4_manual_controller_corrected.py': '570e89a6442e3d011113a1ba4b305258fe3c3be3a0d27400da931f15f557b535',
    SCRIPTS / 'phase4_manual_validation_a2.py': 'a7a4d79fc17d481d7cf42de618b90153920bec61a7af8423fe8a80926f1291ff',
}
ASSETS = {
    'index.cjs': (2066577, '64bc0b76b47b72ec1665a9569998751064dc36fe51bffa5d8717ce233631f021'),
    'pglite.wasm': (10498455, '864c7651fe2f23c38ff9e047a0b8851af0a5dbcbbb244a6a985bc254f274659e'),
    'initdb.wasm': (300129, 'b33b41af366b4f7909085bb360b37587e5fa57a26113d84c21f23f9bfd63c0f8'),
    'pglite.data': (6248214, '12384e109f1cea6edb978550d0445f8958ad4089cbbe3222d657f56e2e817d4b'),
}
REQUIRED = frozenset({'inputs.json', 'staging.json', 'process.json', 'diagnostic.json', 'summary.json'})
TIMEOUT = 180


class Stop(RuntimeError):
    pass


def require(condition, code):
    if not condition:
        raise Stop(code)


# Only reviewed literal codes are publishable; never echo arbitrary exceptions,
# paths, OS messages or dynamically named exception classes into audit evidence.
FAILURE_CODES = frozenset({
    'ASSET_PIN_MISMATCH',
    'ASSET_RESULTS_INCOMPLETE',
    'DIAGNOSTIC_INCOMPLETE',
    'DIAGNOSTIC_NOT_PASSED',
    'DIAGNOSTIC_TOO_LARGE',
    'DUPLICATE_JSON_KEY',
    'INPUT_CHANGED_DURING_READ',
    'INPUT_HASH_MISMATCH',
    'INPUT_SIZE_MISMATCH',
    'INPUT_TYPE_OR_SIZE',
    'INVALID_INPUT_PATH',
    'INVALID_RUNTIME',
    'INVALID_SCRATCH',
    'MACOS_REQUIRED',
    'MISSING_ASSET',
    'NODE_OWNER_OR_PERMISSIONS',
    'NODE_SHORT_READ',
    'NODE_GREW_DURING_READ',
    'PROCESS_OR_TERMINATION_UNKNOWN',
    'RUNTIME_SYMLINK',
    'RUNTIME_TREE_MISMATCH',
    'SANDBOX_UNAVAILABLE',
    'SHORT_STAGING_WRITE',
    'STAGING_ASSET_ENTRIES',
    'STAGING_ENTRIES',
    'STAGING_PATH_REJECTED',
    'STAGING_SYMLINK',
    'SYMLINK_INPUT',
    'UNEXPECTED_CAPABILITY',
    'UNEXPECTED_TEMPORARY_WRITES',
})


def failure_code(exc):
    if type(exc) is HelperStop and exc.args == ('INTERRUPTED',):
        return 'INTERRUPTED'
    if type(exc) is Stop and len(exc.args) == 1 and type(exc.args[0]) is str and exc.args[0] in FAILURE_CODES:
        return exc.args[0]
    if isinstance(exc, (KeyboardInterrupt, SystemExit)):
        return 'INTERRUPTED'
    if isinstance(exc, OSError):
        return 'FILESYSTEM_OR_IO_FAILURE'
    if isinstance(exc, (ValueError, TypeError, KeyError, AttributeError)):
        return 'INVALID_EVIDENCE_OR_RESULT'
    return 'UNEXPECTED_FAILURE'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, indent=2) + '\n').encode()


def checked_read(path, pin=None, size=None):
    path = Path(path)
    require(path.is_absolute() and '..' not in path.parts, 'INVALID_INPUT_PATH')
    require(not any(item.is_symlink() for item in (path, *path.parents)), 'SYMLINK_INPUT')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and 0 <= info.st_size <= 64 * 1024 * 1024, 'INPUT_TYPE_OR_SIZE')
        if size is not None:
            require(info.st_size == size, 'INPUT_SIZE_MISMATCH')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            data = stream.read(info.st_size + 1)
        after = os.fstat(fd)
        require(len(data) == info.st_size and info.st_size == after.st_size and
                info.st_mtime_ns == after.st_mtime_ns and info.st_ctime_ns == after.st_ctime_ns,
                'INPUT_CHANGED_DURING_READ')
        if pin is not None:
            require(sha(data) == pin, 'INPUT_HASH_MISMATCH')
        return data
    finally:
        os.close(fd)


def verify_node():
    """Verify only the fixed pinned executable, without retaining its full bytes."""
    require(not any(item.is_symlink() for item in (NODE, *NODE.parents)), 'SYMLINK_INPUT')
    fd = os.open(NODE, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode), 'INPUT_TYPE_OR_SIZE')
        require(before.st_size == NODE_SIZE, 'INPUT_SIZE_MISMATCH')
        require(before.st_uid == 0 and not (before.st_mode & 0o022), 'NODE_OWNER_OR_PERMISSIONS')
        digest = hashlib.sha256()
        remaining = NODE_SIZE
        while remaining:
            chunk = os.read(fd, min(NODE_READ_CHUNK, remaining))
            require(0 < len(chunk) <= min(NODE_READ_CHUNK, remaining), 'NODE_SHORT_READ')
            digest.update(chunk)
            remaining -= len(chunk)
        require(os.read(fd, 1) == b'', 'NODE_GREW_DURING_READ')
        after = os.fstat(fd)
        fields = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
        require(all(getattr(before, field) == getattr(after, field) for field in fields),
                'INPUT_CHANGED_DURING_READ')
        require(digest.hexdigest() == NODE_PIN, 'INPUT_HASH_MISMATCH')
    finally:
        os.close(fd)


def verify_inputs():
    require(sys.platform == 'darwin', 'MACOS_REQUIRED')
    require(Path('/usr/bin/sandbox-exec').is_file(), 'SANDBOX_UNAVAILABLE')
    require(SCRATCH.is_dir() and not SCRATCH.is_symlink(), 'INVALID_SCRATCH')
    checked_read(PROFILE, PROFILE_PIN)
    verify_node()
    for path, pin in HELPERS.items():
        checked_read(path, pin)
    source = checked_read(DIAGNOSTIC, DIAGNOSTIC_PIN)
    require(len(source) <= 32768, 'DIAGNOSTIC_TOO_LARGE')
    require(RUNTIME.is_dir() and not RUNTIME.is_symlink(), 'INVALID_RUNTIME')
    hashes, assets = {}, {}
    for directory, directories, files in os.walk(RUNTIME, followlinks=False):
        require(not any((Path(directory) / name).is_symlink() for name in directories), 'RUNTIME_SYMLINK')
        for name in files:
            path = Path(directory) / name
            data = checked_read(path)
            relative = path.relative_to(RUNTIME).as_posix()
            hashes[relative] = sha(data)
            if relative in {'dist/' + item for item in ASSETS}:
                assets[name] = data
    require(len(hashes) == 308 and sha(json.dumps(hashes, sort_keys=True, separators=(',', ':')).encode())
            == TREE_PIN, 'RUNTIME_TREE_MISMATCH')
    require(set(assets) == set(ASSETS), 'MISSING_ASSET')
    for name, (size, pin) in ASSETS.items():
        require(len(assets[name]) == size and sha(assets[name]) == pin, 'ASSET_PIN_MISMATCH')
    return source, assets


def write_new(path, data, mode=0o400):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        with os.fdopen(fd, 'wb', closefd=False) as stream:
            require(stream.write(data) == len(data), 'SHORT_STAGING_WRITE')
            stream.flush()
            os.fsync(fd)
    finally:
        os.close(fd)
    sync_directory(Path(path).parent)


def stage_inputs(source, assets, on_created):
    stage = Path(tempfile.mkdtemp(prefix='phase4-c2-assets-', dir=SCRATCH))
    # Record ownership/location before any staging writes that might fail.
    on_created(stage)
    sync_directory(SCRATCH)
    (stage / 'assets').mkdir(mode=0o700)
    (stage / 'tmp').mkdir(mode=0o700)
    write_new(stage / 'diagnostic.cjs', source)
    for name in ASSETS:
        write_new(stage / 'assets' / name, assets[name])
    sync_directory(stage)
    verify_stage(stage)
    return stage


def verify_stage(stage):
    require(stage.parent == SCRATCH and stage.name.startswith('phase4-c2-assets-') and
            not stage.is_symlink(), 'STAGING_PATH_REJECTED')
    require({p.name for p in stage.iterdir()} == {'assets', 'tmp', 'diagnostic.cjs'}, 'STAGING_ENTRIES')
    require(not (stage / 'assets').is_symlink() and not (stage / 'tmp').is_symlink(), 'STAGING_SYMLINK')
    require({p.name for p in (stage / 'assets').iterdir()} == set(ASSETS), 'STAGING_ASSET_ENTRIES')
    require(not list((stage / 'tmp').iterdir()), 'UNEXPECTED_TEMPORARY_WRITES')
    checked_read(stage / 'diagnostic.cjs', DIAGNOSTIC_PIN)
    for name, (size, pin) in ASSETS.items():
        checked_read(stage / 'assets' / name, pin, size)


def command_for(stage, source):
    # Execute the already hash-verified source string, NOT a reopened JS path.
    # The staged index.cjs is never evaluated or required.
    return ['/usr/bin/sandbox-exec', '-f', str(PROFILE), str(NODE), '-e',
            source.decode('utf8') + '\nvoid module.exports.cli(process.argv.slice(1));\n',
            '--', '--owner-approved-c2-assets', str(stage), DIAGNOSTIC_PIN]


def parse_diagnostic(report):
    require(completion_ok(report, expected_stdout=report.get('stdout')), 'PROCESS_OR_TERMINATION_UNKNOWN')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'DUPLICATE_JSON_KEY')
            result[key] = value
        return result
    value = json.loads(report['stdout'], object_pairs_hook=unique)
    require(set(value) == {'protocol', 'scope', 'status', 'assets', 'capabilities'} and
            type(value['protocol']) is int and value['protocol'] == 1 and
            value['scope'] == 'ASSET_READ_AND_WASM_COMPILE_ONLY' and
            value['status'] == 'COMPILED_UNREVIEWED', 'DIAGNOSTIC_INCOMPLETE')
    capabilities = {'pglite_imported', 'wasm_instantiated', 'database_initialized', 'sql_executed', 'network_requested'}
    require(type(value['capabilities']) is dict and set(value['capabilities']) == capabilities and
            all(v is False for v in value['capabilities'].values()), 'UNEXPECTED_CAPABILITY')
    expected = [dict(name=name, bytes=size, sha256=pin, read_verified=True,
                     compilation='COMPILED' if name.endswith('.wasm') else 'NOT_REQUESTED')
                for name, (size, pin) in ASSETS.items()]
    require(type(value['assets']) is list and value['assets'] == expected and
            all(type(row['bytes']) is int and row['read_verified'] is True for row in value['assets']),
            'ASSET_RESULTS_INCOMPLETE')
    return value


def perform(evidence, cancellation, source, assets):
    def record_stage(stage):
        print('Preserve C2 staging:', stage, flush=True)
        save_exclusive(evidence / 'staging.json', {'state': 'STAGING_INTENT', 'directory': str(stage),
                        'diagnostic_sha256': DIAGNOSTIC_PIN,
                        'assets': {name: dict(bytes=size, sha256=pin) for name, (size, pin) in ASSETS.items()}})
    stage = stage_inputs(source, assets, record_stage)
    check_cancelled(cancellation)
    checked_read(PROFILE, PROFILE_PIN)
    verify_node()
    verify_stage(stage)
    environment = {'LANG': 'C', 'LC_ALL': 'C', 'TZ': 'UTC', 'TMPDIR': str(stage / 'tmp')}
    report = run_probe(command_for(stage, source), environment, stage, cancellation, timeout=TIMEOUT)
    # run_probe always completes its cleanup attempts before evidence publication.
    save_exclusive(evidence / 'process.json', report)
    result = parse_diagnostic(report)
    check_cancelled(cancellation)
    verify_stage(stage)
    checked_read(PROFILE, PROFILE_PIN)
    verify_node()
    save_exclusive(evidence / 'diagnostic.json', result)


def finalize(evidence, summary, cancellation, *, emit=print):
    try:
        check_cancelled(cancellation)
        save_exclusive(evidence / 'summary.json', summary)
        require(summary['result'] == 'PASSED', 'DIAGNOSTIC_NOT_PASSED')
        check_cancelled(cancellation)
        hashes = {name: sha(checked_read(evidence / name)) for name in sorted(REQUIRED)}
        check_cancelled(cancellation)
        completion = dict(protocol=1, state='COMPLETION_CANDIDATE', token=uuid.uuid4().hex,
                          required_files=sorted(REQUIRED), files=hashes)
        save_exclusive(evidence / 'completion.json', completion)
        check_cancelled(cancellation)
        digest = sha(checked_read(evidence / 'completion.json'))
        cancellation.arm_terminal_phase()
        emit(json.dumps(dict(event='C2_FINALIZATION_RECEIPT', token=completion['token'],
                             completion_sha256=digest)), flush=True)
        cancellation.mark_application_complete()
        return 0
    except BaseException as exc:
        try:
            emit(json.dumps(dict(event='C2_INCOMPLETE', state='UNKNOWN', reason=failure_code(exc))),
                 file=sys.stderr, flush=True)
        except BaseException:
            pass
        return 1


def acceptance_ok(summary, completion, receipt, status, hashes, *, interruption_observed=None):
    try:
        return (interruption_observed is False and type(status) is int and status == 0 and
                summary['state'] == 'PROVISIONAL' and summary['result'] == 'PASSED' and
                summary['builder_enabled'] is False and summary['database_execution'] is False and
                type(completion['protocol']) is int and completion['protocol'] == 1 and
                completion['state'] == 'COMPLETION_CANDIDATE' and
                set(hashes) == REQUIRED | {'completion.json'} and
                set(completion['required_files']) == REQUIRED and len(completion['required_files']) == len(REQUIRED) and
                completion['files'] == {k: v for k, v in hashes.items() if k != 'completion.json'} and
                sha(encoded(summary)) == hashes['summary.json'] and
                sha(encoded(completion)) == hashes['completion.json'] and
                receipt == dict(event='C2_FINALIZATION_RECEIPT', token=completion['token'],
                                completion_sha256=hashes['completion.json']))
    except (KeyError, TypeError, AttributeError):
        return False


class PrivateParser(argparse.ArgumentParser):
    def error(self, _message):
        self.exit(2, 'INVALID_C2_DIAGNOSTIC_ARGUMENTS\n')


def main(argv=None):
    parser = PrivateParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--owner-approved-c2-diagnostic', action='store_true', required=True)
    parser.parse_args(argv)
    # This acknowledgement is not an authorization source. Gate 2 approval is separate.
    source, assets = verify_inputs()
    evidence = Path(tempfile.mkdtemp(prefix='phase4-c2-evidence-', dir='/private/tmp'))
    print('Preserve C2 evidence:', evidence, flush=True)
    cancellation = ManualCancellation()
    signal.signal(signal.SIGINT, cancellation.handle_sigint)
    summary = dict(protocol=1, state='PROVISIONAL', result='UNKNOWN',
                   builder_enabled=False, database_execution=False)
    try:
        sync_directory(evidence.parent)
        save_exclusive(evidence / 'inputs.json', dict(profile_sha256=PROFILE_PIN, node_sha256=NODE_PIN,
                       runtime_tree_sha256=TREE_PIN, diagnostic_sha256=DIAGNOSTIC_PIN,
                       controller_sha256=sha(checked_read(Path(__file__).resolve())),
                       helper_sha256={path.name: pin for path, pin in HELPERS.items()},
                       scope='ASSET_READ_AND_WASM_COMPILE_ONLY'))
        perform(evidence, cancellation, source, assets)
        check_cancelled(cancellation)
        summary['result'] = 'PASSED'
    except BaseException as exc:
        summary['reason'] = failure_code(exc)
    return finalize(evidence, summary, cancellation)


if __name__ == '__main__':
    sys.exit(main())
