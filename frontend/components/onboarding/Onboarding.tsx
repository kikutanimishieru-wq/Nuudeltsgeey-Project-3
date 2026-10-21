'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import { mockPhases, mockPresentation, type MockPhase } from '@/lib/mock-auth';
import { useMockAuth } from './MockAuthProvider';

const labels: Record<MockPhase, string> = {
  'signed-out': 'Нэвтрээгүй', authenticating: 'Discord холболт хийгдэж байна', failed: 'Discord холболт амжилтгүй',
  'discord-only': 'Зөвхөн Discord холбогдсон', verified: 'Discord + Steam баталгаажсан', restricted: 'Хязгаарлагдсан бүртгэл',
};
export function DemoNotice() {
  return <aside className="onboarding-demo" role="note"><strong>ДЕМО ГОРИМ · БОДИТ НЭВТРЭЛТ БИШ</strong><p>Зөвхөн жишээ төлөв харуулна. Бодит бүртгэл үүсэхгүй, Discord болон Steam рүү холбогдохгүй. Хуудсыг дахин ачаалахад төлөв арилна.</p></aside>;
}
export function VerificationBadge({ verified }: { verified: boolean }) {
  return <span className={`verification-badge ${verified ? 'is-verified' : ''}`}>{verified ? '✓ Баталгаажсан (демо)' : '○ Холбогдоогүй'}</span>;
}
export function EligibilityNotice() {
  const { state } = useMockAuth(); const player = mockPresentation(state);
  return <section className="eligibility-notice" aria-label="Тэмцээний жишээ эрх" aria-live="polite">
    <h2>Тэмцээнд оролцох эрх <small>· зөвхөн демо</small></h2>
    <p>{player.restricted ? 'Бүртгэл хязгаарлагдсан. Steam холболт энэ хязгаарлалтыг арилгахгүй. Бодит үйлчилгээний үед дэмжлэгтэй холбогдоно уу.' : player.join ? 'Хоёр бүртгэл баталгаажсан жишээ төлөв. Бодит тэмцээний үйлдэл идэвхгүй хэвээр.' : 'Тэмцээнд оролцохын тулд Steam бүртгэлээ холбоно уу.'}</p>
    {!player.signedIn && <p>Эхлээд Discord-оор нэвтрэх демог эхлүүлээрэй.</p>}
    <dl className="eligibility-grid"><div><dt>Тэмцээн үзэх</dt><dd>Боломжтой</dd></div><div><dt>Тэмцээн зохион байгуулах</dt><dd>{player.host ? 'Жишээ эрх: нээлттэй' : 'Жишээ эрх: хаалттай'}</dd></div><div><dt>Тэмцээнд элсэх</dt><dd>{player.join ? 'Жишээ эрх: нээлттэй' : 'Жишээ эрх: хаалттай'}</dd></div></dl>
    <p className="muted-copy">Бодит эрхийг зөвхөн сервер шийднэ. Энэ дэлгэц тэмцээн үүсгэх эсвэл элсэх хүсэлт илгээхгүй.</p>
  </section>;
}
export function DiscordLoginButton() {
  const { state, dispatch } = useMockAuth();
  return <button type="button" className="discord-login" disabled={state.phase === 'authenticating'} onClick={() => dispatch({ type: 'BEGIN' })}>
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M19.7 5.3a18 18 0 0 0-4.3-1.4l-.5 1a16 16 0 0 0-5.8 0l-.5-1a18 18 0 0 0-4.3 1.4C1.6 9.3.9 13.2 1.3 17a18 18 0 0 0 5.3 2.7l1.1-1.8-1.7-.8.4-.3a12 12 0 0 0 11.2 0l.4.3-1.7.8 1.1 1.8a18 18 0 0 0 5.3-2.7c.5-4.4-.8-8.2-3-11.7ZM8.4 14.7c-1 0-1.8-1-1.8-2.1s.8-2.1 1.8-2.1 1.8 1 1.8 2.1-.8 2.1-1.8 2.1Zm7.2 0c-1 0-1.8-1-1.8-2.1s.8-2.1 1.8-2.1 1.8 1 1.8 2.1-.8 2.1-1.8 2.1Z" /></svg>
    {state.phase === 'authenticating' ? 'Discord холболтыг дуурайлгаж байна…' : 'Discord-оор үргэлжлүүлэх'}
  </button>;
}
export function IdentityStatusCard({ provider }: { provider: 'Discord' | 'Steam' }) {
  const { state } = useMockAuth(); const p = mockPresentation(state);
  return <section className="content-card"><h2>{provider}</h2><VerificationBadge verified={provider === 'Discord' ? p.discord : p.steam} />
    {provider === 'Discord' && <p>Discord нэр: {p.discord ? p.discordName : 'Холбогдоогүй'}</p>}
    <p className="muted-copy">{provider === 'Discord' ? 'Тоглогчийн бүртгэл, нэвтрэлтийн цорын ганц арга.' : 'Зөвхөн өрсөлдөх эрхийн баталгаажуулалт. Steam-ээр нэвтрэхгүй.'}</p>
  </section>;
}
export function SteamConnectCard() {
  const { state, dispatch } = useMockAuth(); const p = mockPresentation(state);
  return <section className="content-card"><h2>Steam бүртгэл холбох</h2>
    <p>{p.restricted ? 'Хязгаарлагдсан бүртгэлээр холболт өөрчлөх демо боломжгүй.' : p.steam ? 'Steam жишээ холболт баталгаажсан.' : 'Discord-оор нэвтэрсний дараа Steam холбох демог үзээрэй.'}</p>
    <button className="primary" type="button" disabled={!p.signedIn || p.steam || p.restricted} onClick={() => dispatch({ type: 'CONNECT_STEAM' })}>Steam холбох (демо)</button>
  </section>;
}
export function PlayerAccountCard() {
  const { state } = useMockAuth(); const p = mockPresentation(state);
  return <section className="content-card player-account-card"><span className="player-demo-avatar" aria-label="Жишээ тоглогчийн аватар">MW</span><div><h2>{p.nickname}</h2><p>Нийтийн NMD ID: <strong>{p.publicNmdId}</strong> · ЖИШЭЭ</p><p>Баталгаажуулалт: {p.restricted ? 'Хязгаарлагдсан' : p.join ? 'Бүрэн (демо)' : 'Дутуу (демо)'}</p><Link className="secondary" href="/account/identity">Бүртгэлийн холболтууд →</Link></div></section>;
}
export function DemoControls() {
  const { state, dispatch } = useMockAuth();
  return <details className="demo-controls"><summary>Демо төлөв сонгох</summary><p>Эдгээр удирдлага зөвхөн харагдах байдлыг шалгана.</p><label>Жишээ төлөв <select value={state.phase} onChange={e => dispatch({ type: 'PREVIEW', phase: e.target.value as MockPhase })}>{mockPhases.map(phase => <option value={phase} key={phase}>{labels[phase]}</option>)}</select></label><button type="button" className="secondary" onClick={() => dispatch({ type: 'RESET' })}>Демог дахин эхлүүлэх</button></details>;
}
export default function Onboarding({ page }: { page: 'login' | 'account' | 'identity' }) {
  const { state, dispatch } = useMockAuth(); const p = mockPresentation(state); const router = useRouter();
  const title = page === 'login' ? 'Discord-оор нэгдэх' : page === 'identity' ? 'Бүртгэлийн холболтууд' : 'Миний бүртгэл';
  return <div className="onboarding-shell"><DashboardLayout page={title}><main lang="mn" className="onboarding-main"><div className="page-heading"><div><span className="eyebrow">NUUDELTSGEEY · PLAYER DEMO</span><h1>{title}</h1></div></div><DemoNotice />
    {page === 'login' && !p.signedIn ? <section className="content-card login-card"><h2>Таны дараагийн тулаан эндээс эхэлнэ.</h2><p>Discord бүртгэлээр нэвтэрч Nuudeltsgeey-д нэгдээрэй.</p><DiscordLoginButton />
      {state.phase === 'authenticating' && <div role="status" aria-live="polite"><p>Бодит OAuth явагдахгүй. Демо үр дүнг сонгоно уу.</p><div className="onboarding-actions"><button type="button" className="primary" onClick={() => { dispatch({ type: 'SUCCESS' }); router.push('/account'); }}>Амжилттай нэвтрэхийг үзүүлэх</button><button type="button" className="secondary" onClick={() => dispatch({ type: 'FAIL' })}>Алдааг үзүүлэх</button><button type="button" className="secondary" onClick={() => dispatch({ type: 'RESET' })}>Цуцлах</button></div></div>}
      {state.phase === 'failed' && <p role="alert">Discord холболтын жишээ алдаа. Дахин оролдох товч бодит хүсэлт илгээхгүй.</p>}
      <p className="muted-copy">Нэг Discord бүртгэлээр бүртгүүлж, дараа нь нэвтэрнэ. Тэмцээнд оролцохын өмнө Steam холбоно.</p></section>
    : !p.signedIn ? <section className="content-card"><h2>Демо бүртгэлээ эхлүүлээрэй</h2><p>Та одоогоор демод нэвтрээгүй байна.</p><Link className="primary" href="/login">Нэвтрэх</Link></section>
    : <><PlayerAccountCard />{page === 'identity' && <div className="onboarding-grid"><IdentityStatusCard provider="Discord" /><IdentityStatusCard provider="Steam" /></div>}{page !== 'identity' && <section className="content-card"><h2>Холболтын төлөв</h2><p>Discord: <VerificationBadge verified={p.discord} /></p><p>Steam: <VerificationBadge verified={p.steam} /></p></section>}<SteamConnectCard /></>}
    <EligibilityNotice /><div className="onboarding-actions"><Link className="secondary" href="/tournaments">Тэмцээнүүд үзэх →</Link>{page === 'identity' && <Link className="secondary" href="/account">← Миний бүртгэл</Link>}</div><DemoControls />
  </main></DashboardLayout></div>;
}
