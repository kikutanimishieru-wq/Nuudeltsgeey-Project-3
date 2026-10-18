import { hasAdministrativeHold } from '@/lib/identity-policy';
import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import IdentityActions from './IdentityActions';
import '../admin/admin.css';
export const dynamic = 'force-dynamic';
export default async function IdentityPage() {
  const session = await auth();
  const user = session?.user?.id ? await prisma.user.findUnique({ where: { id: session.user.id }, select: { publicNmdId: true, accountStatus: true,
    externalIdentities: { select: { provider: true, revokedAt: true, administrativeHoldAt: true, revocationKind: true } } } }) : null;
  return <main className="login-shell"><section className="login-card"><div className="admin-eyebrow">NUUDELTSGEEY IDENTITY</div><h1>Competitive identity</h1>{user && <><p>{user.publicNmdId} · {user.accountStatus}</p><ul>{['STEAM', 'DISCORD'].map(provider => <li key={provider}>{provider}: {user.externalIdentities.some(link => link.provider === provider && !link.revokedAt && !hasAdministrativeHold(link)) ? 'Verified' : 'Verification required'}</li>)}</ul></>}{user?.externalIdentities.some(hasAdministrativeHold) && <p role="status">An identity security hold requires administrator review before reverification.</p>}<IdentityActions signedIn={Boolean(user)} /><p><Link className="admin-link" href="/admin/login">Account sign-in</Link> · <Link className="admin-link" href="/">Return home</Link></p></section></main>;
}
