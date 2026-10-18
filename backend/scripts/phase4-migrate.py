#!/usr/bin/env python3
"""Prepared guarded execution. Requires separate owner approval before invocation."""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile
from urllib.request import Request, build_opener, ProxyHandler

spec = importlib.util.spec_from_file_location('phase4_guard', Path(__file__).with_name('phase4-preflight.py'))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
NAMES = ['20261012003031_foundation', '20261016093000_identity_authority',
         '20261016103000_identity_hardening', '20261016120000_tournament_configuration',
         '20261016150000_registration_lock', '20261016170000_final_attendance_governance',
         '20261016190000_phase4_database_invariants']


def validate_ledger(rows, expected, checksums):
    guard.require([r['migration_name'] for r in rows] == expected)
    for row in rows:
        guard.require(row['checksum'] == checksums[row['migration_name']])
        guard.require(bool(row['finished_at']) and row['rolled_back_at'] is None)


def validate_schema(actual, expected):
    # PostgreSQL 18 exposes NOT NULL constraints separately; column flags already check them.
    # Use PostgreSQL-rendered metadata on both sides; any unexplained difference stops execution.
    guard.require(actual == expected)


def cli_environment(url):
    return {**guard.child_environment(url), 'DATABASE_URL': guard.validate_url(url),
            'PRISMA_HIDE_UPDATE_MESSAGE': 'true'}


def execute_sequence(identity, remote, command, reference, checksums):
    identity()
    before = remote()
    validate_ledger(before['ledger'], [], checksums)
    validate_schema(before['metadata'], reference['foundation'])
    identity()
    command(['migrate', 'resolve', '--applied', NAMES[0], '--schema', 'prisma/schema.prisma'])
    baseline = remote()
    validate_ledger(baseline['ledger'], NAMES[:1], checksums)
    validate_schema(baseline['metadata'], reference['foundation'])
    identity()
    command(['migrate', 'deploy', '--schema', 'prisma/schema.prisma'])
    after = remote()
    validate_ledger(after['ledger'], NAMES, checksums)
    validate_schema(after['metadata'], reference['final'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute-approved-rehearsal', action='store_true')
    args = parser.parse_args()
    guard.require(args.execute_approved_rehearsal and sys.stdin.isatty())
    guard.require(input('After owner approval, type the validation branch ID to enable writes: ') == guard.BRANCH)
    backend = guard.BACKEND
    guard.require(json.loads((backend/'node_modules/prisma/package.json').read_text())['version']=='6.19.3')
    node = shutil.which('node')
    guard.require(node is not None)
    guard.verify_engine(node)
    # No ambient URL is read. Values are fresh, hidden and held in memory only.
    url = guard.bounded_url(guard.hidden_input('PHASE4_VALIDATION_DATABASE_URL (hidden): '))
    token = guard.hidden_input('Neon API key (hidden): ')
    guard.require(bool(token))
    opener = build_opener(ProxyHandler({}), guard.NoRedirect())

    def identity():
        def read(path):
            request=Request('https://console.neon.tech/api/v2/projects/'+guard.PROJECT+path,
                            headers={'Authorization':'Bearer '+token},method='GET')
            with opener.open(request,timeout=20) as response:
                return json.load(response)
        branch=read('/branches/'+guard.BRANCH)['branch']
        endpoint=read('/endpoints/'+guard.ENDPOINT)['endpoint']
        guard.validate_metadata(branch,endpoint,datetime.now(timezone.utc))

    env=guard.child_environment(url)
    helper=backend/'scripts/phase4-schema-check.cjs'

    def run(argv, cwd, child_env, decode=False):
        return guard.run_group(argv, cwd, child_env, decode=decode)

    # Freeze repository input into a private workspace containing NO credentials or .env files.
    source=backend/'prisma/migrations'
    guard.require(sorted(p.name for p in source.iterdir() if p.is_dir())==NAMES)
    with tempfile.TemporaryDirectory(prefix='nuudeltsgeey-phase4-') as directory:
        workspace=Path(directory)
        guard.require(not list(workspace.glob(".env*")))
        shutil.copytree(source,workspace/'prisma/migrations')
        shutil.copyfile(backend/'prisma/schema.prisma',workspace/'prisma/schema.prisma')
        migrations=workspace/'prisma/migrations'
        checksums={name:hashlib.sha256((migrations/name/'migration.sql').read_bytes()).hexdigest() for name in NAMES}
        guard.require(list(checksums.values()) == ['a8ae6fd95d38a2ea0192d471485e2fdf6abcb54f683d8ad0025bfd68088d73bc', '031afe0e48408fe46a517f7defae219d12b0f4bd09cfd416cbecb2e56c1eb07b', '9422261b8cbe4a86f09601d163aecc9f15a0465d89b094346678e43e0774262a', '30df24fceee8eea8e02934a3e04e75223d2b66270bd5f152150a3a6b566b1296', 'be091cdbc4d8cd92e086792c0f29bb191ac05dec6db7de0636dea3026ec82fa0', '66edc04a2b802a27acd73056562ad37f398d4fd0437fc9833f666f4766b3a254', '3e015ab70b016845c35453414f935311c3183b89929ba56fc4918a5442225136'])
        reference=run([node,str(helper),'reference',str(migrations)],workspace,{k:v for k,v in env.items() if k!='PHASE4_VALIDATION_DATABASE_URL'},True)
        cli=[node,str(backend/'node_modules/prisma/build/index.js')]
        cli_env=cli_environment(url)
        execute_sequence(identity,
                         lambda: run([node,str(helper),'remote'],workspace,env,True),
                         lambda args: run(cli+args,workspace,cli_env),reference,checksums)
        print('PASS: seven migration records/checksums and final schema, constraints, indexes, enums, functions and triggers verified.')


if __name__=='__main__':
    try:
        with guard.execution_lock():
            main()
    except (Exception, KeyboardInterrupt):
        print('STOP: rehearsal did not complete. No reset or repair attempted. Prior writes may remain; server activity/outcome unknown; diagnostics suppressed.',file=sys.stderr)
        sys.exit(1)
