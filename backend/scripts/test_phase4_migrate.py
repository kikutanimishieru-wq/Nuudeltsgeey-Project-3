import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('runner',Path(__file__).with_name('phase4-migrate.py'))
runner=importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class ExecutionGuardTests(unittest.TestCase):
    def test_no_execution_flag_never_starts_process(self):
        with patch.object(sys,'argv',['phase4-migrate.py']), patch.object(runner.guard,'run_group') as process:
            with self.assertRaises(ValueError):
                runner.main()
            process.assert_not_called()

    def test_failed_missing_wrong_checksum_or_duplicate_ledger_rejected(self):
        name=runner.NAMES[0]
        row=dict(migration_name=name,checksum='synthetic',finished_at='completed',rolled_back_at=None)
        runner.validate_ledger([row],[name],{name:'synthetic'})
        for rows in [[],[row,row],[{**row,'checksum':'wrong'}],[{**row,'finished_at':None}],
                     [{**row,'rolled_back_at':'rolled back'}]]:
            with self.subTest(rows=rows),self.assertRaises(ValueError):
                runner.validate_ledger(rows,[name],{name:'synthetic'})

    def test_schema_changes_stop_execution(self):
        expected={'constraints':[['capacity','CHECK capacity > 0']], 'triggers':[['snapshot','enabled']]}
        runner.validate_schema(expected,expected)
        for actual in [{**expected,'constraints':[]},{**expected,'triggers':[]},
                       {**expected,'triggers':[['snapshot','disabled']]}]:
            with self.assertRaises(ValueError):
                runner.validate_schema(actual,expected)

    def fixtures(self):
        sums={name:'synthetic' for name in runner.NAMES}
        def ledger(names):return [dict(migration_name=n,checksum='synthetic',finished_at='done',rolled_back_at=None) for n in names]
        ref={'foundation':{'f':1},'final':{'f':2}}
        states=[{'ledger':[],'metadata':ref['foundation']},
                {'ledger':ledger(runner.NAMES[:1]),'metadata':ref['foundation']},
                {'ledger':ledger(runner.NAMES),'metadata':ref['final']}]
        return sums,ref,states

    def test_successful_mock_sequence_only(self):
        sums,ref,states=self.fixtures();identity=unittest.mock.Mock();remote=unittest.mock.Mock(side_effect=states);command=unittest.mock.Mock()
        runner.execute_sequence(identity,remote,command,ref,sums)
        self.assertEqual(identity.call_count,3)
        self.assertEqual([c.args[0][1] for c in command.call_args_list],['resolve','deploy'])

    def test_wrong_or_expired_or_protected_identity_prevents_writes(self):
        from datetime import datetime,timezone,timedelta
        now=datetime.now(timezone.utc)
        g=runner.guard
        branch=dict(id=g.BRANCH,project_id=g.PROJECT,name='phase4-validation-v3',current_state='ready',primary=False,default=False,protected=False,expires_at=(now+timedelta(hours=2)).isoformat())
        endpoint=dict(id=g.ENDPOINT,project_id=g.PROJECT,branch_id=g.BRANCH,host=g.HOST,disabled=False)
        for key,value in [('id','production'),('project_id','other'),('protected',True),('expires_at',now.isoformat())]:
            sums,ref,states=self.fixtures();command=unittest.mock.Mock()
            with self.assertRaises(ValueError):
                runner.execute_sequence(lambda:g.validate_metadata({**branch,key:value},endpoint,now),unittest.mock.Mock(side_effect=states),command,ref,sums)
            command.assert_not_called()

    def test_late_identity_failure_prevents_next_write(self):
        for call_number in [2,3]:
            sums,ref,states=self.fixtures();command=unittest.mock.Mock()
            identity=unittest.mock.Mock(side_effect=[None]*(call_number-1)+[ValueError('blocked')])
            with self.assertRaises(ValueError):runner.execute_sequence(identity,unittest.mock.Mock(side_effect=states),command,ref,sums)
            self.assertEqual(command.call_count,call_number-2)

    def test_baseline_or_deploy_failure_stops_sequence(self):
        for fail_at in [1,2]:
            sums,ref,states=self.fixtures();command=unittest.mock.Mock(side_effect=[None]*(fail_at-1)+[ValueError('blocked')]);remote=unittest.mock.Mock(side_effect=states)
            with self.assertRaises(ValueError):runner.execute_sequence(lambda:None,remote,command,ref,sums)
            self.assertEqual(command.call_count,fail_at)
            self.assertEqual(remote.call_count,fail_at)

    def test_unexpected_history_stops_before_next_write(self):
        for state_index in [0,1,2]:
            sums,ref,states=self.fixtures();states[state_index]['ledger'].append(dict(migration_name='unexpected',checksum='synthetic',finished_at='done',rolled_back_at=None))
            command=unittest.mock.Mock()
            with self.assertRaises(ValueError):runner.execute_sequence(lambda:None,unittest.mock.Mock(side_effect=states),command,ref,sums)
            self.assertEqual(command.call_count,state_index)

    def test_security_catalog_mismatches_fail_closed(self):
        for key in ['table_acl','function_acl','policies','views','relations']:
            with self.assertRaises(ValueError):runner.validate_schema({'security':{key:['unexpected']}},{'security':{key:None}})

    def test_production_environment_cannot_override_cli(self):
        url='postgresql://neondb_owner:synthetic@'+runner.guard.HOST+'/neondb?sslmode=require&sslaccept=strict'
        with patch.dict(runner.guard.os.environ,{'DATABASE_URL':'PRODUCTION','DIRECT_URL':'PRODUCTION','PRISMA_SCHEMA_ENGINE_BINARY':'evil','NODE_OPTIONS':'evil'}):
            env=runner.cli_environment(url)
        self.assertEqual(env['DATABASE_URL'],url)
        self.assertEqual(env['PHASE4_VALIDATION_DATABASE_URL'],url)
        for key in ['DIRECT_URL','PRISMA_SCHEMA_ENGINE_BINARY','NODE_OPTIONS']:
            self.assertNotIn(key,env)


if __name__=='__main__':
    unittest.main()
