#!/usr/bin/env python3
"""Prepared foundation-only builder. Only --check-plan is operational.

No executable CLI path creates a database. Authority validation and sandbox
enforcement must be independently installed/reviewed before future activation.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import tempfile

import phase4_foundation_reference_queries as reference_queries

BACKEND = Path(__file__).resolve().parents[1]
FOUNDATION = BACKEND / 'prisma/migrations/20261012003031_foundation/migration.sql'
WORKER = BACKEND / 'scripts/phase4-foundation-reference-worker.cjs'
RUNTIME = BACKEND / 'node_modules/@electric-sql/pglite'
FOUNDATION_PIN = 'a8ae6fd95d38a2ea0192d471485e2fdf6abcb54f683d8ad0025bfd68088d73bc'
RUNTIME_PIN = '805fb863067224ff810f1f5739cd52a19a7a60059b4a43da79b431dc9ccad7ea'
QUERY_PIN = 'e222f922c259cb219ff88370cf8f47126230360606b9fe701b522aa56d46fca7'
ARTIFACT_PINS = {
    'dist/pglite.wasm': '864c7651fe2f23c38ff9e047a0b8851af0a5dbcbbb244a6a985bc254f274659e',
    'dist/initdb.wasm': 'b33b41af366b4f7909085bb360b37587e5fa57a26113d84c21f23f9bfd63c0f8',
    'dist/index.cjs': '64bc0b76b47b72ec1665a9569998751064dc36fe51bffa5d8717ce233631f021',
}
MAX_BYTES = 8 * 1024 * 1024
WORKER_SECONDS = 180


def require(condition, code='REFERENCE_INPUT_REJECTED'):
    if not condition:
        raise ValueError(code)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False)


def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else canonical(value).encode()).hexdigest()


def read_file(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_size <= 64 * MAX_BYTES)
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            return stream.read(64 * MAX_BYTES + 1)
    finally:
        os.close(fd)


def verify_foundation(path=FOUNDATION):
    require(Path(path).absolute() == FOUNDATION.absolute(), 'WRONG_MIGRATION_SELECTION')
    raw = read_file(path)
    require(digest(raw) == FOUNDATION_PIN, 'FOUNDATION_HASH_MISMATCH')
    return raw.decode('utf-8')


def verify_runtime(root=RUNTIME):
    require(Path(root).absolute() == RUNTIME.absolute(), 'WRONG_RUNTIME_SELECTION')
    require(not root.is_symlink(), 'RUNTIME_SYMLINK')
    files = {}
    # Enumerate ONLY this pinned dependency, never migration directories.
    for directory, directories, names in os.walk(root, followlinks=False):
        for name in directories:
            require(not (Path(directory) / name).is_symlink(), 'RUNTIME_SYMLINK')
        for name in names:
            path = Path(directory) / name
            files[path.relative_to(root).as_posix()] = digest(read_file(path))
    require(files and digest(files) == RUNTIME_PIN, 'RUNTIME_DIGEST_MISMATCH')
    require(all(files.get(name) == expected for name, expected in ARTIFACT_PINS.items()), 'RUNTIME_DIGEST_MISMATCH')
    require(json.loads(read_file(root / 'package.json'))['version'] == '0.5.10', 'RUNTIME_VERSION_MISMATCH')
    return {'package_version': '0.5.10', 'tree_sha256': RUNTIME_PIN}


def prepare_request():
    sql = verify_foundation()
    runtime = verify_runtime()
    bundle = reference_queries.validate()
    require(digest(bundle) == QUERY_PIN, 'REFERENCE_QUERY_HASH_MISMATCH')
    return {'format_version': 1, 'foundation': {'name': '20261012003031_foundation',
            'sha256': FOUNDATION_PIN, 'sql': sql}, 'runtime': runtime,
            'queries': bundle, 'mode': 'fresh-memory-foundation-only'}


def minimal_environment(scratch):
    require(Path(scratch).is_absolute() and '://' not in str(scratch))
    # Never copy os.environ, HOME, PATH, NODE_OPTIONS, PG*, URL or API settings.
    return {'LANG': 'C', 'LC_ALL': 'C', 'TZ': 'UTC', 'TMPDIR': str(scratch)}


def sandbox_profile(node, staged_files, scratch):
    """Narrow startup corrections only; NOT a validated isolation attestation.

    Exact dynamic-library reads must be reviewed on the designated host. No broad
    home/repository grants, networking, process fork, shell or child command grants.
    """
    paths = [Path(node), Path(scratch), *(Path(p) for p in staged_files)]
    require(all(p.is_absolute() and '://' not in str(p) and '..' not in p.parts
                and all(ord(c) >= 32 and ord(c) != 127 for c in str(p)) for p in paths))
    require(Path(scratch) != Path('/') and Path(node) != Path('/'))
    require(all(Path(p) != Path('/') for p in staged_files))
    require(Path(scratch) not in [Path(node), *(Path(p) for p in staged_files)])
    quote = lambda p: json.dumps(str(p))
    reads = '\n'.join('(allow file-read* (literal ' + quote(p) + '))' for p in paths if p != Path(scratch))
    # Ancestors receive metadata ONLY, never recursive content-read permission.
    ancestors = sorted({parent for p in paths for parent in p.parents if parent != Path('/')}, key=str)
    metadata = '(allow file-read-metadata ' + ' '.join('(literal ' + quote(p) + ')' for p in ancestors) + ')'
    return ('(version 1)\n(deny default)\n' + reads
            + '\n(allow process-exec (literal ' + quote(node) + '))'
            + '\n(allow file-read* file-write* (subpath ' + quote(scratch) + '))'
            + '\n(allow file-read* file-test-existence (literal "/"))'
            + '\n(allow file-read* (literal "/System/Library/OpenSSL/openssl.cnf"))'
            + '\n(allow sysctl-read (sysctl-name "hw.pagesize_compat"))'
            + ('\n' + metadata if ancestors else '')
            + '\n(deny network*)\n(deny process-fork)'
            + '\n(deny file-read* file-write* (regex #"(^|/)[.]env([^/]*)?$"))\n')


def require_execution_authority(_approval=None, _sandbox_evidence=None):
    # Deliberately no trusted key, receipt parser, activation flag or environment
    # override yet. A claimed validated=true/owner_approved=true is not evidence.
    raise ValueError('EXECUTION_DISABLED_PENDING_INDEPENDENT_APPROVAL')


def worker_limits():
    """Dormant child limits, only used by a future independently approved launch."""
    import resource
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_BYTES, MAX_BYTES))
    resource.setrlimit(resource.RLIMIT_CPU, (120, 120))


def _bounded_transport(command, request, scratch):
    require_execution_authority()  # Also guards direct calls to the transport.
    # command/staged files/profile must be constructed and bound by a future
    # validated activation adapter; no CLI accepts arbitrary commands or paths.
    with tempfile.TemporaryFile(dir=scratch) as output, tempfile.TemporaryFile(dir=scratch) as errors:
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=output, stderr=errors,
                                   cwd=scratch, env=minimal_environment(scratch),
                                   start_new_session=True, preexec_fn=worker_limits)
        try:
            process.communicate(canonical(request).encode(), timeout=WORKER_SECONDS)
        except BaseException:
            try:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                raise ValueError('WORKER_TERMINATION_UNCONFIRMED') from None
            raise ValueError('WORKER_FAILED_NO_RETRY') from None
        require(process.returncode == 0, 'WORKER_FAILED_NO_RETRY')
        output.seek(0)
        raw = output.read(MAX_BYTES + 1)
        require(len(raw) <= MAX_BYTES, 'ARTIFACT_TOO_LARGE')
        return json.loads(raw, object_pairs_hook=unique_pairs)


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'DUPLICATE_JSON_KEY')
        result[key] = value
    return result


def validate_artifact(artifact, request):
    require(isinstance(artifact, dict) and set(artifact) == {
        'format', 'format_version', 'status', 'exact_match_enabled', 'reference_complete',
        'provenance', 'coverage', 'application', 'environment', 'generated_objects',
        'ledger', 'review_required', 'integrity'}, 'ARTIFACT_INVALID')
    require(artifact['format'] == 'phase4-foundation-reference'
            and type(artifact['format_version']) is int and artifact['format_version'] == 1)
    require(artifact['status'] == 'UNREVIEWED' and artifact['exact_match_enabled'] is False
            and artifact['reference_complete'] is False, 'ARTIFACT_NOT_UNREVIEWED')
    provenance = artifact['provenance']
    require(set(provenance) == {'foundation_sha256', 'query_sha256', 'runtime_tree_sha256',
                               'package_version', 'engine', 'creation_search_path', 'capture_search_path'})
    require(provenance['foundation_sha256'] == FOUNDATION_PIN and provenance['query_sha256'] == QUERY_PIN
            and provenance['runtime_tree_sha256'] == RUNTIME_PIN and provenance['package_version'] == '0.5.10')
    engine = provenance['engine']
    require(engine['server_version_num'] == '180006' and engine['engine_version'].startswith('PostgreSQL 18.6 '))
    require(provenance['creation_search_path'] == ['public', 'pg_catalog']
            and provenance['capture_search_path'] == ['pg_catalog'])
    require(artifact['coverage'] == dict.fromkeys(request['queries']['queries'], 'CAPTURED_UNREVIEWED'))
    for group, ids in [('application', 'application_ids'), ('environment', 'environment_ids')]:
        expected_ids = set(request['queries'][ids])
        if group == 'environment':
            expected_ids.add('application_security')
        require(set(artifact[group]) == expected_ids, 'ARTIFACT_COVERAGE_INCOMPLETE')
        for key, rows in artifact[group].items():
            if key == 'application_security':
                continue
            require(type(rows) is list and len(rows) <= 20000)
            fields = set(request['queries']['row_fields'][key])
            if group == 'application':
                fields -= set(request['queries']['security_fields'])
            require(all(type(row) is dict and set(row) == fields for row in rows), 'ARTIFACT_ROW_INCOMPLETE')
    app, environment = artifact['application'], artifact['environment']
    security = environment['application_security']
    security_ids = {key for key in app if set(request['queries']['row_fields'][key]) & set(request['queries']['security_fields'])}
    require(type(security) is dict and set(security) == security_ids)
    for key in security_ids:
        require(type(security[key]) is list and len(security[key]) == len(app[key]))
        fields = set(request['queries']['row_fields'][key]) & set(request['queries']['security_fields'])
        for structural, observations in zip(app[key], security[key]):
            require(type(observations) is dict and set(observations) == {'identity', 'observations'})
            require(set(observations['observations']) == fields)
            require(observations['identity'] == {k: value for k, value in structural.items()
                                                if k in request['queries']['identity_fields']})
    require(len([r for r in app['Q2_relations'] if r['relkind'] == 'r']) == 26, 'ARTIFACT_TABLE_COUNT')
    require(len(app['Q3_columns']) == 192 and len(app['Q4_indexes']) == 52
            and len(app['Q5_enums']) == 67, 'ARTIFACT_COUNTS_INCOMPLETE')
    identity = environment['Q1_identity']
    require(len(identity) == 1 and identity[0]['read_only'] == 'on'
            and identity[0]['isolation'] == 'repeatable read', 'ARTIFACT_TRANSACTION_UNSAFE')
    require(artifact['generated_objects'] == {
        'types': artifact['application']['R_type_relationships'],
        'constraints': artifact['application']['R_constraint_links'],
        'indexes': artifact['application']['R_index_details'],
        'triggers': artifact['application']['R_trigger_links']})
    require(artifact['ledger'] == {'state': 'ABSENT', 'count': None, 'structure': 'NOT_DEFINED_BY_FOUNDATION'})
    require(artifact['review_required'] == ['SEMANTIC_COVERAGE', 'NORMALIZATION', 'PLATFORM_SECURITY',
                                          'LEDGER_BASELINE', 'INDEPENDENT_OWNER_REVIEW'])
    integrity = artifact['integrity']
    require(set(integrity) == {'algorithm', 'payload_sha256', 'authenticity'})
    require(integrity['algorithm'] == 'sha256' and integrity['authenticity'] == 'NOT_ATTESTED')
    require(integrity['payload_sha256'] == digest({k: v for k, v in artifact.items() if k != 'integrity'}), 'ARTIFACT_INTEGRITY')
    require(len(canonical(artifact).encode()) <= MAX_BYTES)
    return artifact


def execute_reference(*_args, **_kwargs):
    require_execution_authority()
    # Staging, independently attested sandbox activation, credential-free dynamic
    # library allowlist and approved output custody are intentionally NOT active.
    raise ValueError('EXECUTION_TRANSPORT_NOT_ACTIVATED')


class PrivateParser(argparse.ArgumentParser):
    def error(self, _message):
        self.exit(2, 'INVALID_REFERENCE_BUILDER_ARGUMENTS\n')


def main(argv=None):
    parser = PrivateParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--check-plan', action='store_true', required=True)
    parser.parse_args(argv)
    try:
        request = prepare_request()
        print(canonical({'status': 'EXECUTION_BLOCKED', 'foundation_sha256': FOUNDATION_PIN,
                         'runtime_tree_sha256': RUNTIME_PIN, 'query_sha256': QUERY_PIN,
                         'queries': len(request['queries']['queries']), 'sandbox_enforcement': 'UNVERIFIED',
                         'execution_authority': 'NOT_INSTALLED', 'artifact_status': 'NOT_GENERATED'}))
        return 3
    except (OSError, ValueError, TypeError, KeyError, RecursionError):
        print(canonical({'status': 'EXECUTION_BLOCKED', 'reason': 'REFERENCE_INPUT_OR_PIN_REJECTED'}))
        return 3


if __name__ == '__main__':
    sys.exit(main())
