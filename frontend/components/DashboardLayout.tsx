'use client';

import { useState } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

export default function DashboardLayout({ children, page }: { children: React.ReactNode; page?: string }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return <div className="preview-shell"><Sidebar page={page} open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} /><div className="shell"><Topbar page={page} onMenu={() => setSidebarOpen((open) => !open)} />{children}<footer><span>NUUDELTSGEEY <b>·</b> PLAY. COMPETE. BUILD YOUR NAME.</span><span><span className="live" /> READ-ONLY API PREVIEW · NO MUTATIONS</span></footer></div></div>;
}
