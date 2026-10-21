"""Offline mock-only builder tests. Never launches a sandbox or database."""
import contextlib
import copy
import importlib.util
import io
from pathlib import Path
import socket
import subprocess
import sys
import unittest
from unittest.mock import Mock, patch
import urllib.request

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location('reference_builder', SCRIPTS / 'phase4-build-foundation-reference.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


def request():
    # Uses source bytes and static query data only, never a database.
    return {'format_version': 1, 'mode': 'fresh-memory-foundation-only',
            'foundation': {'name': '20261012003031_foundation', 'sha256': b.FOUNDATION_PIN,
                           'sql': b.FOUNDATION.read_text()},
            'queries': b.reference_queries.validate(),
            'runtime': {'package_version': '0.5.10', 'tree_sha256': b.RUNTIME_PIN}}


def simulated_artifact():
    """Synthetic boundary fixture only: no database or exact-reference claim."""
    q = request()['queries']
    app = {key: [] for key in q['application_ids']}
    env = {key: [] for key in q['environment_ids']}
    for key, count in [('Q2_relations', 26), ('Q3_columns', 192), ('Q4_indexes', 52), ('Q5_enums', 67)]:
        app[key] = [{field: None for field in q['row_fields'][key] if field not in q['security_fields']}
                    for _ in range(count)]
    for i, row in enumerate(app['Q2_relations']):
        row.update(schema_name='public', relname='MOCK_TABLE_' + str(i), relkind='r')
    env['Q1_identity'] = [dict.fromkeys(q['row_fields']['Q1_identity'])]
    env['Q1_identity'][0].update(read_only='on', isolation='repeatable read')
    env['application_security'] = {}
    for key, rows in app.items():
        fields = set(q['row_fields'][key]) & set(q['security_fields'])
        if fields:
            env['application_security'][key] = [{'identity': {k: v for k, v in row.items() if k in q['identity_fields']},
                                                  'observations': dict.fromkeys(fields)} for row in rows]
    artifact = {'format': 'phase4-foundation-reference', 'format_version': 1, 'status': 'UNREVIEWED',
                'exact_match_enabled': False, 'reference_complete': False,
                'provenance': {'foundation_sha256': b.FOUNDATION_PIN, 'query_sha256': b.QUERY_PIN,
                               'runtime_tree_sha256': b.RUNTIME_PIN, 'package_version': '0.5.10',
                               'engine': {'server_version_num': '180006', 'engine_version': 'PostgreSQL 18.6 MOCK'},
                               'creation_search_path': ['public', 'pg_catalog'], 'capture_search_path': ['pg_catalog']},
                'coverage': dict.fromkeys(q['queries'], 'CAPTURED_UNREVIEWED'),
                'application': app, 'environment': env,
                'generated_objects': {'types': app['R_type_relationships'], 'constraints': app['R_constraint_links'],
                                      'indexes': app['R_index_details'], 'triggers': app['R_trigger_links']},
                'ledger': {'state': 'ABSENT', 'count': None, 'structure': 'NOT_DEFINED_BY_FOUNDATION'},
                'review_required': ['SEMANTIC_COVERAGE', 'NORMALIZATION', 'PLATFORM_SECURITY',
                                    'LEDGER_BASELINE', 'INDEPENDENT_OWNER_REVIEW']}
    artifact['integrity'] = {'algorithm': 'sha256', 'payload_sha256': b.digest(artifact), 'authenticity': 'NOT_ATTESTED'}
    return artifact


class ReferenceBuilderTests(unittest.TestCase):
    def test_foundation_hash(self):
        self.assertEqual(b.digest(b.verify_foundation().encode()), b.FOUNDATION_PIN)

    def test_foundation_hash_mismatch(self):
        with patch.object(b, 'read_file', return_value=b'wrong'):
            with self.assertRaisesRegex(ValueError, 'FOUNDATION_HASH_MISMATCH'):
                b.verify_foundation()

    def test_other_migration_or_directory_rejected_before_read(self):
        with patch.object(b, 'read_file') as read:
            for path in [b.FOUNDATION.parent.parent, b.FOUNDATION.with_name('other.sql'),
                         b.BACKEND / 'prisma/migrations/20261016190000_phase4_database_invariants/migration.sql']:
                with self.assertRaisesRegex(ValueError, 'WRONG_MIGRATION_SELECTION'):
                    b.verify_foundation(path)
            read.assert_not_called()

    def test_runtime_tree_and_version_pins(self):
        self.assertEqual(b.verify_runtime()['tree_sha256'], b.RUNTIME_PIN)

    def test_runtime_digest_mismatch(self):
        with patch.object(b.os, 'walk', return_value=[(str(b.RUNTIME), [], ['package.json'])]), \
             patch.object(b, 'read_file', return_value=b'wrong'):
            with self.assertRaisesRegex(ValueError, 'RUNTIME_DIGEST_MISMATCH'):
                b.verify_runtime()

    def test_runtime_symlink_rejected(self):
        with patch.object(Path, 'is_symlink', return_value=True):
            with self.assertRaisesRegex(ValueError, 'RUNTIME_SYMLINK'):
                b.verify_runtime()

    def test_query_bundle_integrity_and_sections(self):
        q = b.reference_queries.validate()
        self.assertEqual(b.digest(q), b.QUERY_PIN)
        self.assertEqual(len(q['queries']), 25)
        self.assertNotIn('Q1_tls', q['queries'])
        self.assertNotIn('Q8_ledger_count', q['queries'])
        self.assertIn('R_trigger_links', q['queries'])
        self.assertIn('R_type_relationships', q['queries'])
        self.assertEqual(set(q['queries']), set(q['row_fields']))

    def test_changed_query_rejected(self):
        q = copy.deepcopy(b.reference_queries.bundle())
        q['queries']['R_environment'] = 'SELECT evil()'
        with patch.object(b.reference_queries, 'validate', return_value=q), \
             patch.object(b, 'verify_runtime', return_value=request()['runtime']):
            with self.assertRaisesRegex(ValueError, 'REFERENCE_QUERY_HASH_MISMATCH'):
                b.prepare_request()

    def test_no_migration_enumeration(self):
        with patch.object(b, 'verify_runtime', return_value=request()['runtime']), \
             patch.object(Path, 'iterdir', side_effect=AssertionError('migration enumeration')), \
             patch.object(Path, 'glob', side_effect=AssertionError('migration enumeration')):
            r = b.prepare_request()
            self.assertEqual(set(r['foundation']), {'name', 'sha256', 'sql'})
            self.assertNotIn('migrations', r)

    def test_sandbox_unavailable_unverified_or_forged_always_blocks(self):
        with patch.object(b.subprocess, 'Popen') as process:
            for evidence in [None, {}, {'available': False}, {'validated': True},
                             {'network_denied': True, 'owner_approved': True}, {'signature': 'FORGED'},
                             {'network_capable': True}]:
                with self.assertRaisesRegex(ValueError, 'EXECUTION_DISABLED'):
                    b.require_execution_authority({'owner_approved': True}, evidence)
                with self.assertRaisesRegex(ValueError, 'EXECUTION_DISABLED'):
                    b.execute_reference(approval=True, sandbox=evidence)
            process.assert_not_called()

    def test_direct_transport_cannot_bypass_gate(self):
        with patch.object(b.subprocess, 'Popen') as process:
            with self.assertRaisesRegex(ValueError, 'EXECUTION_DISABLED'):
                b._bounded_transport(['FORBIDDEN'], request(), '/private/tmp/fake')
            process.assert_not_called()

    def test_environment_never_inherits_credentials(self):
        with patch.dict(b.os.environ, {'DATABASE_URL': 'SECRET', 'NEON_API_KEY': 'SECRET',
                                      'PGPASSWORD': 'SECRET', 'NODE_OPTIONS': 'SECRET', 'HOME': '/secret'}):
            env = b.minimal_environment('/private/tmp/synthetic-reference')
        self.assertEqual(set(env), {'LANG', 'LC_ALL', 'TZ', 'TMPDIR'})
        self.assertNotIn('SECRET', b.canonical(env))

    def test_profile_denies_network_fork_and_env_access(self):
        profile = b.sandbox_profile('/node', ['/staged/worker.cjs', '/staged/runtime.wasm'], '/scratch')
        for text in ['(deny default)', '(deny network*)', '(deny process-fork)', '[.]env']:
            self.assertIn(text, profile)
        self.assertNotIn('/Users/', profile)
        self.assertNotIn('/bin/sh', profile)
        self.assertNotIn('(allow network', profile)

    def test_profile_rejects_relative_paths(self):
        with self.assertRaises(ValueError):
            b.sandbox_profile('node', [], '/scratch')

    def test_profile_exact_reviewed_startup_permissions(self):
        profile = b.sandbox_profile('/usr/local/bin/node', ['/private/tmp/fixture/probe.cjs'], '/private/tmp/fixture/scratch')
        expected = '''(version 1)
(deny default)
(allow file-read* (literal "/usr/local/bin/node"))
(allow file-read* (literal "/private/tmp/fixture/probe.cjs"))
(allow process-exec (literal "/usr/local/bin/node"))
(allow file-read* file-write* (subpath "/private/tmp/fixture/scratch"))
(allow file-read* file-test-existence (literal "/"))
(allow file-read* (literal "/System/Library/OpenSSL/openssl.cnf"))
(allow sysctl-read (sysctl-name "hw.pagesize_compat"))
(allow file-read-metadata (literal "/private") (literal "/private/tmp") (literal "/private/tmp/fixture") (literal "/usr") (literal "/usr/local") (literal "/usr/local/bin"))
(deny network*)
(deny process-fork)
(deny file-read* file-write* (regex #"(^|/)[.]env([^/]*)?$"))
'''
        self.assertEqual(profile, expected)
        self.assertEqual(profile.count('(subpath '), 1)
        self.assertNotIn('(allow sysctl-read)', profile)
        self.assertNotIn('(subpath "/System', profile)
        self.assertNotIn('(allow process-fork', profile)

    def test_profile_ancestor_metadata_does_not_grant_sibling_reads(self):
        profile = b.sandbox_profile('/node', ['/approved/staged/probe.cjs'], '/approved/staged/scratch')
        self.assertIn('(allow file-read-metadata (literal "/approved") (literal "/approved/staged"))', profile)
        self.assertNotIn('(allow file-read* (literal "/approved"))', profile)
        self.assertNotIn('(subpath "/approved")', profile)

    def test_profile_rejects_root_grants_traversal_and_controls(self):
        for node, files, scratch in [('/node', [], '/'), ('/', [], '/scratch'),
                                     ('/node', ['/'], '/scratch'),
                                     ('/node', ['/approved/../other'], '/scratch'),
                                     ('/node', ['/approved/\nfile'], '/scratch'),
                                     ('/node', ['/scratch'], '/scratch')]:
            with self.subTest(node=node, files=files, scratch=scratch), self.assertRaises(ValueError):
                b.sandbox_profile(node, files, scratch)

    def test_worker_timeout_mocked_kill_and_no_retry(self):
        process = Mock(pid=123)
        process.communicate.side_effect = subprocess.TimeoutExpired('SECRET', b.WORKER_SECONDS)
        with patch.object(b, 'require_execution_authority'), \
             patch.object(b.subprocess, 'Popen', return_value=process) as launch, \
             patch.object(b.os, 'killpg') as kill:
            with self.assertRaisesRegex(ValueError, 'WORKER_FAILED_NO_RETRY'):
                b._bounded_transport(['/synthetic/worker'], request(), '/private/tmp')
            launch.assert_called_once()
            kill.assert_called_once_with(123, b.signal.SIGKILL)
            self.assertEqual(process.communicate.call_args.kwargs['timeout'], 180)
            self.assertEqual(launch.call_args.kwargs['env'], b.minimal_environment('/private/tmp'))
            self.assertTrue(launch.call_args.kwargs['start_new_session'])
            self.assertIs(launch.call_args.kwargs['preexec_fn'], b.worker_limits)

    def test_unconfirmed_termination_blocks(self):
        process = Mock(pid=123)
        process.communicate.side_effect = subprocess.TimeoutExpired('SECRET', 1)
        process.wait.side_effect = subprocess.TimeoutExpired('SECRET', 5)
        with patch.object(b, 'require_execution_authority'), \
             patch.object(b.subprocess, 'Popen', return_value=process), patch.object(b.os, 'killpg'):
            with self.assertRaisesRegex(ValueError, 'TERMINATION_UNCONFIRMED'):
                b._bounded_transport(['/fake'], request(), '/private/tmp')

    def test_nonzero_worker_no_retry(self):
        process = Mock(returncode=1)
        with patch.object(b, 'require_execution_authority'), \
             patch.object(b.subprocess, 'Popen', return_value=process) as launch:
            with self.assertRaisesRegex(ValueError, 'WORKER_FAILED_NO_RETRY'):
                b._bounded_transport(['/fake'], request(), '/private/tmp')
            launch.assert_called_once()

    def test_malformed_artifacts_rejected(self):
        for artifact in [None, {}, [], {'status': 'APPROVED'}, {'status': 'UNREVIEWED'}]:
            with self.assertRaises(ValueError):
                b.validate_artifact(artifact, request())

    def test_parent_accepts_only_unreviewed_boundary_artifact(self):
        artifact = simulated_artifact()
        self.assertIs(b.validate_artifact(artifact, request()), artifact)
        for key, value in [('status', 'APPROVED'), ('reference_complete', True), ('exact_match_enabled', True)]:
            changed = copy.deepcopy(artifact)
            changed[key] = value
            with self.assertRaises(ValueError):
                b.validate_artifact(changed, request())

    def test_parent_rejects_artifact_tampering(self):
        artifact = simulated_artifact()
        artifact['application']['Q3_columns'][0]['default_expression'] = 'SECRET_LITERAL'
        with self.assertRaisesRegex(ValueError, 'ARTIFACT_INTEGRITY'):
            b.validate_artifact(artifact, request())

    def test_parent_rejects_incomplete_coverage_and_catalog_counts(self):
        for mutate in [lambda a: a['coverage'].pop('Q3_columns'),
                       lambda a: a['application']['Q3_columns'].pop(),
                       lambda a: a['environment'].pop('R_environment')]:
            artifact = simulated_artifact()
            mutate(artifact)
            with self.assertRaises(ValueError):
                b.validate_artifact(artifact, request())

    def test_parent_rejects_owner_acl_fields_in_application(self):
        artifact = simulated_artifact()
        artifact['application']['Q2_relations'][0]['owner_name'] = 'MUST_BE_ENVIRONMENT_ONLY'
        with self.assertRaisesRegex(ValueError, 'ARTIFACT_ROW_INCOMPLETE'):
            b.validate_artifact(artifact, request())

    def test_duplicate_json_rejected(self):
        with self.assertRaisesRegex(ValueError, 'DUPLICATE_JSON_KEY'):
            b.unique_pairs([('key', 1), ('key', 2)])

    def test_cli_cannot_execute_or_echo_secrets(self):
        for args in [[], ['--execute'], ['--check-plan', '--url=SECRET'],
                     ['--approved', 'SECRET'], ['--check-pl']]:
            out = io.StringIO()
            with contextlib.redirect_stderr(out), self.assertRaises(SystemExit) as error:
                b.main(args)
            self.assertEqual(error.exception.code, 2)
            self.assertNotIn('SECRET', out.getvalue())

    def test_offline_plan_never_connects_starts_worker_or_reads_env(self):
        with patch.object(b, 'verify_runtime', return_value=request()['runtime']), \
             patch.object(socket, 'socket', side_effect=AssertionError('network')), \
             patch.object(socket, 'create_connection', side_effect=AssertionError('network')), \
             patch.object(urllib.request, 'urlopen', side_effect=AssertionError('Neon')), \
             patch.object(b.subprocess, 'Popen', side_effect=AssertionError('process')), \
             patch.object(b.os, 'getenv', side_effect=AssertionError('credential')), \
             contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(b.main(['--check-plan']), 3)
            self.assertIn('EXECUTION_BLOCKED', out.getvalue())
            self.assertIn('NOT_GENERATED', out.getvalue())


if __name__ == '__main__':
    unittest.main()
