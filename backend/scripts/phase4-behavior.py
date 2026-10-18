#!/usr/bin/env python3
"""Prepared only. Explicit approval required for committed synthetic behavior fixtures."""
import argparse
import ast
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import os
import tempfile
import time
import sys
import uuid
from urllib.request import Request, build_opener, ProxyHandler


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


guard = module('phase4_guard', 'phase4-preflight.py')
migration = module('phase4_migration', 'phase4-migrate.py')
EXPECTED_CATALOG_SHA256 = '88a5b13465ec1be32fb9f0e1265a8b8ec81f214e4b73e7b5633f0577a7752011'


def verify_catalog(metadata):
    digest = hashlib.sha256(json.dumps(metadata, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    guard.require(digest == EXPECTED_CATALOG_SHA256)


def verify_migrated(snapshot, checksums):
    migration.validate_ledger(snapshot['ledger'], migration.NAMES, checksums)
    # Exact enabled trigger names from the reviewed, checksum-pinned migration files.
    import re
    expected = []
    for name in migration.NAMES:
        sql = (guard.BACKEND / 'prisma/migrations' / name / 'migration.sql').read_text()
        expected += re.findall(r'CREATE(?: CONSTRAINT)? TRIGGER "([^"]+)"', sql)
    actual = snapshot['metadata']['triggers'] or []
    guard.require(sorted(t[1] for t in actual) == sorted(expected))
    guard.require(all(t[3] == 'O' for t in actual))
    guard.require(len({c[0] for c in snapshot['metadata']['columns']}) == 37)


def prepared_environment(url, expires):
    env = guard.child_environment(url)
    env.update(PHASE4_NATIVE_AUTHORIZED=guard.BRANCH, PHASE4_EXPIRES_AT=expires.isoformat(),
               PHASE4_RUN_ID='p4_' + uuid.uuid4().hex[:16], NODE_ENV='test')
    return env


CATEGORIES = set('NONE ASSERTION_FAILED DATABASE_CONSTRAINT SERIALIZATION_CONFLICT DEADLOCK LOCK_TIMEOUT STATEMENT_CANCELLED DATABASE_ERROR PRISMA_TRANSACTION_EXPIRED TLS_ERROR CONNECTIVITY_ERROR BARRIER_TIMEOUT TEST_TIMEOUT HOOK_TIMEOUT UNCLASSIFIED_ERROR'.split())
SQLSTATES = set('23505 23514 23503 23502 40001 40P01 55P03 57014 25P02'.split())


def safe_records(path):
    """Reconstruct from allowlists, never echo arbitrary reporter bytes or errors."""
    names = json.loads(Path(__file__).with_name('phase4-case-names.json').read_text())
    guard.require(path.stat().st_size <= 1048576)
    contract = json.loads(Path(__file__).with_name('phase4-duplicate-contract.json').read_text())
    records = []
    for line in path.read_text().splitlines()[:1000]:
        try:
            value = json.loads(line)
            if not isinstance(value, dict): continue
            event = value.get('event')
            if event not in ('run_started', 'case_started', 'case_result', 'run_end', 'duplicate_stage'): continue
            record = {'event': event}
            if event.startswith('case_') or event == 'duplicate_stage':
                ident = value.get('test_id')
                record['test'] = names.get(ident, 'UNKNOWN_TEST') if isinstance(ident, str) else 'UNKNOWN_TEST'
            for key, allowed in [('category', CATEGORIES), ('sqlstate', SQLSTATES), ('state', {'passed','failed','skipped','pending'})]:
                candidate = value.get(key)
                record[key] = candidate if isinstance(candidate, str) and candidate in allowed else None
            duration = value.get('duration_ms')
            record['duration_ms'] = round(duration) if type(duration) in (int, float) and 0 <= duration <= 86400000 else None
            start = value.get('start_ms')
            if event == 'case_started' and type(start) is int:
                record['elapsed_at_report_ms'] = max(0, min(86400000, round(time.time()*1000)-start))
            codes = value.get('prisma_codes', [])
            record['prisma_codes'] = [c for c in codes[:20] if isinstance(c, str) and c in contract['prisma_codes']] if isinstance(codes, list) else []
            if event == 'duplicate_stage':
                stage = value.get('assertion_stage')
                if value.get('test_id') != 'P4-N02' or stage not in contract['stages']: continue
                record['assertion_stage'] = stage
                for key in ['fixture_valid','trigger_verified','distinct_sessions','winner_team_valid','shared_player_only']:
                    if type(value.get(key)) is bool: record[key] = value[key]
                for key in ['registration_count','roster_count','duplicate_count','fulfilled_count','rejected_count']:
                    if type(value.get(key)) is int and 0 <= value[key] <= 10000: record[key] = value[key]
                session_ids = value.get('session_ids', [])
                record['session_ids'] = [n for n in session_ids[:2] if type(n) is int and 0 < n <= 2147483647] if isinstance(session_ids, list) else []
                outcomes = value.get('outcomes', [])
                record['outcomes'] = [v if v in contract['outcomes'] else 'unknown' for v in outcomes[:2]] if isinstance(outcomes, list) else []
                record['rejections'] = []
                rejections = value.get('rejections', [])
                for rejection in rejections[:2] if isinstance(rejections, list) else []:
                    if not isinstance(rejection, dict): continue
                    context = rejection.get('rejection_context')
                    safe = {'rejection_context': context if isinstance(context, str) and context in contract['contexts'] else 'UNATTRIBUTED', 'unexpected_code': rejection.get('unexpected_code') is not False}
                    for key in ['prisma_codes','sqlstates']:
                        values = rejection.get(key, [])
                        safe[key] = [v for v in values[:20] if isinstance(v, str) and v in contract[key]] if isinstance(values, list) else []
                    record['rejections'].append(safe)
            records.append(record)
        except (ValueError, TypeError): continue
    return records


def run_native(node, env):
    directory = Path(tempfile.mkdtemp(prefix='phase4-diagnostics-'))
    os.chmod(directory, 0o700)
    path = directory / 'sanitized.jsonl'
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    child = dict(env, PHASE4_DIAGNOSTICS_PATH=str(path))
    started = time.monotonic()
    failure = None
    try:
        guard.run_group([node, str(guard.BACKEND / 'node_modules/vitest/vitest.mjs'), 'run',
                         '--config', 'scripts/phase4-native.config.mts'], guard.BACKEND, child, timeout=2700)
    except (Exception, KeyboardInterrupt) as error:
        failure = error
    try:
        records = safe_records(path)
    except Exception:
        records = []
        failure = failure or ValueError()
    expected = set(json.loads(Path(__file__).with_name('phase4-case-names.json').read_text()).values())
    passed = [r['test'] for r in records if r['event'] == 'case_result' and r['state'] == 'passed']
    completed = (len(passed) == len(expected) and set(passed) == expected
                 and any(r['event'] == 'run_end' and r['state'] == 'passed' for r in records)
                 and not any(r['state'] == 'failed' or r.get('test') == 'UNKNOWN_TEST' for r in records))
    failure = failure or (None if completed else ValueError())
    category = getattr(failure, 'category', 'PROCESS_FAILED') if failure else 'NONE'
    if category not in {'NONE','PROCESS_FAILED','PROCESS_TIMEOUT','PROCESS_INTERRUPTED','PROCESS_CLEANUP_UNCONFIRMED'}: category = 'PROCESS_FAILED'
    summary = dict(process_category=category, duration_ms=round((time.monotonic()-started)*1000), records=records)
    # Replace with independently reconstructed safe records; no raw exception is retained.
    with path.open('w') as output:
        json.dump(summary, output)
        output.write('\n')
    print(json.dumps(summary))
    print('Sanitized diagnostics: ' + str(path))
    if failure:
        raise ValueError('Native suite incomplete; server outcome unknown; no retry or cleanup performed.') from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-approved-tests', action='store_true')
    args = parser.parse_args()
    guard.require(args.run_approved_tests and sys.stdin.isatty())
    guard.require(input('After owner approval, type the exact disposable branch ID: ') == guard.BRANCH)
    node = shutil.which('node'); guard.require(node is not None); guard.verify_engine(node)
    url = guard.bounded_url(guard.hidden_input('PHASE4_VALIDATION_DATABASE_URL (hidden): '))
    token = guard.hidden_input('Neon API key for read-only ownership checks (hidden): ')
    opener = build_opener(ProxyHandler({}), guard.NoRedirect())

    def identity():
        def read(path):
            request = Request('https://console.neon.tech/api/v2/projects/' + guard.PROJECT + path,
                              headers={'Authorization': 'Bearer ' + token}, method='GET')
            with opener.open(request, timeout=20) as response:
                return json.load(response)
        return guard.validate_metadata(read('/branches/' + guard.BRANCH)['branch'],
                                       read('/endpoints/' + guard.ENDPOINT)['endpoint'], datetime.now(timezone.utc))

    expires = identity()
    source = guard.BACKEND / 'prisma/migrations'
    guard.require(sorted(p.name for p in source.iterdir() if p.is_dir()) == migration.NAMES)
    sums = {name: hashlib.sha256((source / name / 'migration.sql').read_bytes()).hexdigest() for name in migration.NAMES}
    # Reuse the existing reviewed pins without invoking the migration entrypoint.
    pins = []
    for item in ast.walk(ast.parse(Path(migration.__file__).read_text())):
        if isinstance(item, ast.List):
            try:
                value = ast.literal_eval(item)
                if len(value) == 7 and all(isinstance(v, str) and len(v) == 64 for v in value): pins.append(value)
            except (ValueError, TypeError): pass
    guard.require(len(pins) == 1 and list(sums.values()) == pins[0])
    snapshot = guard.run_group([node, str(guard.BACKEND / 'scripts/phase4-schema-check.cjs'), 'remote'],
                               guard.BACKEND, guard.child_environment(url), decode=True)
    verify_migrated(snapshot, sums)
    verify_catalog(snapshot['metadata'])
    env = prepared_environment(url, identity())  # Fresh ownership/protection/expiry before fixture execution.
    run_native(node, env)
    print('PASS: prepared native behavior suite completed. Synthetic records remain on the disposable branch; no cleanup attempted.')


if __name__ == '__main__':
    try:
        with guard.execution_lock():
            main()
    except (Exception, KeyboardInterrupt):
        print('STOP: native suite incomplete; synthetic records may remain; server outcome unknown. No reset, retry or cleanup performed.', file=sys.stderr)
        sys.exit(1)
