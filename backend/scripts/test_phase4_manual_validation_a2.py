"""Only mocks: main is tested with all operational boundaries replaced."""
import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

import phase4_manual_validation_a2 as procedure


class ProcedureTests(unittest.TestCase):
    def adapter(self):
        ops = Mock()
        baseline = {name: {'allowed': True} for name in procedure.CHECKS if name != 'credentials'}
        baseline['credential_presence'] = dict.fromkeys(procedure.CREDENTIAL_KEYS, False)
        ops.control.return_value = baseline
        ops.check.side_effect = lambda name: (
            {'presence': dict.fromkeys(procedure.CREDENTIAL_KEYS, False)} if name == 'credentials'
            else {'allowed': name not in procedure.DENIED, 'code': 'EPERM'})
        return ops

    def test_complete_orchestration(self):
        ops = self.adapter()
        procedure.orchestrate(ops)
        self.assertEqual(ops.startup.call_args_list[0].args, (False,))
        self.assertEqual(ops.startup.call_args_list[1].args, (True,))
        self.assertEqual([call.args[0] for call in ops.check.call_args_list], list(procedure.CHECKS))
        ops.confirm_local_delivery.assert_called_once()
        ops.timeout.assert_called_once()
        self.assertEqual(ops.mock_calls[-1][0], 'timeout')

    def test_denial_success_or_unrelated_error_stops_immediately(self):
        for value in ({'allowed': True}, {'allowed': False, 'code': 'ENOENT'},
                      {'allowed': False, 'code': 'ECONNREFUSED'}, {'allowed': None, 'code': 'TIMEOUT'}):
            ops = self.adapter()
            original = ops.check.side_effect
            ops.check.side_effect = lambda name: value if name == 'denied_read' else original(name)
            with self.assertRaises(procedure.Stop):
                procedure.orchestrate(ops)
            self.assertEqual(ops.check.call_count, 2)
            ops.timeout.assert_not_called()

    def test_incomplete_positive_control_stops(self):
        ops = self.adapter()
        ops.control.return_value['localhost_udp'] = {'allowed': None}
        with self.assertRaises(procedure.Stop):
            procedure.orchestrate(ops)
        ops.check.assert_not_called()

    def test_existing_config_stops_before_reading_pins(self):
        with patch.object(procedure.os.path, 'lexists', return_value=True), \
                patch.object(Path, 'read_bytes') as read:
            with self.assertRaisesRegex(procedure.Stop, 'EXISTING_CONFIGURATION'):
                procedure.verify_inputs()
            read.assert_not_called()

    def test_fixture_mismatch_stops(self):
        with patch.object(procedure.os.path, 'lexists', return_value=False), \
                patch.object(Path, 'is_symlink', return_value=False), \
                patch.object(Path, 'is_file', return_value=True), \
                patch.object(Path, 'read_bytes', return_value=b'tampered'):
            with self.assertRaisesRegex(procedure.Stop, 'PIN_MISMATCH'):
                procedure.verify_inputs(pins={Path('/synthetic/file'): hashlib.sha256(b'expected').hexdigest()})

    def test_publication_failure_occurs_after_transport_cleanup_and_stops(self):
        events = []
        def completed(*args, **kwargs):
            events.append('transport_returned_after_cleanup')
            return {'synthetic': True}
        def save(*args):
            events.append('publication_failed')
            raise OSError('synthetic')
        ops = procedure.ManualOperations(Path('/synthetic'), Mock())
        with patch.object(procedure, 'run_probe', side_effect=completed) as run, \
                patch.object(procedure, 'save_exclusive', side_effect=save), \
                patch('sys.stderr'), patch.object(procedure, 'completion_ok') as acceptance:
            with self.assertRaisesRegex(procedure.Stop, 'EVIDENCE_PUBLICATION_UNKNOWN'):
                ops.run('synthetic', ['synthetic'])
            run.assert_called_once()
            acceptance.assert_not_called()
        self.assertEqual(events, ['transport_returned_after_cleanup', 'publication_failed'])

    def test_minimal_environment_excludes_mock_credentials(self):
        with patch.dict(procedure.os.environ, {k: 'SYNTHETIC' for k in procedure.CREDENTIAL_KEYS}):
            environment = procedure.minimal_environment()
        self.assertTrue(set(environment).isdisjoint(procedure.CREDENTIAL_KEYS))
        self.assertEqual(set(environment), {'LANG', 'LC_ALL', 'TZ', 'TMPDIR'})

    def test_every_probe_has_fixed_config_and_no_external_destination(self):
        for name in procedure.CHECKS:
            source = procedure.probe_source(name)
            self.assertIn(json.dumps(str(procedure.CONFIG)), source)
            self.assertNotIn('https:', source)
            if name in ('localhost_tcp', 'localhost_udp'):
                self.assertIn('127.0.0.1', source)
        with self.assertRaises(procedure.Stop):
            procedure.probe_source('unknown')

    def test_configuration_creation_is_exclusive_and_never_retried(self):
        with patch.object(procedure.os, 'open', side_effect=FileExistsError) as opened:
            with self.assertRaises(FileExistsError):
                procedure.save_exclusive(Path('/synthetic/config'), {})
        opened.assert_called_once()
        flags = opened.call_args.args[1]
        self.assertTrue(flags & procedure.os.O_EXCL)
        self.assertTrue(flags & procedure.os.O_NOFOLLOW)
        self.assertFalse(flags & procedure.os.O_TRUNC)

    def test_close_continues_after_socket_error(self):
        ops = procedure.ManualOperations(Path('/synthetic'), Mock())
        ops.tcp, ops.udp = Mock(), Mock()
        ops.tcp.close.side_effect = OSError('synthetic')
        with self.assertRaises(procedure.Stop):
            ops.close()
        ops.udp.close.assert_called_once()


class PublicationTests(unittest.TestCase):
    def test_writer_failures_never_acknowledged(self):
        for stage in ('write', 'flush', 'fsync', 'close', 'directory'):
            with self.subTest(stage=stage):
                stream = Mock()
                stream.write.side_effect = lambda value: len(value)
                if stage in ('write', 'flush', 'close'):
                    getattr(stream, stage).side_effect = OSError('synthetic ' + stage)
                with patch.object(procedure.os, 'open', return_value=123), \
                        patch.object(procedure.os, 'fdopen', return_value=stream), \
                        patch.object(procedure.os, 'fsync',
                                     side_effect=OSError('synthetic') if stage == 'fsync' else None), \
                        patch.object(procedure, 'sync_directory',
                                     side_effect=OSError('synthetic') if stage == 'directory' else None) as sync:
                    with self.assertRaises(OSError):
                        procedure.save_exclusive(Path('/synthetic/evidence'), {})
                stream.close.assert_called_once()
                if stage != 'directory':
                    sync.assert_not_called()

    def test_writer_success_syncs_after_close(self):
        events = []
        stream = Mock()
        stream.write.side_effect = lambda value: events.append('write') or len(value)
        stream.flush.side_effect = lambda: events.append('flush')
        stream.close.side_effect = lambda: events.append('close')
        with patch.object(procedure.os, 'open', return_value=123), \
                patch.object(procedure.os, 'fdopen', return_value=stream), \
                patch.object(procedure.os, 'fsync', side_effect=lambda fd: events.append('fsync')), \
                patch.object(procedure, 'sync_directory', side_effect=lambda path: events.append('directory')):
            procedure.save_exclusive(Path('/synthetic/evidence'), {})
        self.assertEqual(events, ['write', 'flush', 'fsync', 'close', 'directory'])

    def test_short_write_fails(self):
        stream = Mock()
        stream.write.return_value = 0
        with patch.object(procedure.os, 'open', return_value=123), \
                patch.object(procedure.os, 'fdopen', return_value=stream), \
                patch.object(procedure, 'sync_directory') as sync:
            with self.assertRaisesRegex(procedure.Stop, 'SHORT_EVIDENCE_WRITE'):
                procedure.save_exclusive(Path('/synthetic/evidence'), {})
        stream.close.assert_called_once()
        sync.assert_not_called()

    def test_directory_sync_failure_still_closes_fd(self):
        with patch.object(procedure.os, 'open', return_value=123), \
                patch.object(procedure.os, 'fsync', side_effect=OSError('synthetic')), \
                patch.object(procedure.os, 'close') as close:
            with self.assertRaises(OSError):
                procedure.sync_directory(Path('/synthetic'))
        close.assert_called_once_with(123)

    def simulation(self, *, interrupt=None, failure=None, missing=None, emit_failure=False):
        evidence = Path('/synthetic/evidence')
        cancellation = procedure.ManualCancellation()
        paths = {name: evidence / name for name in procedure.REQUIRED_FILES if name != 'summary.json'}
        store = {path: b'SYNTHETIC' for path in paths.values()}
        if missing:
            del paths[missing]
        emitted = []
        saved = []

        def save(path, value):
            self.assertNotIn(path, store)
            saved.append(path.name)
            # A partial candidate may remain, even when publication then fails.
            store[path] = (json.dumps(value, indent=2) + '\n').encode()
            if interrupt == path.name:
                cancellation.handle_sigint(procedure.signal.SIGINT, None)
            if failure == path.name:
                raise OSError('synthetic publication failure')

        def emit(value, **kwargs):
            emitted.append(json.loads(value))
            if interrupt == 'receipt' and emitted[-1].get('event') == 'FINALIZATION_RECEIPT':
                cancellation.handle_sigint(procedure.signal.SIGINT, None)
            if emit_failure:
                raise OSError('synthetic terminal failure')

        summary = dict(protocol=1, state='PROVISIONAL', probe_result='PASSED',
                       builder_enabled=False, database_execution=False)
        if interrupt == 'before':
            cancellation.handle_sigint(procedure.signal.SIGINT, None)
        original_boundary = procedure.ManualCancellation.mark_application_complete

        def boundary(instance):
            if interrupt == 'boundary-before':
                instance.handle_sigint(procedure.signal.SIGINT, None)
            original_boundary(instance)
            if interrupt == 'boundary-after':
                instance.handle_sigint(procedure.signal.SIGINT, None)

        with patch.object(procedure, 'save_exclusive', side_effect=save), \
                patch.object(Path, 'read_bytes', autospec=True, side_effect=lambda path: store[path]), \
                patch.object(procedure.ManualCancellation, 'mark_application_complete', boundary):
            code = procedure.finalize(evidence, summary, cancellation, paths, emit=emit)
        hashes = {path.name: hashlib.sha256(data).hexdigest() for path, data in store.items()}
        marker = json.loads(store.get(evidence / 'completion.json', b'{}'))
        receipt = next((item for item in emitted if item.get('event') == 'FINALIZATION_RECEIPT'), {})
        accepted = procedure.acceptance_ok(summary, marker, receipt, code, hashes,
                                           interruption_observed=cancellation.requested)
        return code, accepted, saved, marker, receipt, hashes, summary, cancellation

    def test_sigint_during_summary_publication(self):
        code, accepted, saved, *_ = self.simulation(interrupt='summary.json')
        self.assertEqual(code, 1)
        self.assertFalse(accepted)
        self.assertEqual(saved, ['summary.json'])

    def test_sigint_immediately_after_completion_publication(self):
        code, accepted, saved, *_ = self.simulation(interrupt='completion.json')
        self.assertEqual(code, 1)
        self.assertFalse(accepted)
        self.assertEqual(saved, ['summary.json', 'completion.json'])

    def test_sigint_during_receipt_never_exits_zero(self):
        code, accepted, *_ = self.simulation(interrupt='receipt')
        self.assertEqual(code, 1)
        self.assertFalse(accepted)

    def test_late_handler_raises_in_application_context_not_shutdown_guarantee(self):
        *_, cancellation = self.simulation()
        self.assertTrue(cancellation.application_finalized)
        with self.assertRaises(SystemExit) as raised:
            cancellation.handle_sigint(procedure.signal.SIGINT, None)
        self.assertEqual(raised.exception.code, 130)

    def test_cancelled_before_finalization_never_publishes(self):
        code, accepted, saved, *_, cancellation = self.simulation(interrupt='before')
        self.assertEqual(code, 1)
        self.assertFalse(accepted)
        self.assertFalse(cancellation.application_finalized)
        self.assertEqual(saved, [])

    def test_cancellation_at_boundary_is_conservative(self):
        for position, crossed in (('boundary-before', False), ('boundary-after', True)):
            with self.subTest(position=position):
                code, accepted, *_, cancellation = self.simulation(interrupt=position)
                self.assertEqual(code, 1)
                self.assertFalse(accepted)
                self.assertEqual(cancellation.application_finalized, crossed)

    def test_receipt_interruption_prevents_boundary(self):
        code, accepted, *_, cancellation = self.simulation(interrupt='receipt')
        self.assertEqual(code, 1)
        self.assertFalse(accepted)
        self.assertFalse(cancellation.application_finalized)

    def test_boundary_cannot_be_marked_without_arming(self):
        cancellation = procedure.ManualCancellation()
        with self.assertRaisesRegex(procedure.Stop, 'FINALIZATION_NOT_ARMED'):
            cancellation.mark_application_complete()
        self.assertFalse(cancellation.application_finalized)

    def test_zero_status_does_not_override_post_boundary_interruption_or_unknown(self):
        code, accepted, _, marker, receipt, hashes, summary, cancellation = self.simulation()
        self.assertTrue(cancellation.application_finalized)
        self.assertEqual(code, 0)
        self.assertTrue(accepted)
        for observation in (True, None):
            self.assertFalse(procedure.acceptance_ok(summary, marker, receipt, 0, hashes,
                             interruption_observed=observation))
        self.assertFalse(procedure.acceptance_ok(summary, marker, receipt, 0, hashes))

    def test_summary_or_completion_failure_keeps_artifact_unaccepted(self):
        for name in ('summary.json', 'completion.json'):
            with self.subTest(name=name):
                code, accepted, *_ = self.simulation(failure=name)
                self.assertEqual(code, 1)
                self.assertFalse(accepted)

    def test_incomplete_required_set_never_gets_marker(self):
        code, accepted, saved, *_ = self.simulation(missing='1-startup-control.json')
        self.assertEqual(code, 1)
        self.assertFalse(accepted)
        self.assertEqual(saved, ['summary.json'])

    def test_success_consistent_artifacts_and_exit_status(self):
        code, accepted, saved, marker, receipt, hashes, summary, _ = self.simulation()
        self.assertEqual(code, 0)
        self.assertTrue(accepted)
        self.assertEqual(saved, ['summary.json', 'completion.json'])
        self.assertEqual(marker['state'], 'COMPLETION_CANDIDATE')
        self.assertEqual(summary['state'], 'PROVISIONAL')
        for name in hashes:
            incomplete = {key: value for key, value in hashes.items() if key != name}
            self.assertFalse(procedure.acceptance_ok(summary, marker, receipt, 0, incomplete,
                             interruption_observed=False))
        self.assertFalse(procedure.acceptance_ok(summary, marker, {}, 0, hashes,
                         interruption_observed=False))
        self.assertFalse(procedure.acceptance_ok(summary, marker, receipt, None, hashes,
                         interruption_observed=False))
        self.assertFalse(procedure.acceptance_ok(summary, marker, receipt, 130, hashes,
                         interruption_observed=False))

    def test_terminal_publication_failure_never_accepted(self):
        code, accepted, *_ = self.simulation(emit_failure=True)
        self.assertEqual(code, 1)
        self.assertFalse(accepted)

    def test_main_interrupted_finalization_returns_nonzero_with_no_operational_calls(self):
        ops = Mock(sequence=13, required_paths={name: Path('/synthetic') / name
                   for name in procedure.REQUIRED_FILES if name != 'summary.json'})
        def interrupt(evidence, summary, cancellation, paths):
            cancellation.handle_sigint(procedure.signal.SIGINT, None)
            return 1
        # Only main's wiring is exercised; no real files, children or sockets.
        with patch.object(procedure, 'verify_inputs'), \
                patch.object(procedure.tempfile, 'mkdtemp', return_value='/synthetic'), \
                patch.object(procedure, 'sync_directory'), \
                patch.object(procedure, 'ManualOperations', return_value=ops), \
                patch.object(procedure, 'orchestrate'), \
                patch.object(procedure.signal, 'signal') as install, \
                patch.object(procedure, 'finalize', side_effect=interrupt) as finalize, \
                patch('builtins.print'):
            code = procedure.main(['--owner-approved-manual-validation'])
        self.assertEqual(code, 1)
        ops.close.assert_called_once()
        self.assertEqual(install.call_count, 1)  # No restoration gap at CLI exit.
        self.assertEqual(finalize.call_args.args[1]['probe_result'], 'PASSED')
        self.assertTrue(finalize.call_args.args[2].requested)

    def test_main_success_propagates_finalized_zero(self):
        ops = Mock(sequence=13, required_paths={name: Path('/synthetic') / name
                   for name in procedure.REQUIRED_FILES if name != 'summary.json'})
        with patch.object(procedure, 'verify_inputs'), \
                patch.object(procedure.tempfile, 'mkdtemp', return_value='/synthetic'), \
                patch.object(procedure, 'sync_directory'), \
                patch.object(procedure, 'ManualOperations', return_value=ops), \
                patch.object(procedure, 'orchestrate'), \
                patch.object(procedure.signal, 'signal'), \
                patch.object(procedure, 'finalize', return_value=0) as finalize, \
                patch('builtins.print'):
            self.assertEqual(procedure.main(['--owner-approved-manual-validation']), 0)
        self.assertEqual(finalize.call_args.args[1]['probe_result'], 'PASSED')


if __name__ == '__main__':
    unittest.main()
