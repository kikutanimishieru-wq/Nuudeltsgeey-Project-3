import importlib.util
from pathlib import Path
import unittest
import warnings
import io
import contextlib
import subprocess
from unittest.mock import patch, Mock
from datetime import datetime, timezone, timedelta

spec = importlib.util.spec_from_file_location('guard', Path(__file__).with_name('phase4-preflight.py'))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class GuardTests(unittest.TestCase):
    def test_url_allowlist(self):
        safe = 'postgresql://neondb_owner:synthetic@' + guard.HOST + '/neondb?sslmode=require&sslaccept=strict'
        self.assertEqual(guard.validate_url(safe), safe)
        for value in [safe.replace(guard.HOST, 'ep-crimson-rain-b5po4mqa.c-7.us-east-2.aws.neon.tech'),
                      safe.replace('/neondb?', '/other?'), safe.replace('neondb_owner:', 'other:'),
                      safe + '&host=localhost', safe + '&sslmode=disable',
                      safe.replace('sslmode=require', 'sslmode=disable'), safe + '&schema=other']:
            with self.subTest(value=value), self.assertRaises(Exception):
                guard.validate_url(value)

    def test_live_metadata_required(self):
        now = datetime(2026, 10, 19, 10, tzinfo=timezone.utc)
        branch = dict(id=guard.BRANCH, project_id=guard.PROJECT, name='phase4-validation-v4',
                      current_state='ready', primary=False, default=False, protected=False, init_source="parent-schema",
                      expires_at=guard.EXPIRES_AT)
        endpoint = dict(id=guard.ENDPOINT, project_id=guard.PROJECT, branch_id=guard.BRANCH,
                        host=guard.HOST, disabled=False)
        guard.validate_metadata(branch, endpoint, now)
        expiry=datetime.fromisoformat(guard.EXPIRES_AT.replace('Z','+00:00'))
        for late in [expiry-timedelta(hours=1),expiry,expiry+timedelta(seconds=1)]:
            with self.assertRaises(ValueError):guard.validate_metadata(branch,endpoint,late)
        for key, value in [('primary', True), ('default', True), ('protected', True),
                           ('id', 'production'), ('expires_at', now.isoformat())]:
            with self.subTest(key=key), self.assertRaises(Exception):
                guard.validate_metadata({**branch, key: value}, endpoint, now)
        with self.assertRaises(Exception):
            guard.validate_metadata(branch, {**endpoint, 'branch_id': 'production'}, now)

    def test_retired_target_and_wrong_name_rejected(self):
        safe='postgresql://neondb_owner:synthetic@'+guard.HOST+'/neondb?sslmode=require&sslaccept=strict'
        for host in ['ep-crimson-rain-b5po4mqa.c-7.us-east-2.aws.neon.tech','ep-still-rain-b55chfrd.c-7.us-east-2.aws.neon.tech','ep-still-glitter-b51rfltc.c-7.us-east-2.aws.neon.tech','ep-round-leaf-b5w0evea.c-7.us-east-2.aws.neon.tech',guard.ENDPOINT+'-pooler.c-7.us-east-2.aws.neon.tech']:
            with self.assertRaises(ValueError):guard.validate_url(safe.replace(guard.HOST,host))
        now=datetime(2026, 10, 19, 10, tzinfo=timezone.utc)
        branch=dict(id=guard.BRANCH,project_id=guard.PROJECT,name='phase4-validation-v4',current_state='ready',primary=False,default=False,protected=False,init_source="parent-schema",expires_at=guard.EXPIRES_AT)
        endpoint=dict(id=guard.ENDPOINT,branch_id=guard.BRANCH,project_id=guard.PROJECT,host=guard.HOST,disabled=False)
        for changes in [dict(id='br-wispy-mountain-b5nku4bf'),dict(id='br-morning-queen-b5u7j4qz'),dict(parent_id='source'),dict(init_source='parent-data'),dict(expires_at='2026-10-26T09:48:10Z'),dict(name='phase4-validation-v3'),dict(id='br-ancient-water-b51y8pjw'),dict(id='br-plain-glitter-b5cadax8'),dict(name='phase4-validation-v2'),dict(name='phase4-validation'),dict(project_id='other')]:
            with self.assertRaises(ValueError):guard.validate_metadata({**branch,**changes},endpoint,now)

    def test_adversarial_urls(self):
        safe = 'postgresql://neondb_owner:synthetic@' + guard.HOST + '/neondb?sslmode=require&sslaccept=strict'
        variants = [safe+' ', ' '+safe, safe+'\n', safe.replace('postgresql:', 'postgresql:\n'),
                    safe.replace('synthetic','%ZZ'), safe.replace('synthetic','%0a'), safe.replace('synthetic','%'),
                    safe.replace(guard.HOST,guard.HOST+'.evil'), safe.replace(guard.HOST,guard.HOST+'.'),
                    safe.replace(guard.HOST,guard.HOST.upper()), safe.replace(guard.HOST,'127.0.0.1'),
                    safe.replace('neondb_owner','%6eeondb_owner'), safe.replace('/neondb?','/neondb/other?'),
                    safe.replace('sslaccept=strict','sslaccept=accept_invalid_certs'),
                    safe.replace('&sslaccept=strict',''),safe.replace('sslmode=require','sslmode=verify-full'),
                    safe+'&%73slaccept=strict',safe+'&host=evil',safe+'&options=-c+role=other',
                    safe+'&pgbouncer=true',safe+'&sslcert=/tmp/ca',safe+'&channel_binding=disable',
                    safe+'&connect_timeout=0',safe+'&connect_timeout=999',safe+'&socket_timeout=0',
                    safe+'#fragment',safe+'&schema=private',safe+'&broken',safe.replace('synthetic','bad%FF'),safe.replace('synthetic','bad\\value'),safe.replace('synthetic','x@x')]
        for value in variants:
            with self.subTest(case=variants.index(value)), self.assertRaises(ValueError):
                guard.validate_url(value)
        final=guard.bounded_url(safe)
        self.assertEqual(guard.validate_url(final),final)
        self.assertEqual(guard.bounded_url(final),final)
        self.assertIn('sslaccept=strict',final)

    def test_echo_failure_is_fatal_and_sanitized(self):
        def fallback(prompt):
            warnings.warn('echo unavailable',guard.getpass.GetPassWarning)
            raise AssertionError('must not reach echoed input')
        for effect in [fallback, OSError('SYNTHETIC_SECRET')]:
            with patch.object(guard.sys.stdin,'isatty',return_value=True), patch.object(guard.getpass,'getpass',side_effect=effect):
                with self.assertRaises(ValueError) as error:
                    guard.hidden_input('hidden: ')
                self.assertNotIn('SYNTHETIC_SECRET',str(error.exception))
        with patch.object(guard.sys.stdin,'isatty',return_value=False),patch.object(guard.getpass,'getpass') as prompt:
            with self.assertRaises(ValueError):guard.hidden_input('hidden: ')
            prompt.assert_not_called()

    def test_minimal_environment(self):
        url='postgresql://neondb_owner:synthetic@'+guard.HOST+'/neondb?sslmode=require&sslaccept=strict'
        with patch.dict(guard.os.environ,{'DATABASE_URL':'PRODUCTION','DIRECT_URL':'PRODUCTION','NODE_OPTIONS':'evil','PGHOST':'evil','PRISMA_SCHEMA_ENGINE_BINARY':'evil'}):
            env=guard.child_environment(url)
        self.assertEqual(env['PHASE4_VALIDATION_DATABASE_URL'],url)
        for key in ('DATABASE_URL','DIRECT_URL','NODE_OPTIONS','PGHOST','PRISMA_SCHEMA_ENGINE_BINARY'):
            self.assertNotIn(key,env)

    def test_timeout_kills_group_and_sanitizes(self):
        process=Mock(pid=12345)
        process.communicate.side_effect=[subprocess.TimeoutExpired('synthetic-secret',1),('',''),('','')]
        with patch.object(guard.subprocess,'Popen',return_value=process) as popen, patch.object(guard.os,'killpg') as kill, patch.object(guard,'group_alive',side_effect=[True]*20+[False]),patch.object(guard.time,'sleep'):
            with self.assertRaises(ValueError) as error:guard.run_group(['fake'],'/tmp',{},timeout=1)
            self.assertNotIn('synthetic-secret',str(error.exception))
            self.assertTrue(popen.call_args.kwargs['start_new_session'])
            self.assertIn(unittest.mock.call(12345,guard.signal.SIGTERM),kill.call_args_list)
            self.assertIn(unittest.mock.call(12345,guard.signal.SIGKILL),kill.call_args_list)

    def test_interruption_terminates_group_without_leaking(self):
        process=Mock(pid=12345)
        process.communicate.side_effect=[KeyboardInterrupt('SYNTHETIC_SECRET'), ('','')]
        with patch.object(guard.subprocess,'Popen',return_value=process),patch.object(guard.os,'killpg') as kill,patch.object(guard,'group_alive',return_value=False):
            with self.assertRaises(guard.ProcessFailure) as error:
                guard.run_group(['fake'],'/tmp',{})
            self.assertEqual(error.exception.category,'PROCESS_INTERRUPTED')
            self.assertNotIn('SYNTHETIC_SECRET',str(error.exception))
            kill.assert_called_with(12345,guard.signal.SIGTERM)

    def test_unconfirmed_cleanup_blocks(self):
        process=Mock(pid=12345)
        process.communicate.side_effect=subprocess.TimeoutExpired('synthetic-secret',1)
        with patch.object(guard.subprocess,'Popen',return_value=process),patch.object(guard.os,'killpg'),patch.object(guard,'group_alive',return_value=True),patch.object(guard.time,'sleep'):
            with self.assertRaisesRegex(ValueError,'cleanup unconfirmed'):
                guard.run_group(['fake'],'/tmp',{},timeout=1)

    def test_nonzero_exit_suppresses_output(self):
        process=Mock(pid=12345,returncode=1)
        process.communicate.return_value=('SYNTHETIC_SECRET','SYNTHETIC_SECRET')
        with patch.object(guard.subprocess,'Popen',return_value=process),patch.object(guard,'group_alive',return_value=False),patch.object(guard.os,'killpg',side_effect=ProcessLookupError):
            with self.assertRaises(ValueError) as error:guard.run_group(['fake'],'/tmp',{})
            self.assertNotIn('SYNTHETIC_SECRET',str(error.exception))

    def test_concurrent_execution_lock_is_rejected(self):
        # Mock filesystem and flock: this test creates no lock file.
        info=Mock(st_mode=0o100600,st_uid=guard.os.getuid())
        with patch.object(guard.os,'open',return_value=7),patch.object(guard.os,'fstat',return_value=info),patch.object(guard.os,'close') as close,patch.object(guard.fcntl,'flock',side_effect=BlockingIOError):
            with self.assertRaises(BlockingIOError):
                with guard.execution_lock():self.fail('lock was bypassed')
            close.assert_called_once_with(7)

    def test_empty_hidden_input_aborts(self):
        with patch.object(guard.sys.stdin,'isatty',return_value=True),patch.object(guard.getpass,'getpass',return_value=''):
            with self.assertRaises(ValueError):guard.hidden_input('hidden: ')

    def test_terminal_failure_traceback_contains_no_secret(self):
        import traceback
        def fail(prompt):raise OSError('SYNTHETIC_PASSWORD')
        with patch.object(guard.sys.stdin,'isatty',return_value=True),patch.object(guard.getpass,'getpass',side_effect=fail):
            try:guard.hidden_input('hidden: ')
            except ValueError:
                self.assertNotIn('SYNTHETIC_PASSWORD',traceback.format_exc())

    def test_supported_engine_is_pinned(self):
        value={'cli':'6.19.3','client':{'client':'6.19.3','engine':guard.ENGINE_HASH},'engine':guard.ENGINE_HASH}
        with patch.object(guard,'run_group',return_value=value):guard.verify_engine('node')
        for change in [{'cli':'7.0.0'},{'engine':'different'}]:
            with patch.object(guard,'run_group',return_value={**value,**change}):
                with self.assertRaises(ValueError):guard.verify_engine('node')

    def test_specific_url_failure_categories(self):
        safe='postgresql://neondb_owner:synthetic@'+guard.HOST+'/neondb?sslmode=require&sslaccept=strict'
        cases=[(safe.replace('&sslaccept=strict',''),'TLS_STRICT_REQUIRED'),
               (safe.replace('sslmode=require','sslmode=verify-full'),'TLS_MODE_REQUIRED'),
               ('"'+safe+'"','URL_WRAPPED_TEXT'),(safe+' ','URL_WHITESPACE'),
               (safe+'\u200b','URL_NON_ASCII'),(safe+'\x1b[201~','URL_CONTROL_CHARACTER'),
               (safe.replace('synthetic','bad%'),'URL_PERCENT_ENCODING'),
               (safe.replace('synthetic','bad%0a'),'URL_ENCODED_CONTROL'),
               (safe+'&sslaccept=strict','URL_DUPLICATE_PARAMETER'),
               (safe+'&host=other','URL_UNSUPPORTED_PARAMETER'),
               (safe+'&channel_binding=prefer','URL_CHANNEL_BINDING'),
               (safe.replace(guard.ENDPOINT,guard.ENDPOINT+'-pooler'),'URL_TARGET_HOST')]
        for value,category in cases:
            with self.subTest(category=category),self.assertRaises(guard.DiagnosticError) as error:
                guard.validate_url(value)
            self.assertEqual(error.exception.category,category)

    def test_supported_neon_parameter_order_and_password_encoding(self):
        from urllib.parse import quote
        for password in ['synthetic','synthetic@:#/?&%=+','synthetic space']:
            value='postgresql://neondb_owner:'+quote(password,safe='')+'@'+guard.HOST+'/neondb?channel_binding=require&sslaccept=strict&sslmode=require'
            self.assertEqual(guard.validate_url(value),value)
            self.assertEqual(guard.validate_url(guard.bounded_url(value)),guard.bounded_url(value))
        # No implicit addition of strict TLS: a plain console-style URL must be rejected.
        with self.assertRaisesRegex(guard.DiagnosticError,'TLS_STRICT_REQUIRED'):
            guard.bounded_url('postgresql://neondb_owner:synthetic@'+guard.HOST+'/neondb?sslmode=require&channel_binding=require')

    def test_hidden_input_categories(self):
        for value,category in [('', 'INPUT_EMPTY'),('safe\n','INPUT_CONTROL_CHARACTER')]:
            with patch.object(guard.sys.stdin,'isatty',return_value=True),patch.object(guard.getpass,'getpass',return_value=value):
                with self.assertRaises(guard.DiagnosticError) as error:guard.hidden_input('hidden: ')
                self.assertEqual(error.exception.category,category)
        def warning(prompt):warnings.warn('echo unavailable',guard.getpass.GetPassWarning)
        with patch.object(guard.sys.stdin,'isatty',return_value=True),patch.object(guard.getpass,'getpass',side_effect=warning):
            with self.assertRaises(guard.DiagnosticError) as error:guard.hidden_input('hidden: ')
            self.assertEqual(error.exception.category,'INPUT_ECHO_UNAVAILABLE')

    def test_url_rejection_precedes_api_key_and_network(self):
        unsafe='postgresql://neondb_owner:SYNTHETIC_SECRET@'+guard.HOST+'/neondb?sslmode=require'
        output=io.StringIO()
        with patch.object(guard.sys,'argv',['preflight']),patch.object(guard.sys.stdin,'isatty',return_value=True),patch.object(guard.shutil,'which',return_value='node'),patch.object(guard,'verify_engine'),patch.object(guard,'hidden_input',return_value=unsafe) as prompts,patch.object(guard,'build_opener') as opener,patch.object(guard,'run_group') as process,contextlib.redirect_stderr(output):
            self.assertEqual(guard.cli(),1)
            self.assertEqual(prompts.call_count,1)
            opener.assert_not_called();process.assert_not_called()
        self.assertIn('TLS_STRICT_REQUIRED',output.getvalue())
        self.assertNotIn('SYNTHETIC_SECRET',output.getvalue())

    def test_generic_cli_error_never_prints_exception_content(self):
        output=io.StringIO()
        with patch.object(guard,'main',side_effect=ValueError('SYNTHETIC_SECRET')),contextlib.redirect_stderr(output):
            self.assertEqual(guard.cli(),1)
        self.assertIn('PREFLIGHT_FAILED',output.getvalue())
        self.assertNotIn('SYNTHETIC_SECRET',output.getvalue())

    def test_current_pass_receipt_and_dedicated_connection(self):
        import json
        now=datetime(2026, 10, 19, 10, tzinfo=timezone.utc)
        branch=dict(id=guard.BRANCH,project_id=guard.PROJECT,name='phase4-validation-v4',current_state='ready',primary=False,default=False,protected=False,init_source="parent-schema",expires_at=guard.EXPIRES_AT)
        endpoint=dict(id=guard.ENDPOINT,project_id=guard.PROJECT,branch_id=guard.BRANCH,host=guard.HOST,disabled=False)
        responses=[]
        for value in [{'branch':branch},{'endpoint':endpoint}]:
            response=Mock();response.__enter__=Mock(return_value=io.StringIO(json.dumps(value)));response.__exit__=Mock(return_value=False);responses.append(response)
        opener=Mock();opener.open.side_effect=responses
        safe='postgresql://neondb_owner:synthetic@'+guard.HOST+'/neondb?sslmode=require&sslaccept=strict'
        result={'identity':{'database':'neondb','role':'neondb_owner'},'applicationTables':26,'migrationRecords':0}
        output=io.StringIO()
        with patch.object(guard,'datetime',wraps=datetime) as clock,patch.object(guard.sys,'argv',['preflight']),patch.object(guard.sys.stdin,'isatty',return_value=True),patch.object(guard.shutil,'which',return_value='node'),patch.object(guard,'verify_engine'),patch.object(guard,'hidden_input',side_effect=[safe,'synthetic-api-key']),patch.object(guard,'build_opener',return_value=opener),patch.object(guard,'run_group',return_value=result) as process,contextlib.redirect_stdout(output):
            clock.now.return_value=now
            self.assertEqual(guard.cli(),0)
        receipt=json.loads(output.getvalue())
        self.assertEqual(receipt['preflight_policy'],guard.PREFLIGHT_POLICY)
        self.assertEqual(len(receipt['script_sha256']),64)
        self.assertTrue(receipt['strict_tls_prisma_read_only_connection'])
        self.assertNotIn('synthetic',output.getvalue())
        args=process.call_args.args
        self.assertIn('SET TRANSACTION READ ONLY',args[0][2])
        self.assertIn('new PrismaClient',args[0][2])
        self.assertEqual(args[2]['PHASE4_VALIDATION_DATABASE_URL'],guard.bounded_url(safe))

    def test_exact_allowlist_and_strict_tls_suffix(self):
        self.assertEqual(guard.URL_QUERY_ALLOWLIST,{'sslmode','sslaccept','channel_binding','schema','connect_timeout','socket_timeout','options'})
        base='postgresql://neondb_owner:synthetic@'+guard.HOST+'/neondb'
        suffix='?sslmode=require&sslaccept=strict&channel_binding=require'
        self.assertEqual(guard.validate_url(base+suffix),base+suffix)
        self.assertEqual(guard.validate_url(guard.bounded_url(base+suffix)),guard.bounded_url(base+suffix))
        from urllib.parse import urlencode
        for name,value in [('schema','public'),('connect_timeout','10'),('socket_timeout','90'),('options',guard.TIMEOUT_OPTIONS)]:
            guard.validate_url(base+suffix+'&'+urlencode({name:value}))

    def test_unsupported_names_printed_without_values(self):
        safe='postgresql://neondb_owner:synthetic@'+guard.HOST+'/neondb?sslmode=require&sslaccept=strict&channel_binding=require'
        for name in ['host','pgbouncer','sslrootcert','application_name','amp;channel_binding','SSLMODE']:
            with self.subTest(name=name):
                try:guard.validate_url(safe+'&'+name+'=SYNTHETIC_PRIVATE_VALUE')
                except guard.UnsupportedParameterError as error:
                    self.assertEqual(error.parameter_names,(name,))
                    output=io.StringIO()
                    with patch.object(guard,'main',side_effect=error),contextlib.redirect_stderr(output):
                        self.assertEqual(guard.cli(),1)
                    self.assertIn(name,output.getvalue())
                    self.assertNotIn('SYNTHETIC_PRIVATE_VALUE',output.getvalue())
                    self.assertNotIn('postgresql://',output.getvalue())
                else:self.fail('unsupported parameter accepted')

    def test_nonstandard_parameter_names_are_redacted(self):
        from urllib.parse import quote
        safe='postgresql://neondb_owner:synthetic@'+guard.HOST+'/neondb?sslmode=require&sslaccept=strict'
        for name in ['https://private.example/path','name with space','x'*100]:
            with self.assertRaises(guard.UnsupportedParameterError) as error:
                guard.validate_url(safe+'&'+quote(name,safe='')+'=SYNTHETIC_PRIVATE_VALUE')
            self.assertEqual(error.exception.parameter_names,('<nonstandard-name-redacted>',))


if __name__ == '__main__':
    unittest.main()
