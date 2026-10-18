import importlib.util
from pathlib import Path
import re
import sys
import unittest
from unittest.mock import patch
from datetime import datetime, timezone, timedelta

spec=importlib.util.spec_from_file_location('behavior',Path(__file__).with_name('phase4-behavior.py'))
behavior=importlib.util.module_from_spec(spec)
spec.loader.exec_module(behavior)


class NativePreparationTests(unittest.TestCase):
    def snapshot(self):
        sums={name:'synthetic' for name in behavior.migration.NAMES}
        ledger=[dict(migration_name=n,checksum='synthetic',finished_at='complete',rolled_back_at=None) for n in behavior.migration.NAMES]
        triggers=[]
        for name in behavior.migration.NAMES:
            sql=(behavior.guard.BACKEND/'prisma/migrations'/name/'migration.sql').read_text()
            triggers += [['table',n,'definition','O'] for n in re.findall(r'CREATE(?: CONSTRAINT)? TRIGGER "([^"]+)"',sql)]
        return sums,dict(ledger=ledger,metadata=dict(triggers=triggers,columns=[[str(i)] for i in range(37)]))

    def test_unapproved_invocation_cannot_start_process_or_network(self):
        with patch.object(sys,'argv',['phase4-behavior.py']),patch.object(behavior.guard,'run_group') as process,patch.object(behavior,'build_opener') as network:
            with self.assertRaises(ValueError):behavior.main()
            process.assert_not_called();network.assert_not_called()

    def test_requires_seven_successful_migrations(self):
        sums,snapshot=self.snapshot();behavior.verify_migrated(snapshot,sums)
        snapshot['ledger'].pop()
        with self.assertRaises(ValueError):behavior.verify_migrated(snapshot,sums)

    def test_missing_or_disabled_trigger_blocks_fixtures(self):
        sums,snapshot=self.snapshot();snapshot['metadata']['triggers'].pop()
        with self.assertRaises(ValueError):behavior.verify_migrated(snapshot,sums)
        sums,snapshot=self.snapshot();snapshot['metadata']['triggers'][0][3]='D'
        with self.assertRaises(ValueError):behavior.verify_migrated(snapshot,sums)

    def test_native_environment_never_inherits_production(self):
        url='postgresql://neondb_owner:synthetic@'+behavior.guard.HOST+'/neondb?sslmode=require&sslaccept=strict'
        with patch.dict(behavior.guard.os.environ,{'DATABASE_URL':'PRODUCTION','DIRECT_URL':'PRODUCTION','NODE_OPTIONS':'evil'}):
            env=behavior.prepared_environment(url,datetime.now(timezone.utc)+timedelta(hours=2))
        for key in ['DATABASE_URL','DIRECT_URL','NODE_OPTIONS']:self.assertNotIn(key,env)
        self.assertEqual(env['PHASE4_VALIDATION_DATABASE_URL'],url)
        self.assertEqual(env['PHASE4_NATIVE_AUTHORIZED'],behavior.guard.BRANCH)
        self.assertRegex(env['PHASE4_RUN_ID'],r'^p4_[a-f0-9]{16}$')

    def test_catalog_drift_blocks_execution(self):
        metadata={'triggers':['synthetic']}
        digest=behavior.hashlib.sha256(behavior.json.dumps(metadata,sort_keys=True,separators=(',', ':')).encode()).hexdigest()
        with patch.object(behavior,'EXPECTED_CATALOG_SHA256',digest):
            behavior.verify_catalog(metadata)
            with self.assertRaises(ValueError):behavior.verify_catalog({'triggers':[]})



class DiagnosticsTests(unittest.TestCase):
    def test_failed_process_preserves_safe_diagnostics_without_retry(self):
        import tempfile, contextlib, io, json
        for category in ('PROCESS_FAILED','PROCESS_TIMEOUT','PROCESS_INTERRUPTED','PROCESS_CLEANUP_UNCONFIRMED'):
            def failed(*args, **kwargs):
                path=Path(args[2]['PHASE4_DIAGNOSTICS_PATH'])
                path.write_text(json.dumps(dict(event='case_result',test_id='P4-N01',state='failed',category='DATABASE_CONSTRAINT',sqlstate='23505',duration_ms=42,secret='DO_NOT_PRINT'))+'\n')
                raise behavior.guard.ProcessFailure(category)
            output=io.StringIO()
            with tempfile.TemporaryDirectory() as directory, patch.object(behavior.tempfile,'mkdtemp',return_value=directory), patch.object(behavior.guard,'run_group',side_effect=failed) as process, contextlib.redirect_stdout(output):
                with self.assertRaises(ValueError):behavior.run_native('node',{})
                process.assert_called_once()
                report=json.loads((Path(directory)/'sanitized.jsonl').read_text())
                self.assertEqual(report['process_category'],category)
                self.assertEqual(report['records'][0]['sqlstate'],'23505')
                self.assertNotIn('DO_NOT_PRINT',output.getvalue())

    def test_malicious_report_fields_are_not_echoed(self):
        import tempfile,json
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'safe'
            path.write_text(json.dumps(dict(event='case_result',test_id='SECRET',category='SECRET',sqlstate='SECRET',state='SECRET',duration_ms='SECRET')))
            self.assertNotIn('SECRET',json.dumps(behavior.safe_records(path)))

    def test_interrupted_case_retains_static_name_and_elapsed_duration(self):
        import tempfile,json
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'safe'
            path.write_text(json.dumps(dict(event='case_started',test_id='P4-N01',start_ms=1000)))
            with patch.object(behavior.time,'time',return_value=2):
                record=behavior.safe_records(path)[0]
            self.assertEqual(record['elapsed_at_report_ms'],1000)
            self.assertIn('registrations',record['test'])

    def test_duplicate_stage_diagnostics_survive_parent_redaction(self):
        import tempfile,json
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'safe'
            path.write_text(json.dumps(dict(event='duplicate_stage',test_id='P4-N02',assertion_stage='REJECTION_CONTEXT',session_ids=[123,456,'SECRET'],outcomes=['fulfilled','rejected'],fixture_valid=True,rejections=[dict(prisma_codes=['P2002','SECRET'],sqlstates=['23505','SECRET'],rejection_context='DUPLICATE_MARKER',unexpected_code=False,message='SECRET')],message='SECRET')))
            record=behavior.safe_records(path)[0]
            self.assertEqual(record['assertion_stage'],'REJECTION_CONTEXT')
            self.assertEqual(record['session_ids'],[123,456])
            self.assertEqual(record['rejections'][0]['prisma_codes'],['P2002'])
            self.assertNotIn('SECRET',json.dumps(record))

    def test_verified_detail_context_survives_sanitization(self):
        import tempfile,json
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'safe'
            path.write_text(json.dumps(dict(event='duplicate_stage',test_id='P4-N02',assertion_stage='REJECTION_CONTEXT',rejections=[dict(prisma_codes=['P2010'],sqlstates=['23505'],rejection_context='VERIFIED_DUPLICATE_DETAIL',unexpected_code=False,detail='SECRET')])) )
            row=behavior.safe_records(path)[0]
            self.assertEqual(row['rejections'][0]['rejection_context'],'VERIFIED_DUPLICATE_DETAIL')
            self.assertNotIn('SECRET',json.dumps(row))

    def test_missing_completion_is_failure(self):
        import tempfile,contextlib,io
        with tempfile.TemporaryDirectory() as directory, patch.object(behavior.tempfile,'mkdtemp',return_value=directory), patch.object(behavior.guard,'run_group') as process, contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(ValueError):behavior.run_native('node',{})
            process.assert_called_once()

if __name__=='__main__':unittest.main()
