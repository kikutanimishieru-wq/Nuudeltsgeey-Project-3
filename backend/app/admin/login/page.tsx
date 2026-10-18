import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/session';
import LoginForm from './LoginForm';
import '../admin.css';

export default async function AdminLoginPage() {
  const session = await auth();
  if (session?.user?.id) {
    let allowed = false;
    try { await requireAdmin(); allowed = true; } catch {}
    if (allowed) redirect('/admin');
    redirect('/identity');
  }
  return <main className="login-shell"><section className="login-card"><div className="admin-eyebrow">NUUDELTSGEEY OPERATIONS</div><h1>Admin Control Center</h1><p>Manage Tournament #001 with server-authorized operations.</p><LoginForm /><p><a className="admin-link" href="/identity">Steam / Discord identity</a></p><p><a className="admin-link" href="/">← Return to backend</a></p></section></main>;
}
