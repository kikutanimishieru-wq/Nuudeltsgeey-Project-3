import { SecurityError } from './security-error';
export const attendanceRuleVersion = 'OWNER_PHASE4_FINAL_2026_10_16';
export const selfAttendancePolicy = 'AUTHENTICATED_SELF_CONFIRMATION_V1';
export function registrationDeadline(start: Date) {
  return checkInWindow(start, { kind: 'ORDINARY' }).opensAt;
}
// Half-open windows: the start instant closes check-in. Date values are UTC instants.
export function checkInWindow(start: Date, policy: { kind: 'ORDINARY' } | {
  kind: 'GRAND_CHAMPIONSHIP_FINAL'; separatelyScheduledFinal: true; lockedClassification: 'GRAND_BATTLE';
}) {
  if (!Number.isFinite(start.getTime())) throw new SecurityError('SCHEDULE_REQUIRED', 409);
  if (policy.kind === 'GRAND_CHAMPIONSHIP_FINAL' &&
      (policy.separatelyScheduledFinal !== true || policy.lockedClassification !== 'GRAND_BATTLE')) {
    throw new SecurityError('LOCKED_GRAND_FINAL_REQUIRED', 409);
  }
  return { opensAt: new Date(start.getTime() - (policy.kind === 'ORDINARY' ? 15 : 30) * 60000), closesAt: start };
}
export function assertCheckInTime(start: Date, now: Date) {
  const window = checkInWindow(start, { kind: 'ORDINARY' });
  if (now < window.opensAt || now >= window.closesAt) throw new SecurityError('CHECK_IN_WINDOW_CLOSED', 409);
  return window;
}
export function protectedDeadline(floor: number, scheduledStart: Date) {
  if (floor !== 2) throw new SecurityError('FLOOR_2_REQUIRED', 409);
  return new Date(scheduledStart.getTime() + 15 * 60000);
}
export function completeEntrant(required: number, players: { isStarter: boolean; eligible: boolean; attended: boolean }[]) {
  const active = players.filter(p => p.isStarter);
  return active.length === required && active.every(p => p.eligible && p.attended);
}
