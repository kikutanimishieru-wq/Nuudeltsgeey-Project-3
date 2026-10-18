import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import PublicNav from '../../public-nav';
import HostConfigurationForm from './HostConfigurationForm';
export const dynamic = 'force-dynamic';
export default async function ManageTournamentsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/identity');
  return <main className="public-shell"><div className="public-wrap"><PublicNav /><header className="public-hero"><div className="public-eyebrow">HOST CONFIGURATION</div><h1>Your tournaments</h1><p>Save a reviewed configuration. Competition activation requires the later approved workflows.</p><Link className="public-link" href="/identity">Manage verified identity</Link></header><HostConfigurationForm /></div></main>;
}
