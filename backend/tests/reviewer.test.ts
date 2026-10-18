import { describe, it, expect, vi } from 'vitest';
import { requireIndependentReviewer } from '../lib/reviewer';
function context() {
  return { tournament: { findUnique: vi.fn().mockResolvedValue({ hostUserId: null }) }, $queryRaw: vi.fn(), user: { findUnique: vi.fn().mockResolvedValue({ role: 'ADMIN', accountStatus: 'ACTIVE' }) },
    incident: { findUnique: vi.fn().mockResolvedValue({ id: 'case', tournamentId: 'tournament', reporterId: 'reporter', parties: [{ userId: 'subject' }] }) },
    playerProfile: { findMany: vi.fn().mockResolvedValue([{ currentTeamId: 'involved-team' }]), findFirst: vi.fn().mockResolvedValue(null) },
    reviewAssignment: { findUnique: vi.fn().mockResolvedValue({ assignedById: 'assigner' }) } };
}
const actor = { id: 'reviewer', role: 'REFEREE', accountStatus: 'ACTIVE' };
describe('independent case reviewer', () => {
  it('allows a recorded independent assignment', async () => {
    await expect(requireIndependentReviewer(context() as never, actor, 'case', false)).resolves.toHaveProperty('id', 'case');
  });
  it('requires current database authority instead of stale session role', async () => {
    const db = context(); db.user.findUnique.mockResolvedValueOnce({ role: 'PLAYER', accountStatus: 'ACTIVE' });
    await expect(requireIndependentReviewer(db as never, { ...actor, role: 'ADMIN' }, 'case', false)).rejects.toThrow('FORBIDDEN');
  });
  it('blocks referee serious review', async () => {
    const db = context(); db.user.findUnique.mockResolvedValueOnce({ role: 'REFEREE', accountStatus: 'ACTIVE' });
    await expect(requireIndependentReviewer(db as never, actor, 'case', true)).rejects.toThrow('FORBIDDEN');
  });
  it.each(['reporter', 'subject'])('blocks %s from review', async id => {
    await expect(requireIndependentReviewer(context() as never, { ...actor, id }, 'case', false)).rejects.toThrow('CONFLICT_OF_INTEREST');
  });
  it('blocks competing players or involved teammates', async () => {
    const db = context(); db.playerProfile.findFirst.mockResolvedValue({ id: 'player' } as never);
    await expect(requireIndependentReviewer(db as never, actor, 'case', false)).rejects.toThrow('CONFLICT_OF_INTEREST');
  });
  it('requires recorded parties and independent assignment for administrators too', async () => {
    const db = context(); db.reviewAssignment.findUnique.mockResolvedValue(null as never);
    await expect(requireIndependentReviewer(db as never, { ...actor, role: 'ADMIN' }, 'case', false)).rejects.toThrow('INDEPENDENT_ASSIGNMENT_REQUIRED');
    const legacy = context(); legacy.incident.findUnique.mockResolvedValue({ id: 'case', parties: [] } as never);
    await expect(requireIndependentReviewer(legacy as never, actor, 'case', false)).rejects.toThrow('REVIEW_CONTEXT_REQUIRED');
  });
  it('rejects self-assignment and an assigner who becomes involved', async () => {
    const self = context(); self.reviewAssignment.findUnique.mockResolvedValue({ assignedById: 'reviewer' });
    await expect(requireIndependentReviewer(self as never, actor, 'case', false)).rejects.toThrow('INDEPENDENT_ASSIGNMENT_REQUIRED');
    const conflict = context(); conflict.reviewAssignment.findUnique.mockResolvedValue({ assignedById: 'subject' });
    await expect(requireIndependentReviewer(conflict as never, actor, 'case', false)).rejects.toThrow('CONFLICT_OF_INTEREST');
  });
});
