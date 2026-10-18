import { beforeEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), user: vi.fn(), tournament: vi.fn(), count: vi.fn() }));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.user }, tournament: { findFirst: mocks.tournament, count: mocks.count }, playerProfile: { count: mocks.count }, team: { count: mocks.count }, match: { count: mocks.count } } }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
import AdminPage from '../app/admin/page';
beforeEach(() => { vi.resetAllMocks(); });
describe('admin dashboard read boundary', () => {
  it('redirects unauthenticated users before database reads', async () => {
    mocks.auth.mockResolvedValue(null);
    await expect(AdminPage()).rejects.toThrow('REDIRECT:/admin/login');
    expect(mocks.user).not.toHaveBeenCalled(); expect(mocks.tournament).not.toHaveBeenCalled();
  });
  it.each(['PLAYER', 'REFEREE'])('rejects signed-in %s before dashboard queries', async role => {
    mocks.auth.mockResolvedValue({ user: { id: 'user' } });
    mocks.user.mockResolvedValue({ id: 'user', role, accountStatus: 'ACTIVE' });
    await expect(AdminPage()).rejects.toThrow('REDIRECT:/admin/login');
    expect(mocks.tournament).not.toHaveBeenCalled(); expect(mocks.count).not.toHaveBeenCalled();
  });
  it('does not accept a suspended administrator', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'user' } });
    mocks.user.mockResolvedValue({ id: 'user', role: 'ADMIN', accountStatus: 'SUSPENDED' });
    await expect(AdminPage()).rejects.toThrow('REDIRECT:/admin/login');
    expect(mocks.tournament).not.toHaveBeenCalled();
  });
});
