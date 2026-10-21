"""Only fake process, IPC and filesystem boundaries. No listeners or child launches."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
ROOT=Path(__file__).parent

def module(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/(name+'.py'))
    obj=importlib.util.module_from_spec(spec);sys.modules[name]=obj;spec.loader.exec_module(obj);return obj
sup=module('supervisor');wd=module('watchdog')
DOC=json.loads((ROOT/'cases.json').read_text())
class Controls:
    def verify(self,*_): return True
class Evidence:
    def __init__(self,fail=None): self.files=[];self.fail=fail
    def publish(self,name,record):
        if self.fail is True or name==self.fail: raise OSError('synthetic')
        self.files.append(dict(name=name,record=record))
class Bridge:
    def __init__(self): self.events=[];self.clean='CLEAN';self.bad=None
    def start_phase(self,p):self.events.append('start-'+p)
    def arm_case(self,c):self.events.append('arm-'+c)
    def single_request(self,c):
        self.events.append('request-'+c['id'])
        r=dict(status='PASS',unknown=False,response=c['expected']['response'][0],upstream_requests=c['expected']['upstream_requests'],checks={x:True for x in c['expected']['checks']})
        if self.bad:self.bad(r)
        return r
    def stop_and_verify(self):self.events.append('stop');return self.clean
class Platform:
    def __init__(self):self.reserved=True;self.exited=False;self.descendants=False;self.absent=True;self.ports=True;self.signals=[];self.reaps=[]
    def identity_reserved(self,_):return self.reserved
    def signal_owned_group(self,i,s):self.signals.append((i.handle,s));return True
    def exited_without_reap(self,_):return self.exited
    def no_live_descendants(self,_):return not self.descendants
    def reap_owned_child(self,i):self.reaps.append(i.handle);return True
    def group_absent(self,_):return self.absent
    def listeners_released(self,_):return self.ports

def manifest():
    return dict(version=1,inputs={x:dict(sha256=sup.CASE_FILE_DIGEST if x=='cases' else 'a'*64) for x in sup.REQUIRED_ROLES},approvals={x:'not-authority' for x in sup.REQUIRED_APPROVALS},origins=['http://localhost:3002','http://127.0.0.1:3001'],run_id='mock-run',case_digest=sup.CASE_DIGEST,deadlines=dict(total_seconds=180,startup_seconds=30,cleanup_seconds=9))
class Tests(unittest.TestCase):
    def authorized(self,evidence=None):
        now=[0];g=sup.AuthorizationGate(Controls(),lambda *_:True,lambda:now[0]);m=manifest();d=copy.deepcopy(DOC);token=g.validate(m,d);b=Bridge();return sup.Supervisor(b,evidence or Evidence(),g),b,g,m,d,token,now
    def run_authorized(self,items):
        s,b,g,m,d,t,n=items;return s.run(d,m,t)
    def dog(self):
        n=[0];p=Platform();d=wd.Watchdog(p,lambda:n[0],case_plan={'A':[('x',5)],'B':[('y',5)]});d.phase_start('A')
        for h,pid in [('frontend',100),('upstream',101)]:d.own(wd.Identity(h,pid,pid,pid,'birth'))
        d.ready();return d,p,n
    def test_inventory_pin(self):
        self.assertEqual(sup.case_digest(DOC),sup.CASE_DIGEST);self.assertEqual(len(DOC['cases']),38);sup.validate_cases(DOC)
    def test_direct_run_blocked(self):
        b=Bridge()
        with self.assertRaises(sup.Blocked):sup.Supervisor(b,Evidence()).run(DOC)
        self.assertEqual(b.events,[])
    def test_default_issuer_blocked_despite_approval_strings(self):
        with self.assertRaises(sup.Blocked):sup.AuthorizationGate().validate(manifest(),DOC)
    def test_forged_stale_and_reused_authorization(self):
        for mode in ('forged','stale','manifest','cases'):
            x=self.authorized();s,b,g,m,d,t,n=x
            if mode=='forged':t='not-authority'
            if mode=='stale':n[0]=30
            if mode=='manifest':m['inputs']['node']['sha256']='b'*64
            if mode=='cases':d['cases'][0]['request']['target']='/changed'
            with self.subTest(mode=mode),self.assertRaises(sup.Blocked):s.run(d,m,t)
            self.assertEqual(b.events,[])
            with self.assertRaises(sup.Blocked):s.run(DOC,m,t)
    def test_success_phase_gating(self):
        x=self.authorized();self.assertEqual(self.run_authorized(x),'REVIEW_REQUIRED');b=x[1];self.assertEqual(b.events[b.events.index('start-B')-1],'stop')
    def test_unknown_cleanup_blocks_b(self):
        x=self.authorized();x[1].clean='UNKNOWN'
        with self.assertRaises(sup.Blocked):self.run_authorized(x)
        self.assertNotIn('start-B',x[1].events)
    def test_result_schema_negative(self):
        changes=[lambda r:r.update(status='FAIL'),lambda r:r.update(status='UNKNOWN'),lambda r:r.pop('unknown'),lambda r:r.update(unknown=0),lambda r:r.update(checks={}),lambda r:r.update(upstream_requests=True),lambda r:r.update(checks={k:1 for k in r['checks']})]
        for change in changes:
            x=self.authorized();x[1].bad=change
            with self.subTest(change=change),self.assertRaises(sup.Blocked):self.run_authorized(x)
            self.assertEqual(sum(e.startswith('request-') for e in x[1].events),1)
    def test_case_schema_adversarial(self):
        changes=[lambda c:c.update(extra=1),lambda c:c.update(deadline_seconds=True),lambda c:c.update(scenario='arbitrary'),lambda c:c['request'].update(method='CONNECT'),lambda c:c['request'].update(headers=[['bad\r\n','x']]),lambda c:c['request'].update(body=1),lambda c:c['expected'].update(checks=[]),lambda c:c['expected'].update(upstream_requests=True),lambda c:c['expected'].update(response=['HTTP_999'])]
        for change in changes:
            d=copy.deepcopy(DOC);change(d['cases'][0])
            with self.assertRaises(sup.Blocked):sup.validate_cases(d)
        d=copy.deepcopy(DOC);d['cases'][1]['id']=d['cases'][0]['id']
        with self.assertRaises(sup.Blocked):sup.validate_cases(d)
    def test_publication_failures_cleanup_no_completion(self):
        for fail in (True,'summary.json','completion.json'):
            e=Evidence(fail);x=self.authorized(e)
            with self.assertRaises(sup.Blocked):self.run_authorized(x)
            self.assertEqual(x[1].events[-1],'stop');self.assertNotIn('completion.json',[f['name'] for f in e.files])
    def test_wire_corrected_handshake_and_correlation(self):
        for c in DOC['cases']:
            wire=sup.render_request(c);self.assertLessEqual(len(wire),32768);self.assertIn(('transport-case='+c['id']).encode(),wire)
            if c['operation']=='upgrade':self.assertIn(b'dGhlIHNhbXBsZSBub25jZQ==',wire)
    def test_truthy_ownership_rejected(self):
        for value in ('UNKNOWN',1,{},None):
            p=Platform();p.reserved=value;d=wd.Watchdog(p);d.phase_start('A')
            with self.assertRaises(wd.SafetyStop):d.own(wd.Identity('frontend',100,100,100,'birth'))
            self.assertEqual(p.signals,[])
    def test_ready_requires_registry_and_identity(self):
        d=wd.Watchdog(Platform());d.phase_start('A')
        with self.assertRaises(wd.SafetyStop):d.ready()
        d.stop();self.assertFalse(d.confirm_cleanup())
    def test_ambiguous_observations_never_clean(self):
        for field in ('exited','absent','ports'):
            d,p,n=self.dog();p.exited=True;setattr(p,field,'UNKNOWN');d.stop();self.assertFalse(d.confirm_cleanup())
    def test_surviving_descendants_not_reaped(self):
        d,p,n=self.dog();p.exited=True;p.descendants=True;d.stop();self.assertFalse(d.confirm_cleanup());self.assertEqual(p.reaps,[]);n[0]=7;d.tick();self.assertEqual(len(p.signals),4)
    def test_deadline_not_extended(self):
        d,p,n=self.dog();d.stop();n[0]=3;d.stop();self.assertEqual(d.stop_deadline,7);n[0]=9;d.tick();self.assertEqual(d.state,'UNKNOWN')
    def test_total_deadline_shared_and_illegal_phases(self):
        d,p,n=self.dog();total=d.total_deadline
        with self.assertRaises(wd.SafetyStop):d.phase_start('B')
        d.request_start('x',5);d.request_done('x',True);d.phase_done();p.exited=True;d.stop();self.assertTrue(d.confirm_cleanup());n[0]=50;d.phase_start('B');self.assertEqual(d.total_deadline,total)
    def test_test_failure_separate_from_clean(self):
        d,p,n=self.dog();d.request_start('x',5)
        with self.assertRaises(wd.SafetyStop):d.request_done('x',False)
        p.exited=True;self.assertTrue(d.confirm_cleanup());self.assertEqual(d.test_status,'FAIL')
        with self.assertRaises(wd.SafetyStop):d.phase_start('B')
    def test_log_exhaustion_does_not_disable_cleanup(self):
        d,p,n=self.dog();d.records=[{}]*256;d.record('overflow');d.tick();self.assertEqual(d.state,'STOPPING');self.assertEqual(len(p.signals),2);p.exited=True;self.assertFalse(d.confirm_cleanup())
    def test_ipc_failure_cleanup_continues(self):
        p=Platform();p.authorized_case_plan=lambda _:{'A':[('x',5)],'B':[('y',5)]};p.independently_validated=lambda:True;p.register_owned_children=lambda *_:[wd.Identity('frontend',100,100,100,'birth'),wd.Identity('upstream',101,101,101,'birth')]
        n=[0];p.wait_tick=lambda seconds:n.__setitem__(0,n[0]+seconds)
        class Channel:
            def receive(self,_):return dict(run_id='mock-run',phase='A',case_id=None,op='STARTUP',seconds=None,passed=None)
            def send(self,_):raise OSError('IPC')
        result=wd.serve(Channel(),p,lambda:n[0]);self.assertEqual(result['cleanup'],'UNKNOWN');self.assertEqual(len(p.signals),4)
    def test_ipc_identity_and_case_binding(self):
        d,p,n=self.dog()
        for m in (dict(run_id='wrong',phase='A',case_id=None,op='STOP',seconds=None,passed=None),dict(run_id='mock-run',phase='B',case_id=None,op='STOP',seconds=None,passed=None)):
            with self.assertRaises(wd.SafetyStop):d.dispatch(m)
        d.request_start('x',5)
        with self.assertRaises(wd.SafetyStop):d.request_done('two',True)
    def test_permission_ambiguity_never_signals(self):
        d,p,n=self.dog();p.reserved='UNKNOWN';d.stop();n[0]=7;d.tick();self.assertEqual(p.signals,[])
    def test_reaped_group_never_signaled_again(self):
        d,p,n=self.dog();p.exited=True;d.stop();self.assertTrue(d.confirm_cleanup());n[0]=180;d.tick();self.assertEqual(len(p.signals),2)
    def test_evidence_write_failure_and_quota(self):
        e=object.__new__(sup.Evidence);e.fd=99;e.total=0;e.files=[]
        with patch.object(sup.os,'open',return_value=7),patch.object(sup.os,'write',return_value=0),patch.object(sup.os,'close'),patch.object(sup.os,'fsync'):
            with self.assertRaises(sup.Blocked):e.publish('x.json',{})
        self.assertEqual(e.files,[]);e.total=sup.MAX_EVIDENCE
        with self.assertRaises(sup.Blocked):e.publish('x.json',{})
    def test_preflight_controls_and_pin_rejection(self):
        class Denied:
            def verify(self,*_):return "UNKNOWN"
        for controls,reader in ((Denied(),lambda *_:True),(Controls(),lambda *_:False)):
            with self.assertRaises(sup.Blocked):sup.AuthorizationGate(controls,reader).validate(manifest(),DOC)
    def test_case_list_replacement_and_deadline_change_blocked(self):
        for mutate in (lambda m,d:m['deadlines'].update(total_seconds=181),lambda m,d:d['cases'].reverse(),lambda m,d:m.update(run_id='other-run')):
            x=self.authorized();s,b,g,m,d,t,n=x;mutate(m,d)
            with self.assertRaises(sup.Blocked):s.run(d,m,t)
            self.assertEqual(b.events,[])
    def test_stop_before_phase_pass_does_not_enable_b(self):
        d,p,n=self.dog();p.exited=True;d.stop();self.assertTrue(d.confirm_cleanup())
        with self.assertRaises(wd.SafetyStop):d.phase_start('B')
    def test_unapproved_case_and_deadline_rejected(self):
        d,p,n=self.dog()
        for case,seconds in (('other',5),('x',18),('x',True)):
            with self.assertRaises(wd.SafetyStop):d.request_start(case,seconds)
    def test_standalone_transfer_has_no_generated_length(self):
        c=next(c for c in DOC['cases'] if c['id']=='standalone-transfer')
        self.assertNotIn(b'Content-Length:',sup.render_request(c))
    def test_evidence_sync_close_and_exclusive_failures(self):
        for where in ('open','fsync','close'):
            e=object.__new__(sup.Evidence);e.fd=99;e.total=0;e.files=[]
            with patch.object(sup.os,'open',return_value=7) as opened,patch.object(sup.os,'write',side_effect=lambda fd,b:len(b)),patch.object(sup.os,'fsync') as sync,patch.object(sup.os,'close') as close:
                {'open':opened,'fsync':sync,'close':close}[where].side_effect=OSError('synthetic')
                with self.assertRaises(OSError):e.publish('x.json',{})
            self.assertEqual(e.files,[])
    def test_uncertain_reap_prevents_any_later_signal(self):
        d,p,n=self.dog();p.exited=True;d.stop()
        p.reap_owned_child=lambda _:"UNKNOWN"
        self.assertFalse(d.confirm_cleanup());n[0]=7;d.tick()
        self.assertNotIn(('frontend','KILL'),p.signals)
        self.assertFalse(d.confirm_cleanup())
    def test_malformed_and_cross_issuer_authorization_blocked(self):
        for malformed in (None,[],{},dict(manifest(),inputs=None)):
            with self.assertRaises(sup.Blocked):sup.AuthorizationGate(Controls(),lambda *_:True).validate(malformed,DOC)
        x=self.authorized();s,b,g,m,d,t,n=x
        other=sup.Supervisor(b,Evidence(),sup.AuthorizationGate(Controls(),lambda *_:True))
        with self.assertRaises(sup.Blocked):other.run(d,m,t)
        self.assertEqual(b.events,[])
    def test_bridge_cannot_replace_validated_expectations(self):
        x=self.authorized();b=x[1];original=b.single_request
        def mutated(case):
            case['expected']['checks']=[]
            return original(case)
        b.single_request=mutated
        with self.assertRaises(sup.Blocked):self.run_authorized(x)
        self.assertEqual(b.events[-1],'stop')
    def test_cli_blocked(self):
        with patch('builtins.print'):self.assertEqual(sup.command_line(),2);self.assertEqual(wd.command_line(),2)
if __name__=='__main__':unittest.main()
