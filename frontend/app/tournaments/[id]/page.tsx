import DashboardLayout from '@/components/DashboardLayout';
import LiveTournamentDetail from '@/components/LiveTournamentDetail';
import { EligibilityNotice } from '@/components/onboarding/Onboarding';

export default async function TournamentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DashboardLayout page="Tournament detail"><main><div className="page-heading"><div><p>Public tournament information</p><h1>Event dossier</h1></div><span className="page-date">READ-ONLY DATA</span></div><EligibilityNotice /><LiveTournamentDetail id={id} /></main></DashboardLayout>;
}
