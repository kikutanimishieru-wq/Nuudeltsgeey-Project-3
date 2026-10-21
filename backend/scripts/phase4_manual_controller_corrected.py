"""Phase A copy of the reviewed manual controller. Import has no side effects.

Not a validation launcher. Future use requires separate owner approval. Only use
with trusted synthetic probes that do not escape their dedicated process group.
"""
import errno
import os
import selectors
import signal
import subprocess
import time


class Cancellation:
    def __init__(self):
        self.requested = False

    def handle_sigint(self, signum, frame):
        # Do not raise during Popen: the returned child must first be tracked.
        self.requested = True


def terminate_tracked(child, pgid, *, killpg=os.killpg,
                      clock=time.monotonic, pause=time.sleep, grace=2):
    """Signal once BEFORE reaping; after reaping, perform only signal-zero checks.

    Caller must own an unreaped Popen child created with start_new_session=True,
    must not have called poll/wait/communicate, and must have SIGCHLD=SIG_DFL.
    This reserves the leader PID until the only nonzero group signal is sent.
    No re-signaling is permitted once the PID reservation has been released.
    """
    result = dict(pgid=pgid, signal='SIGKILL', signal_result='UNCONFIRMED',
                  signal_errno=None, signal_delivery_confirmed=False,
                  child_reaped=False, group_gone=False, returncode=None,
                  confirmed=False, confirmation_basis='UNCONFIRMED')
    if pgid <= 1 or pgid != child.pid or child.returncode is not None:
        result['error'] = 'UNANCHORED_GROUP_NO_SIGNAL'
        return result
    try:
        killpg(pgid, signal.SIGKILL)
        result['signal_result'] = 'SENT'
        result['signal_delivery_confirmed'] = True
    except OSError as exc:
        result['signal_errno'] = exc.errno
        if exc.errno == errno.ESRCH:
            result['signal_result'] = 'ALREADY_ABSENT'
    except BaseException as exc:
        result['unexpected_signal_error'] = type(exc).__name__
    try:
        result['returncode'] = child.wait(timeout=grace)
        result['child_reaped'] = True
    except BaseException as exc:
        result['error'] = 'CHILD_NOT_REAPED'
        result['wait_error'] = type(exc).__name__
        return result
    deadline = clock() + grace
    while True:
        try:
            killpg(pgid, 0)
        except OSError as exc:
            if exc.errno == errno.ESRCH:
                result['group_gone'] = True
                break
            result['group_check_errno'] = exc.errno
            result['error'] = 'GROUP_ABSENCE_UNVERIFIED'
            break
        except BaseException as exc:
            result['error'] = 'GROUP_ABSENCE_UNVERIFIED'
            result['group_check_error'] = type(exc).__name__
            break
        if clock() >= deadline:
            result['error'] = 'GROUP_PRESENT_OR_REUSED'
            break
        pause(0.05)
    result['confirmed'] = (result['child_reaped'] and result['group_gone'] and
                           'unexpected_signal_error' not in result)
    if result['confirmed']:
        result['confirmation_basis'] = 'CHILD_REAPED_AND_GROUP_ABSENT'
    return result


def completion_ok(report, *, expected_stdout, timeout_expected=False):
    """Termination evidence never substitutes for expected probe behavior."""
    t = report['termination']
    if (report.get('interrupted') or report.get('failure') or
            not t['confirmed'] or not t['child_reaped'] or not t['group_gone'] or
            report['stdout'] != expected_stdout or report['stderr']):
        return False
    if timeout_expected:
        return (report['timeout'] is True and report['returncode'] == -9 and
                t['returncode'] == -9 and t['signal_result'] == 'SENT' and
                t['signal_delivery_confirmed'] is True)
    return (report['timeout'] is False and report['returncode'] == 0 and
            t['returncode'] == 0)


def run_probe(command, environment, cwd, cancellation, *, timeout=4):
    """Dormant transport; this module deliberately supplies no launcher/main.

    The manual operator must install cancellation.handle_sigint as SIGINT handler
    BEFORE calling this function. Evidence publication belongs to the reviewed
    manual procedure and must use exclusive creation, including on failure.
    """
    if signal.getsignal(signal.SIGCHLD) != signal.SIG_DFL:
        raise RuntimeError('SIGCHLD must retain the unreaped child identity')
    if signal.getsignal(signal.SIGINT) != cancellation.handle_sigint:
        raise RuntimeError('Cancellation handler must be installed before Popen')
    if cancellation.requested:
        raise RuntimeError('Cancelled before launch')
    report = dict(timeout=False, interrupted=False, failure=None)
    child = None
    selector = None
    streams = {}
    report['cleanup_errors'] = []
    try:
        child = subprocess.Popen(command, cwd=cwd, env=environment,
                                 stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, start_new_session=True)
        # Everything after a successful Popen is inside this cleanup boundary.
        report.update(pid=child.pid, pgid=child.pid, command=list(command))
        streams = {child.stdout: bytearray(), child.stderr: bytearray()}
        selector = selectors.DefaultSelector()
        for stream in streams:
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, selectors.EVENT_READ)
        deadline = time.monotonic() + timeout
        while selector.get_map():
            if cancellation.requested:
                report['interrupted'] = True
                break
            if time.monotonic() >= deadline:
                report['timeout'] = True
                break
            for key, _ in selector.select(0.05):
                data = os.read(key.fileobj.fileno(), 8192)
                if not data:
                    selector.unregister(key.fileobj)
                    continue
                streams[key.fileobj].extend(data)
                if len(streams[key.fileobj]) > 65536:
                    raise RuntimeError('Output limit exceeded')
    except BaseException as exc:
        report['failure'] = type(exc).__name__
    finally:
        # Independent cleanup steps: one exception cannot skip the next step.
        if child is not None:
            try:
                report['termination'] = terminate_tracked(child, child.pid)
            except BaseException as exc:
                report['cleanup_errors'].append('termination:' + type(exc).__name__)
        if selector is not None:
            try:
                selector.close()
            except BaseException as exc:
                report['cleanup_errors'].append('selector:' + type(exc).__name__)
        if child is not None:
            for name, stream in [('stdout', child.stdout), ('stderr', child.stderr)]:
                try:
                    report[name] = streams.get(stream, b'').decode('utf8', 'replace')
                except BaseException as exc:
                    report['cleanup_errors'].append(name + '_decode:' + type(exc).__name__)
                try:
                    stream.close()
                except BaseException as exc:
                    report['cleanup_errors'].append(name + ':' + type(exc).__name__)
        report.setdefault('termination', dict(confirmed=False, child_reaped=False,
                          group_gone=False, returncode=None, error='UNKNOWN'))
        report['returncode'] = report['termination']['returncode']
        report['interrupted'] |= cancellation.requested
        if report['cleanup_errors']:
            report['failure'] = 'CLEANUP_UNKNOWN'
    return report
