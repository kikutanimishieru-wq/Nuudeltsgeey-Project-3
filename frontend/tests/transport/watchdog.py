"""Mockable supervision core. No operational launch, IPC or process adapter."""
from dataclasses import dataclass
import json
import time

class SafetyStop(Exception):
    pass

@dataclass(frozen=True)
class Identity:
    handle: str
    pid: int
    pgid: int
    sid: int
    birth: str

class Watchdog:
    def __init__(self, platform, clock=time.monotonic, run_id="mock-run", case_plan=None):
        self.platform, self.clock, self.run_id = platform, clock, run_id
        self.started = clock()
        self.total_deadline = self.started + 180
        self.phase = None
        self.case = None
        self.state = "IDLE"
        self.test_status = "RUNNING"
        self.unknown = False
        self.records = []
        self.owned = {}
        self.reaped = set()
        self.reap_attempted = set()
        self.phase_deadline = self.request_deadline = None
        self.stop_deadline = self.kill_deadline = None
        self.escalated = False
        self.used_cases = set()
        # Supplied only by the future trusted launch adapter from authorized snapshot.
        self.case_plan = None if case_plan is None else {p: tuple(tuple(x) for x in case_plan[p]) for p in ("A", "B")}
        self.completed_cases = []
        self.phase_passed = False

    def record(self, code):
        # Exhaustion cannot disable termination. Keep a separate sticky fault.
        if len(self.records) >= 256:
            self.unknown = True
            self.test_status = "UNKNOWN"
            return
        self.records.append({"code": code, "elapsed_seconds": self.clock()-self.started})

    def fault(self):
        self.unknown = True
        self.test_status = "UNKNOWN"
        self.stop()

    def phase_start(self, phase):
        if not ((self.phase is None and phase == "A" and self.state == "IDLE") or
                (self.phase == "A" and phase == "B" and self.state == "CLEAN" and self.test_status == "RUNNING" and self.phase_passed is True)):
            raise SafetyStop("ILLEGAL_PHASE_TRANSITION")
        self.phase = phase
        self.completed_cases = []
        self.phase_passed = False
        self.state = "STARTING"
        self.owned = {}
        self.reaped = set()
        self.reap_attempted = set()
        self.escalated = False
        self.phase_deadline = min(self.clock()+30, self.total_deadline-9)

    def own(self, identity):
        if self.state != "STARTING" or type(identity) is not Identity:
            raise SafetyStop("INVALID_LAUNCH_STATE")
        if (identity.handle not in {"frontend", "upstream"} or identity.handle in self.owned
            or any(type(x) is not int for x in (identity.pid,identity.pgid,identity.sid)) or identity.pid <= 1
            or identity.pid != identity.pgid or identity.pid != identity.sid
            or type(identity.birth) is not str or not identity.birth
            or any(x.pid == identity.pid for x in self.owned.values())):
            raise SafetyStop("INVALID_PROCESS_IDENTITY")
        if self.platform.identity_reserved(identity) is not True:
            self.fault()
            raise SafetyStop("OWNERSHIP_UNVERIFIED")
        self.owned[identity.handle] = identity
        self.record("CHILD_OWNED")

    def ready(self):
        self.tick()
        if self.state != "STARTING" or set(self.owned) != {"frontend", "upstream"} or self.unknown:
            raise SafetyStop("READY_WITHOUT_OWNERSHIP")
        if any(self.platform.identity_reserved(x) is not True for x in self.owned.values()):
            self.fault()
            raise SafetyStop("OWNERSHIP_LOST")
        self.state = "ACTIVE"
        self.phase_deadline = None

    def request_start(self, case_id, seconds):
        if (self.state != "ACTIVE" or self.case is not None or type(seconds) is not int
            or seconds not in (5,18) or type(case_id) is not str or not case_id
            or case_id in self.used_cases):
            raise SafetyStop("INVALID_REQUEST_TRANSITION")
        if self.case_plan is None or len(self.completed_cases) >= len(self.case_plan[self.phase]) or self.case_plan[self.phase][len(self.completed_cases)] != (case_id, seconds):
            raise SafetyStop("UNAUTHORIZED_CASE_OR_DEADLINE")
        self.case = case_id
        self.used_cases.add(case_id)
        self.request_deadline = min(self.clock()+seconds, self.total_deadline-9)

    def request_done(self, case_id, passed):
        self.tick()
        if self.state != "ACTIVE" or self.case != case_id or passed is not True:
            self.test_status = "FAIL" if passed is False else "UNKNOWN"
            self.stop()
            raise SafetyStop("REQUEST_FAILED")
        self.completed_cases.append((case_id, int(self.case_plan[self.phase][len(self.completed_cases)][1])))
        self.case = None
        self.request_deadline = None

    def phase_done(self):
        self.tick()
        if (self.state != "ACTIVE" or self.case is not None or self.unknown
            or self.test_status != "RUNNING" or self.case_plan is None
            or not self.completed_cases or tuple(self.completed_cases) != self.case_plan[self.phase]):
            raise SafetyStop("PHASE_NOT_PASSED")
        self.phase_passed = True

    def _signal(self, identity, name):
        try:
            if identity.handle in self.reap_attempted or self.platform.identity_reserved(identity) is not True:
                self.unknown = True
                self.record("IDENTITY_UNCERTAIN_NO_SIGNAL")
                return
            if self.platform.signal_owned_group(identity, name) is not True:
                self.unknown = True
                self.record("SIGNAL_UNCONFIRMED")
                return
            self.record("OWNED_"+name)
        except Exception:
            self.unknown = True
            self.record("SIGNAL_UNCONFIRMED")

    def stop(self):
        if self.state in {"STOPPING", "UNKNOWN", "CLEAN"}:
            return
        if not self.phase_passed and self.test_status == "RUNNING":
            self.test_status = "FAIL"
        self.state = "STOPPING"
        self.phase_deadline = self.request_deadline = None
        self.stop_deadline = min(self.clock()+7, self.total_deadline-2)
        self.kill_deadline = min(self.stop_deadline+2, self.total_deadline)
        for identity in self.owned.values():
            self._signal(identity,"TERM")

    def tick(self):
        now = self.clock()
        if self.state not in {"STOPPING","UNKNOWN","CLEAN"} and (
            self.unknown or now >= self.total_deadline-9 or
            self.phase_deadline is not None and now >= self.phase_deadline or
            self.request_deadline is not None and now >= self.request_deadline):
            self.test_status = "UNKNOWN" if self.unknown else "FAIL"
            self.record("DEADLINE_OR_FAULT")
            self.stop()
        if self.state == "STOPPING":
            if now >= self.stop_deadline and not self.escalated:
                self.escalated = True
                for identity in self.owned.values(): self._signal(identity,"KILL")
            if now >= self.kill_deadline and not self.confirm_cleanup():
                self.state = "UNKNOWN"
                self.unknown = True
                self.record("CLEANUP_UNKNOWN")

    def confirm_cleanup(self):
        if self.state != "STOPPING": return self.state == "CLEAN"
        if not self.owned:
            self.unknown = True
            return False
        try:
            for identity in self.owned.values():
                if identity.handle in self.reap_attempted and identity.handle not in self.reaped:
                    self.unknown = True
                    return False
                if identity.handle in self.reaped: continue
                for observation in (self.platform.exited_without_reap(identity), self.platform.no_live_descendants(identity)):
                    if observation is not True:
                        if observation is not False: self.unknown = True
                        return False
            # Reaping releases identity reservations; no later signaling is allowed.
            for identity in self.owned.values():
                if identity.handle not in self.reaped:
                    self.reap_attempted.add(identity.handle)
                    if self.platform.reap_owned_child(identity) is not True:
                        self.unknown = True
                        return False
                    self.reaped.add(identity.handle)
            if any(self.platform.group_absent(x) is not True for x in self.owned.values()) or self.platform.listeners_released((3001,3002)) is not True:
                self.unknown = True
                self.state = "UNKNOWN"
                return False
        except Exception:
            self.unknown = True
            return False
        if self.unknown: return False
        self.state = "CLEAN"
        self.record("CLEANUP_OBSERVED")
        if self.unknown:
            self.state = "UNKNOWN"
            return False
        return True

    def dispatch(self, message):
        if type(message) is not dict or set(message) != {"run_id","phase","case_id","op","seconds","passed"}:
            raise SafetyStop("INVALID_IPC_SCHEMA")
        if message["run_id"] != self.run_id: raise SafetyStop("WRONG_RUN")
        op, phase, case = message["op"], message["phase"], message["case_id"]
        if op == "STARTUP":
            if case is not None or message["seconds"] is not None or message["passed"] is not None: raise SafetyStop("INVALID_STARTUP")
            self.phase_start(phase)
        else:
            if phase != self.phase: raise SafetyStop("WRONG_PHASE")
            if op == "REQUEST":
                if message["passed"] is not None: raise SafetyStop("INVALID_REQUEST")
                self.request_start(case,message["seconds"])
            elif op == "REQUEST_DONE":
                if message["seconds"] is not None: raise SafetyStop("INVALID_DONE")
                self.request_done(case,message["passed"])
            elif op in {"STOP","READY","PHASE_DONE"}:
                if case != self.case or message["seconds"] is not None or message["passed"] is not None: raise SafetyStop("WRONG_CASE")
                if op == "STOP": self.stop()
                elif op == "READY": self.ready()
                else: self.phase_done()
            else: raise SafetyStop("INVALID_OPERATION")

def serve(channel, platform, clock=time.monotonic, run_id="mock-run"):
    """No live adapter supplied. Registration uses trusted platform-owned handles,
    never IPC-supplied PIDs. Adapter calls must be bounded/nonblocking.
    """
    if platform.independently_validated() is not True: raise SafetyStop("ADAPTER_UNVERIFIED")
    dog = Watchdog(platform,clock,run_id,platform.authorized_case_plan(run_id))
    connected = True
    seen = 0
    while dog.state not in {"CLEAN","UNKNOWN"} or (dog.state == "CLEAN" and dog.phase == "A" and dog.test_status == "RUNNING"):
        dog.tick()
        if dog.state == "UNKNOWN": break
        try:
            if connected:
                message = channel.receive(0.05)
                if message is not None:
                    seen += 1
                    if seen > 256: raise SafetyStop("IPC_LIMIT")
                    dog.dispatch(message)
                    if message["op"] == "STARTUP":
                        for identity in platform.register_owned_children(run_id,dog.phase): dog.own(identity)
                    channel.send({"run_id":run_id,"phase":dog.phase,"case_id":dog.case,"state":dog.state})
            else:
                platform.wait_tick(0.05)
            if dog.state == "STOPPING": dog.confirm_cleanup()
            if dog.state == "CLEAN" and dog.clock() >= dog.total_deadline-9:
                dog.test_status = "FAIL"
                break
        except Exception:
            connected = False
            if dog.state == "CLEAN":
                dog.test_status = "UNKNOWN"
                break
            dog.fault()
    if connected:
        try: channel.send({"state":dog.state,"test_status":dog.test_status,"records":dog.records})
        except Exception: dog.test_status = "UNKNOWN"
    return {"cleanup":dog.state,"test_status":dog.test_status}

def command_line():
    print(json.dumps({"status":"BLOCKED","code":"WATCHDOG_PLATFORM_ADAPTER_UNVERIFIED"}))
    return 2

if __name__ == "__main__":
    raise SystemExit(command_line())
