import DashboardLayout from '@/components/DashboardLayout';
import LivePlayerProfile from '@/components/LivePlayerProfile';

export default async function PlayerPage({ params }: { params: Promise<{ nmdId: string }> }) {
  const { nmdId } = await params;
  return <DashboardLayout page="Player profile"><main><div className="page-heading"><div><p>Verified public player profile</p><h1>{nmdId}</h1></div><span className="page-date">READ-ONLY PROFILE</span></div><LivePlayerProfile nmdId={nmdId} /></main></DashboardLayout>;
}
