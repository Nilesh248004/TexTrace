import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Activity, BarChart3, Bell, ClipboardList, Factory, FlaskConical, Gauge, LogOut, Menu, Moon, PackageOpen, Radar, Search, Settings2, ShieldCheck, ScanSearch, Sun, Terminal, Truck, Users, Waves, FileText, Wrench, Boxes } from 'lucide-react';
import { request, useGet } from '../lib/api';
import { useLive, useSession, useTraces, useUi } from '../lib/store';
import { useLiveSocket } from '../lib/ws';
import type { OwnerDashboard, SearchHit } from '@shared/domain';
import { Seg } from './ui';
import { fmtDT } from '../lib/fmt';

const NAV: { label: string; items: { to: string; label: string; icon: typeof Gauge; roles?: string[]; badge?: 'alerts' | 'complaints' }[] }[] = [
  { label: 'MILL', items: [
    { to: '/', label: 'Dashboard', icon: Gauge, badge: 'alerts' },
    { to: '/live', label: 'Live Lot Location', icon: Radar },
    { to: '/lots', label: 'Lot Passport', icon: ScanSearch },
  ] },
  { label: 'OPERATIONS', items: [
    { to: '/production', label: 'Production', icon: Factory },
    { to: '/quality', label: 'Quality', icon: FlaskConical },
    { to: '/accessories', label: 'Accessories & Packing', icon: Wrench },
    { to: '/dispatch', label: 'Dispatch', icon: Truck },
  ] },
  { label: 'CUSTOMERS & QUALITY', items: [
    { to: '/complaints', label: 'Complaints', icon: ClipboardList, badge: 'complaints' },
    { to: '/masters', label: 'Masters', icon: FileText },
    { to: '/analytics', label: 'Analytics', icon: BarChart3 },
    { to: '/customers', label: 'Customers', icon: Users },
  ] },
  { label: 'PLATFORM', items: [{ to: '/developer', label: 'Developer Console', icon: Terminal, roles: ['ADMIN', 'DEVELOPER', 'AUDITOR'] }] },
];

export function Shell(): JSX.Element {
  useLiveSocket();
  const { user, clear, set } = useSession();
  const { theme, setTheme, dev, setDev, count, setCount, judge, setJudge } = useUi();
  const { height, online } = useLive();
  const nav = useNavigate(); const loc = useLocation();
  const [open, setOpen] = useState(false);
  const meta = useGet<{ counts: { id: string; display: string }[]; now: string; millName: string }>('/api/meta');
  const dash = useGet<OwnerDashboard>('/api/dashboard/owner', { staleTime: 30_000 });
  const demo = useGet<{ username: string; name: string; roleLabel: string; role: string }[]>('/api/auth/demo-users');
  const alerts = dash.data?.alerts.filter((a) => a.severity === 'red').length ?? 0;
  const openComplaints = dash.data?.kpis.complaints.open ?? 0;
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); }, [theme]);

  // global search → Enter opens the best hit (typing "101" opens Lot 101's passport)
  const [q, setQ] = useState(''); const [hits, setHits] = useState<SearchHit[]>([]); const [focus, setFocus] = useState(false); const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => { clearTimeout(timer.current); if (!q.trim()) { setHits([]); return; } timer.current = setTimeout(() => { request<SearchHit[]>('GET', `/api/search?q=${encodeURIComponent(q)}`).then((r) => setHits(r.data)).catch(() => setHits([])); }, 160); return () => clearTimeout(timer.current); }, [q]);
  const go = (h: SearchHit) => { setQ(''); setHits([]); nav(h.link); };
  const switchUser = async (username: string) => { const r = await request<{ token: string; user: never }>('POST', '/api/auth/login', { username }); set(r.data.token, r.data.user); nav(r.data.user && (r.data.user as { role: string }).role === 'BUYER' ? '/portal' : '/'); };
  const traceNotes = useTraces((s) => s.notes); const dismiss = useTraces((s) => s.dismiss);

  return <div className="app">
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <Link to="/" className="brand"><span className="brand-mark"><Waves size={18} /></span><span><b>TEXTRACE</b><small>MILL TRACEABILITY</small></span></Link>
      <nav className="stack" style={{ gap: 4 }}>
        {NAV.map((g) => { const items = g.items.filter((i) => !i.roles || (user && i.roles.includes(user.role))); return items.length ? <div className="nav-group" key={g.label}><div className="nav-label">{g.label}</div>{items.map((i) => <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} data-testid={`nav-${i.to.replace(/\//g, '') || 'dashboard'}`}><i.icon size={17} />{i.label}{i.badge === 'alerts' && alerts ? <span className="nav-badge" title="Red alerts">{alerts}</span> : null}{i.badge === 'complaints' && openComplaints ? <span className="nav-badge" title="Open complaints">{openComplaints}</span> : null}</NavLink>)}</div> : null; })}
      </nav>
      <div className="sidebar-foot">
        <div className="row" style={{ gap: 8, fontSize: 12, color: 'hsl(var(--sidebar-muted-foreground))' }}><span className={`dot ${online ? 'live' : 'none'}`} /> Ledger {online ? 'live' : 'offline'} · block #{height ?? '—'}</div>
        <div className="user-chip"><div className="avatar">{user?.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</div><div className="grow"><b style={{ fontSize: 13 }}>{user?.name}</b><small>{user?.title}</small></div><button className="btn ghost icon" style={{ color: 'inherit' }} title="Sign out" aria-label="Sign out" onClick={() => { clear(); nav('/'); }}><LogOut size={16} /></button></div>
      </div>
    </aside>
    <div className="main">
      <header className="topbar no-print">
        <button className="btn icon menu-btn" onClick={() => setOpen(!open)} aria-label="Menu"><Menu size={17} /></button>
        <div style={{ position: 'relative', width: 'min(360px, 40vw)' }}>
          <div className="search" style={{ maxWidth: 'none' }}><Search size={14} /><input className="input sm" data-testid="global-search" placeholder="Search lot, bale, mix, machine, customer, invoice, vehicle…" value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) go(hits[0]); if (e.key === 'Escape') setQ(''); }} aria-label="Global search" /></div>
          {focus && hits.length ? <div className="card" style={{ position: 'absolute', top: 38, left: 0, right: 0, zIndex: 50, maxHeight: 380, overflow: 'auto' }} data-testid="search-results">{hits.map((h, i) => <button key={i} className="alert-row" style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, cursor: 'pointer' }} onMouseDown={() => go(h)}><span className="pill blue" style={{ textTransform: 'capitalize' }}>{h.kind}</span><div><b>{h.title}</b><div className="muted small">{h.subtitle}</div></div></button>)}</div> : null}
        </div>
        <div className="grow" />
        <div className="seg" title="Global count filter" data-testid="count-selector">{[{ id: 'ALL', display: 'All counts' }, ...(meta.data?.counts ?? [])].map((c) => <button key={c.id} className={count === c.id ? 'on' : ''} onClick={() => setCount(c.id)}>{c.id === 'ALL' ? 'All' : c.display}</button>)}</div>
        <div className="row small muted" style={{ gap: 6, flexWrap: 'nowrap' }} title="Judge results against the master version active on the production date (As produced), or re-judge everything on the latest active master (Latest master)">Masters<Seg value={judge} onChange={setJudge} options={[{ key: 'asOf', label: 'As produced' }, { key: 'latest', label: 'Latest master' }]} /></div>
        <label className="row small nowrap" style={{ gap: 6, cursor: 'pointer', flexWrap: 'nowrap' }} title="Developer mode shows ledger proof after every action"><input type="checkbox" checked={dev} onChange={(e) => setDev(e.target.checked)} data-testid="devmode-toggle" /> Dev</label>
        <select className="select sm" style={{ width: 150 }} value={user?.username} onChange={(e) => void switchUser(e.target.value)} aria-label="Switch user" data-testid="role-switcher">{(demo.data ?? []).map((u) => <option key={u.username} value={u.username}>{u.name} · {u.roleLabel}</option>)}</select>
        <button className="btn icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme" data-testid="theme-toggle">{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
        <span className="pill gray nowrap" title="Demo clock">{meta.data ? fmtDT(meta.data.now) : ''}</span>
      </header>
      <Outlet />
    </div>
    <div className="tracebar no-print" aria-live="polite">{traceNotes.map((n) => <div key={n.id} className={`tracecard ${n.trace.accepted ? '' : 'bad'}`} onClick={() => dismiss(n.id)} data-testid="trace-card">
      <div className="row between"><b>{n.trace.accepted ? <><ShieldCheck size={13} style={{ verticalAlign: -2 }} /> Committed on the ledger</> : 'Rejected by the contract'}</b><span className="muted tiny">block #{n.trace.blockNumber}</span></div>
      <div className="small">{n.label}</div>
      {n.trace.accepted ? <div className="mono tiny muted">{n.trace.invocations.map((i) => `${i.contract}.${i.fn}`).join(' → ')} · tx {n.trace.txHashes[0]?.slice(0, 14)}… · {n.trace.validatorApprovals.filter((a) => a.approved).length}/4 validators</div> : <div className="small" style={{ color: 'hsl(var(--bad-foreground))' }}>{n.trace.reason}</div>}
      {useUi.getState().dev || !n.trace.accepted ? <Link className="small" to={`/developer?action=${n.trace.actionId}`} onClick={(e) => e.stopPropagation()}>Open in Developer Console →</Link> : null}
    </div>)}</div>
  </div>;
}
void Activity; void Bell; void Settings2; void PackageOpen; void Boxes;
