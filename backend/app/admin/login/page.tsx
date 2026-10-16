import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import LoginForm from './LoginForm';
import '../admin.css';

export default async function AdminLoginPage() {
  const session = await auth();
  if (session?.user?.id) redirect('/admin');
  return <main className="login-shell"><section className="login-card"><div className="admin-eyebrow">NUUDELTSGEEY OPERATIONS</div><h1>Admin Control Center</h1><p>Manage Tournament #001 with server-authorized operations.</p><LoginForm /><p><a className="admin-link" href="/">← Return to backend</a></p></section></main>;
}
