"""Mock-only tests: no processes, sockets, sandbox, database or fixture writes."""
import errno
import signal
import subprocess
import unittest
from unittest.mock import Mock, patch

import phase4_manual_controller_corrected as controller


class ControllerTests(unittest.TestCase):
    def simulate(self, signal_error=None, group_error=errno.ESRCH, code=0,
                 wait_error=None):
        child = Mock(pid=70428, returncode=None)
        child.wait.side_effect = wait_error
        child.wait.return_value = code
        events = []

        def killpg(pgid, sig):
            events.append(('signal', pgid, sig))
            failure = signal_error if sig == signal.SIGKILL else group_error
            if failure:
                raise OSError(failure, 'synthetic')

        def wait(timeout):
            events.append(('wait',))
            if wait_error:
                raise wait_error
            return code

        child.wait.side_effect = wait
        result = controller.terminate_tracked(child, child.pid, killpg=killpg,
                                             clock=lambda: 0, pause=Mock(), grace=0)
        return result, events

    def report(self, termination, timeout=False, code=None):
        return dict(termination=termination, timeout=timeout, interrupted=False,
                    failure=None, returncode=termination['returncode'] if code is None else code,
                    stdout='OK\n', stderr='')

    def test_normal_exit_eperm_is_absence_not_signal_success(self):
        result, events = self.simulate(signal_error=errno.EPERM)
        self.assertTrue(result['confirmed'])
        self.assertEqual(result['signal_result'], 'UNCONFIRMED')
        self.assertEqual(result['signal_errno'], errno.EPERM)
        self.assertFalse(result['signal_delivery_confirmed'])
        self.assertTrue(controller.completion_ok(self.report(result), expected_stdout='OK\n'))
        self.assertEqual(events, [('signal', 70428, signal.SIGKILL), ('wait',),
                                  ('signal', 70428, 0)])

    def test_successful_forced_termination(self):
        result, _ = self.simulate(code=-9)
        self.assertTrue(controller.completion_ok(self.report(result, True),
                        expected_stdout='OK\n', timeout_expected=True))

    def test_surviving_descendants_block(self):
        result, events = self.simulate(group_error=None)
        self.assertFalse(result['confirmed'])
        self.assertEqual(result['error'], 'GROUP_PRESENT_OR_REUSED')
        self.assertEqual(sum(e == ('signal', 70428, signal.SIGKILL) for e in events), 1)

    def test_permission_ambiguity_blocks(self):
        result, _ = self.simulate(group_error=errno.EPERM)
        self.assertFalse(result['confirmed'])
        self.assertEqual(result['group_check_errno'], errno.EPERM)

    def test_timeout_unsuccessful_signal_delivery_blocks(self):
        for error in (errno.EPERM, errno.ESRCH):
            with self.subTest(error=error):
                result, _ = self.simulate(signal_error=error, code=-9)
                self.assertTrue(result['confirmed'])
                self.assertFalse(controller.completion_ok(self.report(result, True),
                                 expected_stdout='OK\n', timeout_expected=True))

    def test_unexpected_exit_blocks_normal_completion(self):
        for code in (-9, 1):
            result, _ = self.simulate(code=code)
            self.assertFalse(controller.completion_ok(self.report(result), expected_stdout='OK\n'))

    def test_timeout_normal_exit_blocks(self):
        result, _ = self.simulate(code=0)
        self.assertFalse(controller.completion_ok(self.report(result, True),
                         expected_stdout='OK\n', timeout_expected=True))

    def test_group_reuse_never_resignaled(self):
        result, events = self.simulate(group_error=None)
        self.assertFalse(result['confirmed'])
        self.assertEqual(events[-1], ('signal', 70428, 0))
        self.assertEqual(len(events), 3)

    def test_reaped_or_wrong_identity_never_signaled(self):
        for pid, pgid, code in ((10, 11, None), (10, 10, 0), (1, 1, None)):
            kill = Mock()
            child = Mock(pid=pid, returncode=code)
            result = controller.terminate_tracked(child, pgid, killpg=kill)
            kill.assert_not_called()
            child.wait.assert_not_called()
            self.assertFalse(result['confirmed'])

    def test_child_not_reaped_blocks(self):
        result, events = self.simulate(wait_error=subprocess.TimeoutExpired('synthetic', 0))
        self.assertFalse(result['confirmed'])
        self.assertFalse(result['child_reaped'])
        self.assertEqual(len(events), 2)

    def test_cancel_or_transport_failure_blocks(self):
        result, _ = self.simulate()
        for key, value in (('interrupted', True), ('failure', 'synthetic'), ('stderr', 'error')):
            report = self.report(result)
            report[key] = value
            self.assertFalse(controller.completion_ok(report, expected_stdout='OK\n'))

    def test_sigint_sets_flag_without_raising(self):
        cancellation = controller.Cancellation()
        cancellation.handle_sigint(signal.SIGINT, None)
        self.assertTrue(cancellation.requested)

    def test_transport_refuses_missing_cancellation_handler_before_spawn(self):
        with patch.object(controller.signal, 'getsignal', return_value=signal.SIG_DFL), \
                patch.object(controller.subprocess, 'Popen') as spawn:
            with self.assertRaises(RuntimeError):
                controller.run_probe([], {}, '.', controller.Cancellation())
            spawn.assert_not_called()

    def transport(self, setup_failure=False, interrupt=False, cleanup_failure=False,
                  pipe_failure=False, termination_failure=False):
        cancellation = controller.Cancellation()
        child = Mock(pid=70428, returncode=None)
        selector = Mock()
        selector.get_map.return_value = {}
        if cleanup_failure:
            selector.close.side_effect = OSError('synthetic')
            child.stdout.close.side_effect = OSError('synthetic')
        termination = dict(confirmed=True, child_reaped=True, group_gone=True, returncode=0)

        def launch(*args, **kwargs):
            self.assertTrue(kwargs['start_new_session'])
            if interrupt:
                cancellation.handle_sigint(signal.SIGINT, None)
            return child

        with patch.object(controller.signal, 'getsignal', side_effect=lambda sig:
                          signal.SIG_DFL if sig == signal.SIGCHLD else cancellation.handle_sigint), \
                patch.object(controller.subprocess, 'Popen', side_effect=launch), \
                patch.object(controller.selectors, 'DefaultSelector',
                             side_effect=OSError('synthetic') if setup_failure else None,
                             return_value=selector), \
                patch.object(controller.os, 'set_blocking',
                             side_effect=OSError('synthetic') if pipe_failure else None), \
                patch.object(controller, 'terminate_tracked', return_value=termination,
                             side_effect=OSError('synthetic') if termination_failure else None) as terminate:
            report = controller.run_probe(['synthetic'], {}, '.', cancellation)
        terminate.assert_called_once_with(child, child.pid)
        child.stdout.close.assert_called_once()
        child.stderr.close.assert_called_once()
        return report

    def test_post_spawn_selector_failure_still_terminates(self):
        self.assertEqual(self.transport(setup_failure=True)['failure'], 'OSError')

    def test_interruption_during_launch_still_terminates(self):
        self.assertTrue(self.transport(interrupt=True)['interrupted'])

    def test_cleanup_exception_does_not_skip_other_cleanup(self):
        report = self.transport(cleanup_failure=True)
        self.assertEqual(report['failure'], 'CLEANUP_UNKNOWN')
        self.assertEqual(len(report['cleanup_errors']), 2)

    def test_pipe_setup_failure_still_terminates(self):
        self.assertEqual(self.transport(pipe_failure=True)['failure'], 'OSError')

    def test_termination_exception_still_closes_pipes_and_blocks(self):
        report = self.transport(termination_failure=True)
        self.assertFalse(report['termination']['confirmed'])
        self.assertEqual(report['failure'], 'CLEANUP_UNKNOWN')


if __name__ == '__main__':
    unittest.main()
