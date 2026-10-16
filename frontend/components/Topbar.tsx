import Link from 'next/link';

export default function Topbar({ page = 'Overview', onMenu }: { page?: string; onMenu: () => void }) {
  return <header className="topbar"><button className="menu" aria-label="Open navigation" aria-expanded="false" onClick={onMenu}>☰</button><div className="breadcrumb">Arena <span>/</span><b>{page}</b></div><div className="top-actions"><span className="season-pill"><span className="live" />SEASON 01</span><Link className="balance" href="/wallet">◈ <b>1,250</b> <small>AT</small></Link><button className="top-icon" aria-label="Notifications">♧<i /></button><Link className="avatar" href="/badge" aria-label="Open badge">B</Link></div></header>;
}
