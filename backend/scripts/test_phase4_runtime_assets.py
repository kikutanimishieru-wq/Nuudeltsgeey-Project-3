"""C2 mocks only. No actual staging, subprocesses, sandbox, runtime imports or WASM."""
from contextlib import ExitStack
import ast
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import signal
import stat
import sys
import unittest
from unittest.mock import MagicMock, Mock, patch

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location('c2_assets_controller', SCRIPTS / 'phase4-runtime-assets-controller.py')
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)  # Definitions only; never main without mocked boundaries.


def diagnostic():
    return dict(protocol=1, scope='ASSET_READ_AND_WASM_COMPILE_ONLY', status='COMPILED_UNREVIEWED',
                assets=[dict(name=name, bytes=size, sha256=pin, read_verified=True,
                             compilation='COMPILED' if name.endswith('.wasm') else 'NOT_REQUESTED')
                        for name, (size, pin) in c.ASSETS.items()],
                capabilities=dict.fromkeys(['pglite_imported', 'wasm_instantiated', 'database_initialized',
                                            'sql_executed', 'network_requested'], False))


def report():
    return dict(stdout=json.dumps(diagnostic()) + '\n', stderr='', timeout=False, interrupted=False,
                failure=None, returncode=0, cleanup_errors=[],
                termination=dict(confirmed=True, child_reaped=True, group_gone=True, returncode=0,
                                 signal_result='UNCONFIRMED', signal_errno=1,
                                 signal_delivery_confirmed=False))


class ControllerTests(unittest.TestCase):
    def test_source_hash_and_fixed_four_asset_contract(self):
        # Plain source text reads only; no runtime assets loaded/imported.
        source = c.DIAGNOSTIC.read_bytes()
        self.assertEqual(c.sha(source), c.DIAGNOSTIC_PIN)
        self.assertEqual(set(c.ASSETS), {'index.cjs', 'pglite.wasm', 'initdb.wasm', 'pglite.data'})
        text = source.decode()
        for size, pin in c.ASSETS.values():
            self.assertIn(str(size), text)
            self.assertIn(pin, text)

    def test_missing_owner_flag_or_extra_arguments_never_preflights(self):
        for args in ([], ['--execute'], ['--owner-approved-c2-diagnostic', '--url=forbidden'],
                     ['--owner-approved-c2-d']):
            errors = io.StringIO()
            with self.subTest(args=args), patch.object(c, 'verify_inputs') as verify, \
                    patch('sys.stderr', new=errors):
                with self.assertRaises(SystemExit):
                    c.main(args)
                verify.assert_not_called()
            self.assertNotIn('forbidden', errors.getvalue())

    def test_non_macos_or_missing_sandbox_stops_before_staging(self):
        with patch.object(c.sys, 'platform', 'linux'), patch.object(c, 'checked_read') as read:
            with self.assertRaisesRegex(c.Stop, 'MACOS_REQUIRED'):
                c.verify_inputs()
            read.assert_not_called()
        with patch.object(c.sys, 'platform', 'darwin'), patch.object(Path, 'is_file', return_value=False):
            with self.assertRaisesRegex(c.Stop, 'SANDBOX_UNAVAILABLE'):
                c.verify_inputs()

    def test_profile_node_helper_or_diagnostic_mismatch_never_walks_runtime(self):
        targets = [c.PROFILE, c.NODE, *c.HELPERS, c.DIAGNOSTIC]
        for target in targets:
            def read(path, *args):
                if path == target:
                    raise c.Stop('INPUT_HASH_MISMATCH')
                return b'synthetic'
            with self.subTest(target=target), patch.object(c.sys, 'platform', 'darwin'), \
                    patch.object(Path, 'is_file', return_value=True), \
                    patch.object(Path, 'is_dir', return_value=True), \
                    patch.object(Path, 'is_symlink', return_value=False), \
                    patch.object(c, 'checked_read', side_effect=read), \
                    patch.object(c, 'verify_node', side_effect=lambda: read(c.NODE)), \
                    patch.object(c.os, 'walk') as walk:
                with self.assertRaisesRegex(c.Stop, 'INPUT_HASH_MISMATCH'):
                    c.verify_inputs()
                walk.assert_not_called()

    def test_runtime_tree_mismatch_blocks(self):
        with patch.object(c.sys, 'platform', 'darwin'), \
                patch.object(Path, 'is_file', return_value=True), patch.object(Path, 'is_dir', return_value=True), \
                patch.object(Path, 'is_symlink', return_value=False), \
                patch.object(c, 'checked_read', return_value=b'synthetic'), \
                patch.object(c, 'verify_node'), \
                patch.object(c.os, 'walk', return_value=[(str(c.RUNTIME), [], ['package.json'])]):
            with self.assertRaisesRegex(c.Stop, 'RUNTIME_TREE_MISMATCH'):
                c.verify_inputs()

    def test_successful_descriptor_read_and_hash(self):
        info = Mock(st_mode=stat.S_IFREG | 0o400, st_size=3, st_mtime_ns=1, st_ctime_ns=1)
        with patch.object(Path, 'is_symlink', return_value=False), \
                patch.object(c.os, 'open', return_value=42) as opened, \
                patch.object(c.os, 'fstat', return_value=info), \
                patch.object(c.os, 'fdopen', return_value=io.BytesIO(b'abc')), \
                patch.object(c.os, 'close') as close:
            self.assertEqual(c.checked_read(Path('/synthetic'), c.sha(b'abc'), 3), b'abc')
        self.assertTrue(opened.call_args.args[1] & c.os.O_NOFOLLOW)
        close.assert_called_once_with(42)

    def test_special_oversized_changed_or_hash_mismatch_inputs_rejected(self):
        for mode, size, mtime, pin in ((stat.S_IFIFO, 3, 1, None),
                                      (stat.S_IFREG, 70 * 1024 * 1024, 1, None),
                                      (stat.S_IFREG, 3, 2, None),
                                      (stat.S_IFREG, 3, 1, '0' * 64)):
            first = Mock(st_mode=mode, st_size=size, st_mtime_ns=1, st_ctime_ns=1)
            after = Mock(st_size=size, st_mtime_ns=mtime, st_ctime_ns=1)
            with self.subTest(mode=mode, size=size, mtime=mtime), \
                    patch.object(Path, 'is_symlink', return_value=False), \
                    patch.object(c.os, 'open', return_value=42), \
                    patch.object(c.os, 'fstat', side_effect=[first, after]), \
                    patch.object(c.os, 'fdopen', return_value=io.BytesIO(b'abc')), \
                    patch.object(c.os, 'close') as close:
                with self.assertRaises(c.Stop):
                    c.checked_read(Path('/synthetic'), pin)
                close.assert_called_once()

    def test_symlink_rejected_without_opening(self):
        with patch.object(Path, 'is_symlink', return_value=True), patch.object(c.os, 'open') as opened:
            with self.assertRaisesRegex(c.Stop, 'SYMLINK_INPUT'):
                c.checked_read(Path('/synthetic'))
            opened.assert_not_called()

    def test_existing_staging_file_never_overwritten_or_retried(self):
        with patch.object(c.os, 'open', side_effect=FileExistsError) as opened:
            with self.assertRaises(FileExistsError):
                c.write_new(Path('/synthetic'), b'abc')
        opened.assert_called_once()
        flags = opened.call_args.args[1]
        self.assertTrue(flags & c.os.O_EXCL)
        self.assertTrue(flags & c.os.O_NOFOLLOW)
        self.assertFalse(flags & c.os.O_TRUNC)

    def test_staging_location_recorded_before_any_copy_failure(self):
        events = []
        stage = c.SCRATCH / 'phase4-c2-assets-synthetic'
        with patch.object(c.tempfile, 'mkdtemp', return_value=str(stage)), \
                patch.object(c, 'sync_directory'), patch.object(Path, 'mkdir'), \
                patch.object(c, 'write_new', side_effect=OSError('synthetic')):
            with self.assertRaises(OSError):
                c.stage_inputs(b'source', {}, lambda path: events.append(path))
        self.assertEqual(events, [stage])

    def test_failed_staging_intent_publication_prevents_copies(self):
        stage = c.SCRATCH / 'phase4-c2-assets-synthetic'
        with patch.object(c.tempfile, 'mkdtemp', return_value=str(stage)), \
                patch.object(c, 'write_new') as write:
            with self.assertRaises(OSError):
                c.stage_inputs(b'source', {}, Mock(side_effect=OSError('synthetic')))
            write.assert_not_called()

    def test_staging_writer_write_flush_sync_or_close_failure_blocks(self):
        for error in ('write', 'flush', 'fsync', 'close', 'fd-close', 'directory'):
            stream = MagicMock()
            stream.__enter__.return_value = stream
            def exit_stream(*args):
                stream.close()
                return False  # Never suppress the injected writer exception.
            stream.__exit__.side_effect = exit_stream
            stream.write.side_effect = lambda data: len(data)
            if error in ('write', 'flush', 'close'):
                getattr(stream, error).side_effect = OSError('synthetic')
            with self.subTest(error=error), patch.object(c.os, 'open', return_value=42), \
                    patch.object(c.os, 'fdopen', return_value=stream), \
                    patch.object(c.os, 'fsync', side_effect=OSError('synthetic') if error == 'fsync' else None), \
                    patch.object(c.os, 'close', side_effect=OSError('synthetic') if error == 'fd-close' else None) as close, \
                    patch.object(c, 'sync_directory', side_effect=OSError('synthetic') if error == 'directory' else None) as sync:
                with self.assertRaises(OSError): c.write_new(Path('/synthetic'), b'abc')
                close.assert_called_once_with(42)
                if error != 'directory': sync.assert_not_called()

    def test_command_uses_verified_source_buffer_not_staged_code_path(self):
        command = c.command_for(c.SCRATCH / 'phase4-c2-assets-synthetic', b'SYNTHETIC_SOURCE')
        self.assertEqual(command[:5], ['/usr/bin/sandbox-exec', '-f', str(c.PROFILE), str(c.NODE), '-e'])
        self.assertEqual(command[5], 'SYNTHETIC_SOURCE\nvoid module.exports.cli(process.argv.slice(1));\n')
        self.assertEqual(command[6:-1], ['--', '--owner-approved-c2-assets',
                                         str(c.SCRATCH / 'phase4-c2-assets-synthetic')])
        self.assertEqual(command[-1], c.DIAGNOSTIC_PIN)
        self.assertNotIn(str(c.DIAGNOSTIC), command)

    def perform(self, child_report=None, publication_error=False, stage_error=False):
        stage = c.SCRATCH / 'phase4-c2-assets-synthetic'
        events = []
        def completed(*args, **kwargs):
            events.append('child-cleanup-completed')
            self.assertEqual(kwargs['timeout'], 180)
            self.assertEqual(set(args[1]), {'LANG', 'LC_ALL', 'TZ', 'TMPDIR'})
            return child_report if child_report is not None else report()
        def save(path, value):
            events.append('publish:' + path.name)
            if publication_error and path.name == 'process.json':
                raise OSError('synthetic publication error')
        with patch.object(c, 'stage_inputs', return_value=stage), \
                patch.object(c, 'verify_stage', side_effect=[None, c.Stop('STAGING_ASSET_ENTRIES')]
                             if stage_error else None), \
                patch.object(c, 'checked_read', return_value=b'synthetic'), \
                patch.object(c, 'verify_node'), \
                patch.object(c, 'run_probe', side_effect=completed) as run, \
                patch.object(c, 'save_exclusive', side_effect=save):
            try:
                c.perform(Path('/synthetic/evidence'), c.ManualCancellation(), b'source', {})
                error = None
            except BaseException as exc:
                error = exc
        self.assertEqual(run.call_count, 1)
        return events, error

    def test_fake_process_happy_path_and_publication_after_cleanup(self):
        events, error = self.perform()
        self.assertIsNone(error)
        self.assertEqual(events, ['child-cleanup-completed', 'publish:process.json', 'publish:diagnostic.json'])

    def test_timeout_failure_uncertain_group_or_interruption_never_accepted(self):
        for field in ('timeout', 'interrupted', 'group', 'cleanup'):
            r = report()
            if field == 'group':
                r['termination']['confirmed'] = False
                r['termination']['group_gone'] = False
            elif field == 'cleanup':
                r['failure'] = 'CLEANUP_UNKNOWN'
            else:
                r[field] = True
            with self.subTest(field=field):
                events, error = self.perform(child_report=r)
                self.assertIsInstance(error, c.Stop)
                self.assertNotIn('publish:diagnostic.json', events)

    def test_publication_error_and_post_run_staging_tamper_stop_without_retry(self):
        for options in ({'publication_error': True}, {'stage_error': True}):
            events, error = self.perform(**options)
            self.assertIsNotNone(error)
            self.assertNotIn('publish:diagnostic.json', events)

    def test_malformed_incomplete_or_capability_results_rejected(self):
        for mode in ('malformed', 'missing', 'capability', 'compile', 'extra', 'not-boolean'):
            r, value = report(), diagnostic()
            if mode == 'missing': value['assets'].pop()
            if mode == 'capability': value['capabilities']['database_initialized'] = True
            if mode == 'compile': value['assets'][1]['compilation'] = 'PENDING'
            if mode == 'extra': value['unexpected'] = True
            if mode == 'not-boolean': value['assets'][0]['read_verified'] = 1
            r['stdout'] = 'invalid' if mode == 'malformed' else json.dumps(value)
            with self.subTest(mode=mode), self.assertRaises((c.Stop, ValueError)):
                c.parse_diagnostic(r)

    def test_overflow_or_duplicate_json_is_rejected(self):
        r = report(); r['failure'] = 'RuntimeError'
        with self.assertRaises(c.Stop): c.parse_diagnostic(r)
        r = report(); r['stdout'] = '{"status":"a","status":"b"}'
        with self.assertRaisesRegex(c.Stop, 'DUPLICATE_JSON_KEY'): c.parse_diagnostic(r)

    def test_preflight_failure_cannot_launch_or_create_staging(self):
        with patch.object(c, 'verify_inputs', side_effect=c.Stop('INPUT_HASH_MISMATCH')), \
                patch.object(c.tempfile, 'mkdtemp') as mkdir, patch.object(c, 'run_probe') as run:
            with self.assertRaises(c.Stop): c.main(['--owner-approved-c2-diagnostic'])
        mkdir.assert_not_called(); run.assert_not_called()

    def mocked_main(self, process_error=None):
        # Real main/perform/staging/finalization logic; all external boundaries fake.
        evidence = Path('/synthetic/evidence')
        stage = c.SCRATCH / 'phase4-c2-assets-synthetic'
        source = b'SYNTHETIC_SOURCE'
        assets = {name: ('synthetic:' + name).encode() for name in c.ASSETS}
        files, events = {}, []
        output, errors = io.StringIO(), io.StringIO()

        def write(path, data, *args):
            self.assertNotIn(path, files)
            files[path] = data
            events.append(('write', path.name))

        def save(path, value):
            write(path, c.encoded(value))

        def read(path, *args):
            if path in files:
                return files[path]
            self.assertIn(path, [c.PROFILE, c.NODE, Path(c.__file__).resolve()])
            return b'SYNTHETIC_PINNED_INPUT'

        def run(command, environment, cwd, cancellation, *, timeout):
            self.assertEqual(command, c.command_for(stage, source))
            self.assertEqual(environment, dict(LANG='C', LC_ALL='C', TZ='UTC', TMPDIR=str(stage / 'tmp')))
            self.assertEqual(cwd, stage)
            self.assertEqual(timeout, 180)
            self.assertFalse(cancellation.requested)
            self.assertEqual(files[stage / 'diagnostic.cjs'], source)
            for name, data in assets.items():
                self.assertEqual(files[stage / 'assets' / name], data)
            self.assertIn(evidence / 'inputs.json', files)
            self.assertIn(evidence / 'staging.json', files)
            events.append(('process-cleanup-complete',))
            if process_error is not None:
                raise process_error
            return report()

        with ExitStack() as stack:
            for target, name, kwargs in [
                (c, 'verify_inputs', dict(return_value=(source, assets))),
                (c.tempfile, 'mkdtemp', dict(side_effect=[str(evidence), str(stage)])),
                (Path, 'mkdir', {}), (c, 'sync_directory', {}),
                (c, 'write_new', dict(side_effect=write)),
                (c, 'save_exclusive', dict(side_effect=save)),
                (c, 'checked_read', dict(side_effect=read)),
                (c, 'verify_node', {}),
                (c, 'verify_stage', {}), (c, 'run_probe', dict(side_effect=run)),
                (c.signal, 'signal', {}),
                (c.os, 'open', dict(side_effect=AssertionError('REAL_FILESYSTEM_FORBIDDEN'))),
            ]:
                stack.enter_context(patch.object(target, name, **kwargs))
            stack.enter_context(patch('subprocess.Popen', side_effect=AssertionError('REAL_PROCESS_FORBIDDEN')))
            stack.enter_context(patch('sys.stdout', output))
            stack.enter_context(patch('sys.stderr', errors))
            code = c.main(['--owner-approved-c2-diagnostic'])
        return code, evidence, files, events, output.getvalue(), errors.getvalue()

    def test_complete_successful_mocked_main_workflow(self):
        code, evidence, files, events, output, errors = self.mocked_main()
        self.assertEqual(code, 0)
        self.assertEqual(errors, '')
        self.assertEqual({p.name for p in files if p.parent == evidence}, c.REQUIRED | {'completion.json'})
        summary = json.loads(files[evidence / 'summary.json'])
        completion = json.loads(files[evidence / 'completion.json'])
        receipt = json.loads(next(line for line in output.splitlines() if line.startswith('{')))
        hashes = {p.name: c.sha(data) for p, data in files.items() if p.parent == evidence}
        self.assertTrue(c.acceptance_ok(summary, completion, receipt, code, hashes, interruption_observed=False))
        self.assertEqual(events.count(('process-cleanup-complete',)), 1)
        self.assertLess(events.index(('process-cleanup-complete',)), events.index(('write', 'process.json')))
        self.assertEqual([name for kind, *tail in events if kind == 'write' for name in tail][-3:],
                         ['diagnostic.json', 'summary.json', 'completion.json'])

    def test_fixed_failure_codes_preserve_cause_without_exception_text(self):
        for exc, expected in [(c.Stop('INPUT_HASH_MISMATCH'), 'INPUT_HASH_MISMATCH'),
                              (c.Stop('secret synthetic URL'), 'UNEXPECTED_FAILURE'),
                              (OSError('secret synthetic URL'), 'FILESYSTEM_OR_IO_FAILURE'),
                              (ValueError('secret synthetic URL'), 'INVALID_EVIDENCE_OR_RESULT'),
                              (KeyboardInterrupt(), 'INTERRUPTED')]:
            with self.subTest(expected=expected):
                self.assertEqual(c.failure_code(exc), expected)
                code, evidence, files, events, output, errors = self.mocked_main(exc)
                self.assertEqual(code, 1)
                self.assertEqual(json.loads(files[evidence / 'summary.json'])['reason'], expected)
                self.assertNotIn(evidence / 'completion.json', files)
                self.assertNotIn('C2_FINALIZATION_RECEIPT', output)
                self.assertNotIn('secret synthetic URL', output + errors + str(files))
                self.assertEqual(json.loads(errors)['reason'], 'DIAGNOSTIC_NOT_PASSED')
                self.assertEqual(events.count(('process-cleanup-complete',)), 1)

    def test_helper_originated_cancellation_reports_interrupted_and_still_blocks(self):
        cancellation = c.ManualCancellation()
        cancellation.requested = True
        with self.assertRaises(c.HelperStop) as raised:
            c.check_cancelled(cancellation)
        self.assertEqual(c.failure_code(raised.exception), 'INTERRUPTED')
        self.assertEqual(c.failure_code(c.HelperStop('other synthetic message')), 'UNEXPECTED_FAILURE')
        self.assertEqual(c.failure_code(RuntimeError('INTERRUPTED')), 'UNEXPECTED_FAILURE')
        code, evidence, files, _, output, _ = self.mocked_main(raised.exception)
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(files[evidence / 'summary.json'])['reason'], 'INTERRUPTED')
        self.assertNotIn(evidence / 'completion.json', files)
        self.assertNotIn('C2_FINALIZATION_RECEIPT', output)

    def finalization(self, *, interrupt=None, fail=None, missing=None):
        evidence = Path('/synthetic/evidence')
        files = {evidence / name: b'SYNTHETIC' for name in c.REQUIRED if name != 'summary.json'}
        if missing: del files[evidence / missing]
        cancellation, output = c.ManualCancellation(), []
        summary = dict(protocol=1, state='PROVISIONAL', result='PASSED', builder_enabled=False, database_execution=False)
        def save(path, value):
            self.assertNotIn(path, files)
            files[path] = c.encoded(value)
            if interrupt == path.name: cancellation.handle_sigint(signal.SIGINT, None)
            if fail == path.name: raise OSError('synthetic')
        def emit(value, **kwargs):
            output.append(json.loads(value))
            if interrupt == 'receipt' and output[-1].get('event') == 'C2_FINALIZATION_RECEIPT':
                cancellation.handle_sigint(signal.SIGINT, None)
        with patch.object(c, 'save_exclusive', side_effect=save), \
                patch.object(c, 'checked_read', side_effect=lambda path: files[path]):
            code = c.finalize(evidence, summary, cancellation, emit=emit)
        completion = json.loads(files.get(evidence / 'completion.json', b'{}'))
        receipt = next((v for v in output if v.get('event') == 'C2_FINALIZATION_RECEIPT'), {})
        hashes = {path.name: c.sha(value) for path, value in files.items()}
        accepted = c.acceptance_ok(summary, completion, receipt, code, hashes,
                                   interruption_observed=cancellation.requested)
        return code, accepted, summary, completion, receipt, hashes

    def test_finalization_success_requires_all_evidence_receipt_status_and_assessment(self):
        code, accepted, summary, completion, receipt, hashes = self.finalization()
        self.assertEqual(code, 0); self.assertTrue(accepted)
        self.assertFalse(c.acceptance_ok(summary, completion, receipt, 0, hashes))
        self.assertFalse(c.acceptance_ok(summary, completion, receipt, 130, hashes, interruption_observed=False))
        self.assertFalse(c.acceptance_ok(summary, completion, {}, 0, hashes, interruption_observed=False))
        for name in hashes:
            self.assertFalse(c.acceptance_ok(summary, completion, receipt, 0,
                             {k: v for k, v in hashes.items() if k != name}, interruption_observed=False))

    def test_finalization_interruption_or_partial_publication_is_never_pass(self):
        for options in ({'interrupt': 'summary.json'}, {'interrupt': 'completion.json'},
                        {'interrupt': 'receipt'}, {'fail': 'summary.json'},
                        {'fail': 'completion.json'}, {'missing': 'process.json'}):
            with self.subTest(options=options):
                code, accepted, *_ = self.finalization(**options)
                self.assertEqual(code, 1); self.assertFalse(accepted)


class NodeVerifierTests(unittest.TestCase):
    def simulate(self, *, before_changes=None, after_changes=None, read_mode=None,
                 bad_hash=False, close_failure=False, stat_failure=False):
        values = dict(st_mode=stat.S_IFREG | 0o755, st_size=248201648, st_uid=0,
                      st_dev=1, st_ino=2, st_mtime_ns=3, st_ctime_ns=4)
        before = Mock(**(values | (before_changes or {})))
        after = Mock(**(values | (after_changes or {})))
        remaining, hashed, requests = 248201648, 0, []
        class Digest:
            def update(self, chunk):
                nonlocal hashed
                hashed += len(chunk)
            def hexdigest(self):
                return '0' * 64 if bad_hash else c.NODE_PIN
        def read(fd, count):
            nonlocal remaining
            self.assertEqual(fd, 42)
            self.assertLessEqual(count, 1024 * 1024)
            requests.append(count)
            if read_mode == 'io': raise OSError('synthetic read failure')
            if read_mode == 'short': return b''
            if remaining == 0:
                return b'x' if read_mode == 'grow' else b''
            n = min(count, remaining)
            if read_mode == 'partial': n = min(n, 512 * 1024)
            remaining -= n
            return b'x' * n
        with patch.object(Path, 'is_symlink', return_value=False), \
                patch.object(c.os, 'open', return_value=42) as opened, \
                patch.object(c.os, 'fstat', side_effect=OSError('synthetic stat failure')
                             if stat_failure else [before, after]), \
                patch.object(c.os, 'read', side_effect=read), \
                patch.object(c.os, 'close', side_effect=OSError('synthetic close failure')
                             if close_failure else None) as closed, \
                patch.object(c.hashlib, 'sha256', return_value=Digest()):
            try:
                result = c.verify_node()
                error = None
            except BaseException as exc:
                result, error = None, exc
        opened.assert_called_once_with(c.NODE, c.os.O_RDONLY | c.os.O_NOFOLLOW | c.os.O_NONBLOCK)
        closed.assert_called_once_with(42)
        return result, error, hashed, requests

    def test_large_pinned_node_streams_bounded_chunks_including_partial_reads(self):
        self.assertEqual(c.NODE_SIZE, 248201648)
        self.assertEqual(c.NODE, Path('/usr/local/bin/node'))
        for mode in (None, 'partial'):
            _, error, hashed, requests = self.simulate(read_mode=mode)
            self.assertIsNone(error)
            self.assertEqual(hashed, 248201648)
            self.assertGreater(len(requests), 200)
            self.assertEqual(requests[-1], 1)

    def test_node_size_type_owner_and_permissions_reject_before_reading(self):
        for changes, code in [({'st_size': 248201647}, 'INPUT_SIZE_MISMATCH'),
                              ({'st_size': 248201649}, 'INPUT_SIZE_MISMATCH'),
                              ({'st_mode': stat.S_IFIFO | 0o600}, 'INPUT_TYPE_OR_SIZE'),
                              ({'st_mode': stat.S_IFDIR | 0o755}, 'INPUT_TYPE_OR_SIZE'),
                              ({'st_uid': 501}, 'NODE_OWNER_OR_PERMISSIONS'),
                              ({'st_mode': stat.S_IFREG | 0o775}, 'NODE_OWNER_OR_PERMISSIONS'),
                              ({'st_mode': stat.S_IFREG | 0o757}, 'NODE_OWNER_OR_PERMISSIONS')]:
            with self.subTest(changes=changes):
                _, error, hashed, requests = self.simulate(before_changes=changes)
                self.assertIsInstance(error, c.Stop)
                self.assertEqual(str(error), code)
                self.assertEqual(hashed, 0)
                self.assertEqual(requests, [])

    def test_node_hash_short_growth_io_stat_and_close_fail_closed(self):
        for options, expected in [({'bad_hash': True}, c.Stop),
                                  ({'read_mode': 'short'}, c.Stop),
                                  ({'read_mode': 'grow'}, c.Stop),
                                  ({'read_mode': 'io'}, OSError),
                                  ({'stat_failure': True}, OSError),
                                  ({'close_failure': True}, OSError)]:
            with self.subTest(options=options):
                _, error, _, _ = self.simulate(**options)
                self.assertIsInstance(error, expected)

    def test_node_metadata_changes_fail_closed(self):
        for field, value in [('st_dev', 9), ('st_ino', 9), ('st_mode', stat.S_IFREG | 0o775),
                             ('st_uid', 501), ('st_size', 248201649),
                             ('st_mtime_ns', 9), ('st_ctime_ns', 9)]:
            with self.subTest(field=field):
                _, error, _, _ = self.simulate(after_changes={field: value})
                self.assertIsInstance(error, c.Stop)
                self.assertEqual(str(error), 'INPUT_CHANGED_DURING_READ')

    def test_node_leaf_or_ancestor_symlink_never_opened(self):
        for bad in [c.NODE, *c.NODE.parents]:
            with self.subTest(path=bad), \
                    patch.object(Path, 'is_symlink', autospec=True, side_effect=lambda path: path == bad), \
                    patch.object(c.os, 'open') as opened:
                with self.assertRaisesRegex(c.Stop, 'SYMLINK_INPUT'):
                    c.verify_node()
                opened.assert_not_called()

    def test_node_open_failure_is_not_retried(self):
        with patch.object(Path, 'is_symlink', return_value=False), \
                patch.object(c.os, 'open', side_effect=OSError('synthetic')) as opened, \
                patch.object(c.os, 'close') as closed:
            with self.assertRaises(OSError): c.verify_node()
        opened.assert_called_once()
        closed.assert_not_called()

    def test_generic_over_64_mib_still_rejected_before_read(self):
        info = Mock(st_mode=stat.S_IFREG | 0o644, st_size=67108865)
        with patch.object(Path, 'is_symlink', return_value=False), \
                patch.object(c.os, 'open', return_value=42), \
                patch.object(c.os, 'fstat', return_value=info), \
                patch.object(c.os, 'fdopen') as stream, patch.object(c.os, 'close') as close:
            with self.assertRaisesRegex(c.Stop, 'INPUT_TYPE_OR_SIZE'):
                c.checked_read(Path('/synthetic/oversized'))
        stream.assert_not_called()
        close.assert_called_once_with(42)

    def test_all_three_node_call_sites_use_dedicated_verifier(self):
        tree = ast.parse(Path(c.__file__).read_text())
        counts = {}
        for fn in tree.body:
            if not isinstance(fn, ast.FunctionDef): continue
            calls = [n for n in ast.walk(fn) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)]
            counts[fn.name] = sum(n.func.id == 'verify_node' for n in calls)
            for call in calls:
                if call.func.id == 'checked_read':
                    self.assertFalse(call.args and isinstance(call.args[0], ast.Name) and call.args[0].id == 'NODE')
        self.assertEqual(sum(counts.values()), 3)
        self.assertEqual(counts['verify_inputs'], 1)
        self.assertEqual(counts['perform'], 2)

    def test_initial_node_failure_precedes_evidence_staging_and_launch(self):
        with patch.object(c.sys, 'platform', 'darwin'), \
                patch.object(Path, 'is_file', return_value=True), \
                patch.object(Path, 'is_dir', return_value=True), \
                patch.object(Path, 'is_symlink', return_value=False), \
                patch.object(c, 'checked_read', return_value=b'synthetic'), \
                patch.object(c, 'verify_node', side_effect=c.Stop('INPUT_SIZE_MISMATCH')) as verify, \
                patch.object(c.tempfile, 'mkdtemp') as mkdir, \
                patch.object(c, 'run_probe') as run, patch.object(c.os, 'walk') as walk:
            with self.assertRaisesRegex(c.Stop, 'INPUT_SIZE_MISMATCH'):
                c.main(['--owner-approved-c2-diagnostic'])
        verify.assert_called_once_with()
        mkdir.assert_not_called()
        run.assert_not_called()
        walk.assert_not_called()


if __name__ == '__main__':
    unittest.main()
