"""Transport orchestration, no automatic execution path. Mocks only until controls approved."""
import hashlib
import json
import os
import re
from pathlib import Path
import stat
import time
import copy

MAX_EVIDENCE = 16 * 1024 * 1024
REQUIRED_ROLES = {"supervisor", "watchdog", "upstream", "cases", "node", "python",
                  "next_tree", "frontend_tree", "network_policy", "storage_policy"}
REQUIRED_APPROVALS = {"implementation_review", "one_transport_attempt", "network_enforcement",
                      "storage_enforcement", "owned_process_controls", "watchdog_review"}


class Blocked(Exception):
    pass


def secure_open(path, directory=False):
    """Walk every component using directory descriptors and O_NOFOLLOW."""
    path = Path(path)
    if not path.is_absolute() or ".." in path.parts or not hasattr(os, "O_NOFOLLOW"):
        raise Blocked("SAFE_ABSOLUTE_PATH_REQUIRED")
    def check(fd, is_directory):
        metadata = os.fstat(fd)
        required = stat.S_ISDIR if is_directory else stat.S_ISREG
        if (not required(metadata.st_mode) or metadata.st_mode & 0o022
                or metadata.st_uid not in (0, os.getuid())):
            raise Blocked("UNSAFE_PATH")
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        check(fd, True)
        parts = path.parts[1:]
        for index, component in enumerate(parts):
            is_directory = index < len(parts) - 1 or directory
            flags = os.O_RDONLY | os.O_NOFOLLOW | (os.O_DIRECTORY if is_directory else 0)
            following = os.open(component, flags, dir_fd=fd)
            try:
                check(following, is_directory)
            except BaseException:
                os.close(following)
                raise
            os.close(fd)
            fd = following
        check(fd, directory)
        return fd
    except BaseException:
        os.close(fd)
        raise


def digest_file(path, ceiling):
    fd = secure_open(path)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size > ceiling:
            raise Blocked("INPUT_SIZE_OR_TYPE")
        total = 0
        digest = hashlib.sha256()
        while True:
            chunk = os.read(fd, 1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > ceiling:
                raise Blocked("INPUT_GREW")
            digest.update(chunk)
        after = os.fstat(fd)
        stable = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_uid, s.st_mode)
        second = secure_open(path)
        try:
            if stable(before) != stable(after) or total != before.st_size or stable(os.fstat(second)) != stable(after):
                raise Blocked("INPUT_CHANGED")
        finally:
            os.close(second)
        return digest.hexdigest(), total
    finally:
        os.close(fd)


def preflight(manifest, controls, verify_input):
    """controls is a reviewed independently validating adapter, NOT JSON booleans.
    No such operational adapter is supplied. Never import one from a manifest.
    """
    if manifest.get("version") != 1 or set(manifest.get("inputs", {})) != REQUIRED_ROLES:
        raise Blocked("INCOMPLETE_INPUT_PINS")
    if set(manifest.get("approvals", {})) != REQUIRED_APPROVALS:
        raise Blocked("MISSING_OWNER_APPROVAL")
    if any(not isinstance(x, str) or not x for x in manifest["approvals"].values()):
        raise Blocked("INVALID_APPROVAL_REFERENCE")
    if manifest.get("origins") != ["http://localhost:3002", "http://127.0.0.1:3001"]:
        raise Blocked("TARGET_MISMATCH")
    for role, entry in manifest["inputs"].items():
        if (not isinstance(entry, dict) or not isinstance(entry.get("sha256"), str)
                or not re.fullmatch(r"[a-f0-9]{64}", entry["sha256"])):
            raise Blocked("INVALID_INPUT_PIN")
        if verify_input(role, entry) is not True:
            raise Blocked("INPUT_INTEGRITY_FAILED")
    for check in ("owner_approvals", "isolated_workspace", "credential_free_environment",
                  "no_backend_inputs", "ports_unoccupied", "network_enforced", "storage_quota_enforced",
                  "independent_watchdog", "process_ownership_controls", "no_competing_writers"):
        # Adapter verifies actual enforcement, evidence and review bindings, not
        # simply the presence of a user-supplied 'validated': true field.
        if controls.verify(check, manifest) is not True:
            raise Blocked("CONTROL_UNVERIFIED_" + check.upper())
    return "PREFLIGHT_PASSED"


class Evidence:
    """Exclusive private workspace. Does not stage artifacts; never cleans up.
    Directory-fd paths reject symlink replacement. Quota is a separate control.
    """
    def __init__(self, parent, name):
        if not name or not name.isascii() or not all(c.isalnum() or c in "-_" for c in name):
            raise Blocked("INVALID_RUN_NAME")
        self.parent_fd = secure_open(parent, directory=True)
        try:
            os.mkdir(name, 0o700, dir_fd=self.parent_fd)
            self.fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=self.parent_fd)
        finally:
            os.close(self.parent_fd)
        self.total = 0
        self.files = []

    def publish(self, name, record):
        if not name.endswith(".json") or "/" in name or "\\" in name or name.startswith("."):
            raise Blocked("INVALID_EVIDENCE_NAME")
        data = (json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n").encode()
        if len(data) > 1024 * 1024 or self.total + len(data) > MAX_EVIDENCE:
            raise Blocked("EVIDENCE_LIMIT")
        self.total += len(data)  # Count attempted writes too; do not reclaim on failure.
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=self.fd)
        try:
            offset = 0
            while offset < len(data):
                written = os.write(fd, data[offset:])
                if written <= 0:
                    raise Blocked("EVIDENCE_SHORT_WRITE")
                offset += written
            os.fsync(fd)
        finally:
            os.close(fd)
        os.fsync(self.fd)
        self.files.append({"name": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})

    def close(self):
        os.close(self.fd)


def minimal_environment(home, temporary):
    # Supplied to children instead of merging os.environ. No secrets/proxies/NODE_OPTIONS.
    return {"HOME": home, "TMPDIR": temporary, "PATH": "/usr/bin:/bin", "LANG": "C",
            "TZ": "UTC", "NODE_ENV": "development", "NEXT_TELEMETRY_DISABLED": "1",
            "FRONTEND_CANONICAL_ORIGIN": "http://localhost:3002",
            "BACKEND_INTERNAL_ORIGIN": "http://127.0.0.1:3001"}


# Candidate inventory pin; changing it requires independent source review.
CASE_DIGEST = "5be64fe6a9ce1c81c32c1b2dde0fd9ff57d4f74e018b2fabb4db0f307370eb26"
CASE_FILE_DIGEST = "90d567394889cecc4ae6b08377c751be3f856257520bb2caa35e0b4a968aaef1"
ORIGINAL_31_FILE_DIGEST = "6ee8ba6465c262fa4f9e66f61b05dd92593e6952c371fc621e2e1de506eb09a6"

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()

def case_digest(document):
    return hashlib.sha256(canonical(document)).hexdigest()

class AuthorizationGate:
    """In-memory capability issuer. No operational verifier is supplied.
    Injected verifiers are trusted code, never manifest-specified plugins.
    This is not a security boundary against hostile Python code in this process.
    """
    def __init__(self, controls=None, verify_input=None, clock=time.monotonic):
        self.controls, self.verify_input, self.clock = controls, verify_input, clock
        self.issued = {}

    def validate(self, manifest, document):
        try:
            return self._validate(manifest, document)
        except (TypeError, ValueError, KeyError, AttributeError):
            raise Blocked("MALFORMED_AUTHORIZATION") from None

    def _validate(self, manifest, document):
        if self.controls is None or self.verify_input is None:
            raise Blocked("OWNER_VERIFIER_NOT_IMPLEMENTED")
        validate_cases(document)
        if case_digest(document) != CASE_DIGEST:
            raise Blocked("UNREVIEWED_CASE_INVENTORY")
        if (set(manifest) != {"version", "inputs", "approvals", "origins", "run_id", "case_digest", "deadlines"}
                or not isinstance(manifest["run_id"], str)
                or not re.fullmatch(r"[a-z0-9-]{1,64}", manifest["run_id"])
                or manifest["case_digest"] != CASE_DIGEST
                or manifest.get("inputs", {}).get("cases", {}).get("sha256") != CASE_FILE_DIGEST
                or manifest["deadlines"] != {"total_seconds": 180, "startup_seconds": 30, "cleanup_seconds": 9}
                or any(type(x) is not int for x in manifest["deadlines"].values())):
            raise Blocked("INVALID_AUTHORIZATION_BINDING")
        snapshot = copy.deepcopy(manifest)
        preflight(snapshot, self.controls, self.verify_input)
        token = object()
        self.issued[token] = (canonical(snapshot), canonical(document), self.clock() + 30)
        return token

    def consume(self, token, manifest, document):
        try:
            binding = self.issued.pop(token)
        except (KeyError, TypeError):
            raise Blocked("AUTHORIZATION_REQUIRED") from None
        if (self.clock() >= binding[2] or canonical(manifest) != binding[0]
                or canonical(document) != binding[1]):
            raise Blocked("AUTHORIZATION_CHANGED_OR_EXPIRED")
        return json.loads(binding[1])["cases"]

class Supervisor:
    def __init__(self, bridge, evidence, gate=None):
        self.bridge, self.evidence = bridge, evidence
        self.gate = gate or AuthorizationGate()
        self.used = False
        self.stop_attempted = True

    def stop_once(self):
        if self.stop_attempted:
            raise Blocked("NO_CLEANUP_RETRY")
        self.stop_attempted = True
        return self.bridge.stop_and_verify()

    def run(self, document, manifest=None, authorization=None):
        if self.used:
            raise Blocked("NO_RETRY")
        self.used = True
        try:
            cases = self.gate.consume(authorization, manifest, document)
        except (TypeError, ValueError, KeyError, AttributeError):
            raise Blocked("MALFORMED_AUTHORIZATION") from None
        phase = None
        try:
            for case in cases:
                if case["phase"] != phase:
                    if phase is not None and self.stop_once() != "CLEAN":
                        raise Blocked("CLEANUP_UNKNOWN")
                    phase = case["phase"]
                    self.stop_attempted = False  # Cover partial launch failures too.
                    self.bridge.start_phase(phase)
                self.bridge.arm_case(case["id"])
                result = self.bridge.single_request(copy.deepcopy(case))
                if not accepted(case, result):
                    raise Blocked("UNEXPECTED_CASE_RESULT")
                self.evidence.publish(case["id"] + ".json", {"case": case["id"], "status": "PROVISIONAL_PASS",
                    "upstream_requests": result["upstream_requests"], "response": result["response"]})
            if self.stop_once() != "CLEAN":
                raise Blocked("CLEANUP_UNKNOWN")
            self.evidence.publish("summary.json", {"status": "PROVISIONAL", "cases": len(cases)})
            self.evidence.publish("completion.json", {"status": "REVIEW_REQUIRED", "files": list(self.evidence.files)})
            return "REVIEW_REQUIRED"
        except BaseException:
            try:
                if not self.stop_attempted:
                    self.stop_once()
            except BaseException:
                pass  # Independent supervision remains mandatory; never publish PASS.
            raise Blocked("RUN_INCOMPLETE") from None

def accepted(case, result):
    expected = case["expected"]
    return (type(result) is dict and set(result) == {"status", "unknown", "response", "upstream_requests", "checks"}
        and type(result["status"]) is str and result["status"] == "PASS" and result["unknown"] is False
        and type(result["upstream_requests"]) is int
        and result["upstream_requests"] == expected["upstream_requests"]
        and type(result["response"]) is str and result["response"] in expected["response"]
        and type(result["checks"]) is dict and bool(expected["checks"])
        and set(result["checks"]) == set(expected["checks"])
        and all(value is True for value in result["checks"].values()))

SCENARIOS = {"json", "session", "query", "cookies", "login", "logout", "safe_redirect", "unsafe_redirect", "timeout", "reject_stream", "disconnect", "network_failure", "overflow"}
CHECKS = {"no_store", "proof_accepted", "connection_closed", "target_exact", "deadline_observed", "cookies_separate", "cookie_attributes", "synthetic_cookie_set", "synthetic_session", "synthetic_cookie_deleted", "canonical_location", "no_external_follow", "upstream_cancelled", "ingress_required", "signed_out_session"}
RESPONSES = {"HTTP_200", "HTTP_307", "HTTP_400", "HTTP_403", "HTTP_404", "HTTP_408", "HTTP_413", "HTTP_502", "HTTP_504", "CONNECTION_CLOSED", "CLIENT_DISCONNECTED"}

def validate_cases(document):
    try:
        if type(document) is not dict or set(document) != {"version", "cases"} or type(document["version"]) is not int or document["version"] != 1:
            raise ValueError()
        cases = document["cases"]
        if type(cases) is not list or not 1 <= len(cases) <= 64:
            raise ValueError()
        ids, phases = set(), []
        for c in cases:
            if type(c) is not dict or set(c) != {"id", "phase", "operation", "request", "scenario", "expected", "deadline_seconds"}:
                raise ValueError()
            if type(c["id"]) is not str or not re.fullmatch(r"[a-z0-9-]{1,64}", c["id"]) or c["id"] in ids:
                raise ValueError()
            ids.add(c["id"])
            if c["phase"] not in ("A", "B") or c["scenario"] not in SCENARIOS:
                raise ValueError()
            if not phases or phases[-1] != c["phase"]: phases.append(c["phase"])
            if c["operation"] not in {"request", "oversized-body", "stall-headers", "stall-body", "timeout", "upgrade", "disconnect-after-barrier"}:
                raise ValueError()
            deadline = 18 if c["operation"] in {"stall-headers", "stall-body", "timeout"} else 5
            if type(c["deadline_seconds"]) is not int or c["deadline_seconds"] != deadline: raise ValueError()
            r = c["request"]
            if type(r) is not dict or set(r) != {"method", "target", "headers", "body"}: raise ValueError()
            if r["method"] not in {"GET", "POST", "DELETE"}: raise ValueError()
            if type(r["target"]) is not str or not r["target"].startswith("/") or len(r["target"]) > 10000 or any(ord(x)<33 or ord(x)>126 for x in r["target"]): raise ValueError()
            if r["body"] is not None and (type(r["body"]) is not str or not r["body"].isascii() or len(r["body"]) > 16384): raise ValueError()
            if type(r["headers"]) is not list or len(r["headers"]) > 64: raise ValueError()
            for pair in r["headers"]:
                if type(pair) is not list or len(pair) != 2 or any(type(x) is not str for x in pair): raise ValueError()
                if not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", pair[0]) or len(pair[1]) > 8192 or any(ord(x)<32 or ord(x)>126 for x in pair[1]): raise ValueError()
            e = c["expected"]
            if type(e) is not dict or set(e) != {"upstream_requests", "response", "checks"}: raise ValueError()
            if type(e["upstream_requests"]) is not int or e["upstream_requests"] not in (0,1): raise ValueError()
            for field, allowed in (("checks",CHECKS),("response",RESPONSES)):
                values=e[field]
                if type(values) is not list or not values or any(type(x) is not str or x not in allowed for x in values) or len(set(values)) != len(values): raise ValueError()
        if phases != ["A","B"]: raise ValueError()
        return cases
    except (ValueError, KeyError, TypeError):
        raise Blocked("INVALID_CASE_SCHEMA") from None

def render_request(case, session=False):
    """Fixed wire bytes for the future loopback client; never opens a socket.
    Headers are pairs so duplicate-host/origin cases retain their wire shape.
    """
    request = case["request"]
    supplied = request["headers"]
    names = [x[0].lower() for x in supplied]
    headers = list(supplied)
    if "host" not in names:
        headers.append(["Host", "localhost:3002"])
    body = (request["body"] or "").encode("ascii")
    if case["operation"] == "oversized-body":
        body = b"x" * 16385
    if request["method"] == "POST":
        if "origin" not in names:
            headers.append(["Origin", "http://localhost:3002"])
        if "content-type" not in names:
            headers.append(["Content-Type", "application/json"])
        if "content-length" not in names and "transfer-encoding" not in names:
            headers.append(["Content-Length", str(len(body))])
    if session:
        headers.append(["Cookie", "transport-case=" + case["id"] + "; synthetic-session=mock"])
    if not session:
        headers.append(["Cookie", "transport-case=" + case["id"]])
    if case["operation"] == "upgrade":
        headers.extend([["Connection", "Upgrade"], ["Upgrade", "websocket"], ["Sec-WebSocket-Version", "13"], ["Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ=="]])
    if case["operation"] == "stall-body":
        headers = [pair for pair in headers if pair[0].lower() != "content-length"]
        headers.append(["Content-Length", "10"])
        body = b"{"
    line = request["method"] + " " + request["target"] + " HTTP/1.1\r\n"
    head = line + "".join(name + ": " + value + "\r\n" for name, value in headers)
    if case["operation"] == "stall-headers":
        return head.encode("ascii")  # Deliberately no terminating CRLF.
    wire = (head + "\r\n").encode("ascii") + body
    if len(wire) > 32768:
        raise Blocked("SYNTHETIC_WIRE_LIMIT")
    return wire

def command_line():
    # No execution switch or arbitrary adapter import. Owner-supplied approval
    # booleans cannot activate an unvalidated sandbox/quota/watchdog backend.
    print(json.dumps({"status": "BLOCKED", "code": "NETWORK_STORAGE_AND_PROCESS_ADAPTERS_UNVERIFIED"}))
    return 2


if __name__ == "__main__":
    raise SystemExit(command_line())
