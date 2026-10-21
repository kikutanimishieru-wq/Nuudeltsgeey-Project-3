"""Pure offline adversarial tests. No SQL execution or migration replay."""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import urllib.request

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location('foundation_verify', SCRIPTS / 'phase4-foundation-verify.py')
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)


def row(section, object_identity, **changes):
    props = {key: None for key in v.FIELDS[section]}
    for key in props:
        if key in v.BOOL_FIELDS:
            props[key] = False
    props.update(changes)
    return {'identity': object_identity, 'properties': props}


def synthetic_catalog():
    """Small synthetic semantic examples, NOT a foundation reference/artifact.

    Expected definitions are hand-specified; no SQL helper or database generates
    both sides. Actual examples are adversarially changed by each test.
    """
    c = {section: [] for section in v.FIELDS}
    c['tables'] = [row('tables', ['public', 'Example'], kind='r', owner='OWNER', persistence='p')]
    c['columns'] = [row('columns', ['public', 'Example', 'id'], ordinal=1,
                        type='pg_catalog.text', nullable=False, default=None, identity='', generated='')]
    c['constraints'] = [row('constraints', ['public', 'Example', 'Example_parent_fkey'],
                            kind='f', definition='FOREIGN KEY (parent) REFERENCES public.Parent(id) ON DELETE CASCADE',
                            validated=True),
                        row('constraints', ['public', 'Example', 'Example_id_key'],
                            kind='u', definition='UNIQUE (id)', validated=True)]
    c['indexes'] = [row('indexes', ['public', 'Example_id_key'],
                        definition='CREATE UNIQUE INDEX Example_id_key ON public.Example USING btree (id)',
                        valid=True, ready=True, live=True, unique=True, immediate=True)]
    c['enums'] = [row('enums', ['public', 'ExampleStatus'], labels=['OPEN', 'CLOSED'])]
    c['privileges'] = [row('privileges', ['public', 'Example', 'OWNER', 'SELECT', 'OWNER'],
                           grantor='OWNER', grantee='OWNER', privilege='SELECT', grantable=False)]
    return c


def incomplete_reference_compatible_capture():
    """Only table/enum evidence matches. Other sections intentionally do NOT
    constitute a real foundation catalog. Must never produce EXACT MATCH.
    """
    ref = v.foundation_reference()
    catalog = {section: [] for section in v.FIELDS}
    catalog['tables'] = [row('tables', ['public', name], kind='r') for name in ref['tables']]
    catalog['enums'] = [row('enums', ['public', name], labels=labels) for name, labels in ref['enums'].items()]
    return {
        'format_version': 1, 'foundation_sha256': v.PIN, 'query_plan_sha256': v.QUERY_PIN,
        'context': {'project': v.PROJECT, 'branch': v.PRODUCTION, 'branch_name': 'production',
                    'endpoint': 'ep-synthetic-test',
                    'hostname': 'ep-synthetic-test.c-7.us-east-2.aws.neon.tech',
                    'database': 'neondb', 'role': 'synthetic_readonly', 'approved_role': 'synthetic_readonly',
                    'server_version_num': 180000, 'read_only': True, 'isolation': 'repeatable read',
                    'tls': 'verify-full', 'identity_verified': True, 'privileges_complete': True,
                    'captured_at': '2026-10-19T12:00:00Z'},
        'coverage': dict.fromkeys(v.FIELDS, True), 'catalog': catalog,
        'ledger': {'state': 'counted', 'count': 0, 'structure_reviewed': True},
        'diagnostic_oids': [],
    }


class FoundationTests(unittest.TestCase):
    def setUp(self):
        self.expected = synthetic_catalog()
        self.actual = copy.deepcopy(self.expected)

    def changed(self, section):
        self.assertIn(section, v.compare_catalogs(self.expected, self.actual))

    def test_pinned_hash_and_local_counts(self):
        ref = v.foundation_reference()
        self.assertEqual(ref['sha256'], v.PIN)
        self.assertEqual(ref['counts']['tables'], 26)
        self.assertEqual(ref['counts']['columns'], 192)
        self.assertEqual(ref['counts']['indexes'], 52)
        self.assertFalse(ref['complete'])

    def test_modified_foundation_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'modified.sql'
            path.write_bytes(v.FOUNDATION.read_bytes() + b'\n')
            with self.assertRaises(ValueError):
                v.foundation_reference(path)

    def test_missing_table(self):
        self.actual['tables'] = []
        self.changed('tables')

    def test_extra_table(self):
        self.actual['tables'].append(row('tables', ['public', 'Unexpected'], kind='r'))
        self.changed('tables')

    def test_missing_column(self):
        self.actual['columns'] = []
        self.changed('columns')

    def test_changed_column_type_and_order(self):
        for field, value in [('type', 'pg_catalog.int8'), ('ordinal', 2), ('identity', 'a'), ('generated', 's')]:
            with self.subTest(field=field):
                self.actual = copy.deepcopy(self.expected)
                self.actual['columns'][0]['properties'][field] = value
                self.changed('columns')

    def test_nullability_and_defaults_preserve_literals(self):
        for field, value in [('nullable', True), ('default', "'a  b'::text"), ('default', "'a b'::text")]:
            self.actual = copy.deepcopy(self.expected)
            self.actual['columns'][0]['properties'][field] = value
            self.changed('columns')

    def test_foreign_key_action(self):
        self.actual['constraints'][0]['properties']['definition'] = 'FOREIGN KEY (parent) REFERENCES public.Parent(id) ON DELETE RESTRICT'
        self.changed('constraints')

    def test_unique_constraint_missing_or_altered(self):
        self.actual['constraints'].pop()
        self.changed('constraints')
        self.actual = copy.deepcopy(self.expected)
        self.actual['constraints'][1]['properties']['definition'] = 'UNIQUE (other)'
        self.changed('constraints')

    def test_index_missing_altered_invalid(self):
        for field, value in [('definition', 'CREATE INDEX unexpected'), ('valid', False), ('ready', False)]:
            self.actual = copy.deepcopy(self.expected)
            self.actual['indexes'][0]['properties'][field] = value
            self.changed('indexes')
        self.actual['indexes'] = []
        self.changed('indexes')

    def test_enum_label_and_order(self):
        for labels in [['OPEN', 'OTHER'], ['CLOSED', 'OPEN']]:
            self.actual['enums'][0]['properties']['labels'] = labels
            self.changed('enums')

    def test_unexpected_function(self):
        self.actual['routines'] = [row('routines', ['public', 'evil', '()'], kind='f', definition='sensitive body')]
        self.changed('routines')

    def test_unexpected_user_trigger(self):
        self.actual['triggers'] = [row('triggers', ['public', 'Example', 'extra'], internal=False, enabled='O')]
        self.changed('triggers')

    def test_unexpected_sequence(self):
        self.actual['sequences'] = [row('sequences', ['public', 'extra'], owned_by=['public', 'Example', 'id'])]
        self.changed('sequences')

    def test_unexpected_view(self):
        self.actual['views'] = [row('views', ['public', 'extra'], kind='v', definition='SELECT sensitive')]
        self.changed('views')

    def test_changed_rls(self):
        self.actual['tables'][0]['properties']['rls'] = True
        self.changed('tables')

    def test_changed_privileges(self):
        for field, value in [('grantee', 'PUBLIC'), ('grantor', 'other'), ('grantable', True)]:
            self.actual = copy.deepcopy(self.expected)
            self.actual['privileges'][0]['properties'][field] = value
            self.changed('privileges')

    def test_internal_fk_trigger_names_bound_to_constraint(self):
        p = dict(internal=True, constraint_identity=['public', 'Example', 'Example_parent_fkey'],
                 constraint_kind='f', enabled='O', definition='CREATE CONSTRAINT TRIGGER "RI_123" AFTER INSERT ON public."Example" EXECUTE FUNCTION pg_catalog."RI_FKey_check_ins"()')
        self.expected['triggers'] = [row('triggers', ['public', 'Example', 'RI_123'], **p)]
        self.actual['triggers'] = [row('triggers', ['public', 'Example', 'RI_999'], **{**p, 'definition': p['definition'].replace('RI_123', 'RI_999')})]
        self.assertEqual(v.compare_catalogs(self.expected, self.actual), [])
        self.actual['triggers'][0]['properties']['definition'] += ' altered'
        self.changed('triggers')
        self.actual['triggers'][0]['properties']['enabled'] = 'D'
        self.changed('triggers')

    def test_internal_trigger_without_verified_fk_not_ignored(self):
        self.actual['triggers'] = [row('triggers', ['public', 'Example', 'RI_fake'],
                                     internal=True, constraint_identity=['public', 'Example', 'missing'],
                                     constraint_kind='f', enabled='O')]
        self.changed('triggers')

    def test_oid_diagnostics_do_not_affect_semantics(self):
        capture = incomplete_reference_compatible_capture()
        before = v.compare_capture(capture)
        capture['diagnostic_oids'] = [1, 99999]
        self.assertEqual(before, v.compare_capture(capture))
        self.actual['tables'][0]['properties']['oid'] = 123
        with self.assertRaises(ValueError):
            v.compare_catalogs(self.expected, self.actual)

    def test_version_ambiguity_blocks(self):
        for version in [170000, 190000, '180000', True]:
            capture = incomplete_reference_compatible_capture()
            capture['context']['server_version_num'] = version
            self.assertEqual(v.compare_capture(capture)['verdict'], 'INDETERMINATE')

    def test_pg18_not_null_representation_not_silently_dropped(self):
        self.actual['constraints'].append(row('constraints', ['public', 'Example', 'id_not_null'], kind='n', definition='NOT NULL id'))
        self.changed('constraints')

    def test_incomplete_and_malformed_capture(self):
        for mutate in [lambda c: c.pop('coverage'), lambda c: c['catalog'].pop('columns'),
                       lambda c: c['coverage'].update(columns=False),
                       lambda c: c['catalog'].update(columns=None),
                       lambda c: c.update(reference_complete=True),
                       lambda c: c['catalog']['tables'].append(copy.deepcopy(c['catalog']['tables'][0]))]:
            capture = incomplete_reference_compatible_capture()
            mutate(capture)
            self.assertEqual(v.compare_capture(capture)['verdict'], 'INDETERMINATE')

    def test_missing_inaccessible_ledger(self):
        for ledger in [None, {'state': 'absent'}, {'state': 'inaccessible'},
                       {'state': 'counted', 'count': True, 'structure_reviewed': True}]:
            capture = incomplete_reference_compatible_capture()
            capture['ledger'] = ledger
            self.assertEqual(v.compare_capture(capture)['verdict'], 'INDETERMINATE')

    def test_nonzero_ledger_not_schema_difference(self):
        capture = incomplete_reference_compatible_capture()
        for count in [0, 1, 7, 100]:
            capture['ledger']['count'] = count
            result = v.compare_capture(capture)
            self.assertEqual(result['verdict'], 'INDETERMINATE')
            self.assertEqual(result['ledger_count'], count)

    def test_no_exact_match_from_count_or_claimed_complete(self):
        capture = incomplete_reference_compatible_capture()
        self.assertEqual(v.compare_capture(capture)['verdict'], 'INDETERMINATE')
        self.assertFalse(v.foundation_reference()['complete'])
        with patch.object(v, 'foundation_reference', return_value={**v.foundation_reference(), 'complete': True}):
            self.assertNotEqual(v.compare_capture(capture)['verdict'], 'EXACT FOUNDATION MATCH')

    def test_partial_reference_can_establish_definite_difference(self):
        capture = incomplete_reference_compatible_capture()
        capture['catalog']['tables'].pop()
        result = v.compare_capture(capture)
        self.assertEqual(result['verdict'], 'MIGRATED OR OTHERWISE DIFFERENT')
        self.assertEqual(result['production_compatibility'], 'UNKNOWN')

    def test_sensitive_literals_never_printed(self):
        capture = incomplete_reference_compatible_capture()
        secret = 'DO_NOT_PRINT_PRIVATE_LITERAL'
        capture['catalog']['routines'] = [row('routines', ['public', secret, '()'], kind='f', definition=secret)]
        result = v.canonical(v.compare_capture(capture))
        self.assertNotIn(secret, result)
        self.assertIn('routines', result)

    def test_unexpected_flags_do_not_echo_secrets(self):
        for args in [['--connect-production', 'postgresql://SECRET'], ['--url=SECRET'],
                     ['--verify-ref'], ['--verify-reference', '--validate-queries']]:
            output = io.StringIO()
            with contextlib.redirect_stderr(output), self.assertRaises(SystemExit) as error:
                v.main(args)
            self.assertEqual(error.exception.code, 2)
            self.assertNotIn('SECRET', output.getvalue())

    def test_live_interface_never_calls_callback(self):
        def forbidden(*args, **kwargs):
            self.fail('connection or callback attempted')
        with self.assertRaisesRegex(RuntimeError, 'LIVE_COLLECTION_DISABLED'):
            v.queries.collect_live(forbidden, approved=True, url='SECRET')

    def test_all_offline_modes_no_network_process_or_environment_credentials(self):
        capture = incomplete_reference_compatible_capture()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'capture.json'
            path.write_text(json.dumps(capture))
            with patch.dict(os.environ, {'DATABASE_URL': 'SECRET', 'PGSERVICE': 'SECRET'}), \
                 patch.object(socket, 'socket', side_effect=AssertionError('network')), \
                 patch.object(socket, 'create_connection', side_effect=AssertionError('network')), \
                 patch.object(urllib.request, 'urlopen', side_effect=AssertionError('network')), \
                 patch.object(subprocess, 'Popen', side_effect=AssertionError('process')), \
                 patch.object(os, 'getenv', side_effect=AssertionError('environment')):
                for args, status in [(['--verify-reference'], 3), (['--validate-queries'], 0),
                                     (['--compare-capture', str(path)], 3)]:
                    output = io.StringIO()
                    with contextlib.redirect_stdout(output):
                        self.assertEqual(v.main(args), status)
                    self.assertNotIn('SECRET', output.getvalue())

    def test_wrong_target_and_safety_claims_block(self):
        for key, value in [('project', 'other'), ('branch', 'br-v4'), ('branch_name', 'v4'),
                           ('hostname', 'evil'), ('database', 'other'), ('role', 'other'),
                           ('tls', 'require'), ('read_only', False), ('identity_verified', False),
                           ('privileges_complete', False), ('isolation', 'read committed')]:
            capture = incomplete_reference_compatible_capture()
            capture['context'][key] = value
            self.assertEqual(v.compare_capture(capture)['verdict'], 'INDETERMINATE')

    def test_static_query_allowlist_rejects_any_change(self):
        self.assertEqual(v.validate_queries()['status'], 'STATIC ALLOWLIST PASS')
        for sql in ['SELECT evil()', 'SELECT * FROM public."User"', 'SELECT nextval(\'x\')',
                    'SELECT pg_advisory_lock(1)', 'DELETE FROM public."User"',
                    'SELECT migration_name FROM public."_prisma_migrations"']:
            changed = dict(v.queries.QUERIES, Q8_ledger_count=sql)
            with self.assertRaises(ValueError):
                v.validate_queries(changed)

    def test_transaction_boundary_and_timeout_changes_rejected(self):
        with self.assertRaises(ValueError):
            v.validate_queries(transaction=('BEGIN',))
        with self.assertRaises(ValueError):
            v.validate_queries(finish='COMMIT')

    def test_json_duplicates_nonfinite_and_symlinks_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'capture.json'
            for raw in ['{"key":1,"key":2}', '{"value":NaN}', '{"value":Infinity}']:
                path.write_text(raw)
                with self.assertRaises(ValueError):
                    v.load_capture(path)
            link = Path(directory) / 'link'
            link.symlink_to(path)
            with self.assertRaises(OSError):
                v.load_capture(link)

    def test_cli_bad_capture_redacts_paths_and_input(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(v.main(['--compare-capture', 'postgresql://SECRET']), 3)
        self.assertNotIn('SECRET', output.getvalue())

    def test_object_order_ignored_but_definition_whitespace_preserved(self):
        self.actual['constraints'].reverse()
        self.assertEqual(v.compare_catalogs(self.expected, self.actual), [])
        self.actual['constraints'][0]['properties']['definition'] = 'UNIQUE  (id)'
        self.changed('constraints')


if __name__ == '__main__':
    unittest.main()
