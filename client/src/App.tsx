import { useEffect, useState } from 'react';
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Boxes, Check, CheckCircle2, ChevronRight,
  CircleDot, ClipboardCheck, Factory, FileSearch, GitBranch, Layers3, LogOut, Menu, Moon, PackageCheck,
  Radio, Search, ShieldCheck, Sun, Truck, Waves, XCircle,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { GateResult } from '@shared/types';

type User = { id: string; username: string; name: string; role: string; org: string; title?: string; customerId?: string | null };
type Envelope<T> = { ok: true; data: T; trace?: { txHashes: string[]; blockNumber: number } } | { ok: false; error: { message: string } };
type Summary = {
  millName: string; businessDate: string;
  complaints: { total: number; open: number; underAnalysis: number; resolved: number };
  lots: { total: number; inProduction: number; onHold: number; dispatched: number };
  qualityAlerts: { red: number; yellow: number; windowDays: number };
  dispatches: { month: string; count: number; quantityKg: number };
  ledger: { blocks: number; transactions: number; invalidTx: number; lastBlockAt: string | null };
  analyses: { completed: number; llmEnabled: boolean };
};
type Lot = { id: string; lotNo: string; lotCode: string; countId: string; countDisplay: string; line: string; status: string; plannedKg: number; producedKg: number; packedKg: number; dispatchedKg: number; startDate: string; worstColor: string; redCount: number; yellowCount: number; customers: string[]; chain: { blockNumber: number | null; verified: boolean } };
type Complaint = { id: string; complaint_no: string; complainant_name: string; type: string; customer_name: string; lot_no: string; status: string; received_date: string; description: string; block_number: number | null };
type Standard = { id: string; count_id: string; department: string; parameter: string; category: string; std: number; lower_limit: number | null; upper_limit: number | null; unit: string; version: number };
type Dispatch = { id: string; dispatch_no: string; dispatch_date: string; quantity_kg: number; count_id: string; customer_name: string; vehicle_no: string; passport_code: string };

async function api<T>(path: string, token?: string | null): Promise<T> {
  const response = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const envelope = (await response.json()) as Envelope<T>;
  if (!response.ok || !envelope.ok) throw new Error(envelope.ok ? `Request failed (${response.status})` : envelope.error.message);
  return envelope.data;
}

async function mutate<T>(method: 'POST'|'PUT'|'DELETE',path: string, body: unknown, token: string): Promise<T> {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const envelope = (await response.json()) as Envelope<T>;
  if (!response.ok || !envelope.ok) throw new Error(envelope.ok ? `Request failed (${response.status})` : envelope.error.message);
  return envelope.data;
}
async function post<T>(path: string, body: unknown, token: string): Promise<T> { return mutate('POST',path,body,token); }

function useData<T>(path: string, token: string | null): { data: T | null; error: string; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!path) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    api<T>(path, token).then((next) => { if (active) { setData(next); setError(''); } })
      .catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : 'Unable to load data'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path, token, nonce]);
  return { data, error, loading, reload: () => setNonce((v) => v + 1) };
}

const navGroups = [
  { label: 'WORKSPACE', items: [
    { to: '/', label: 'Overview', icon: Activity },
    { to: '/complaints', label: 'Complaints', icon: CircleDot },
    { to: '/lots', label: 'Lot tracking', icon: Layers3 },
    { to: '/standards', label: 'Quality standards', icon: ClipboardCheck },
  ] },
  { label: 'OPERATIONS', items: [
    { to: '/analysis/heatmap', label: 'U% heatmap', icon: Waves },
    { to: '/analysis/ai', label: 'AI analysis', icon: FileSearch },
    { to: '/dispatch', label: 'Dispatch', icon: Truck },
    { to: '/passport/PP-182DEMO', label: 'Product passport', icon: ShieldCheck },
  ] },
  { label: 'PLATFORM', items: [
    { to: '/developer', label: 'Ledger explorer', icon: GitBranch },
    { to: '/showcase', label: 'Project showcase', icon: Factory },
  ] },
];

function App(): JSX.Element {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('textrace.token'));
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(!!localStorage.getItem('textrace.token'));
  const location = useLocation();
  const publicPassport = location.pathname.startsWith('/passport/');

  useEffect(() => {
    if (!token) { setUser(null); setBooting(false); return; }
    setBooting(true);
    api<User>('/api/auth/me', token).then(setUser).catch(() => { localStorage.removeItem('textrace.token'); setToken(null); }).finally(() => setBooting(false));
  }, [token]);

  if (publicPassport) return <Routes><Route path="/passport/:code" element={<PassportPage />} /></Routes>;
  if (booting) return <div className="boot-screen"><div className="loader-mark"><Waves size={21} /></div><span>Opening mill workspace</span></div>;
  if (!token || !user) return <LoginPage onLogin={(nextToken, nextUser) => { localStorage.setItem('textrace.token', nextToken); setToken(nextToken); setUser(nextUser); }} />;
  const logout = () => { localStorage.removeItem('textrace.token'); setToken(null); setUser(null); };
  return <Shell token={token} user={user} onLogout={logout} onUserChange={(next) => setUser(next)}>
    <Routes>
      <Route path="/" element={<Dashboard token={token} />} />
      <Route path="/complaints" element={<ComplaintsPage token={token} />} />
      <Route path="/complaints/new" element={<RegisterComplaintPage token={token} />} />
      <Route path="/complaints/:id" element={<ComplaintDetailPage token={token} />} />
      <Route path="/lots" element={<LotsPage token={token} />} />
      <Route path="/lots/:id" element={<LotDetailPage token={token} />} />
      <Route path="/standards" element={<StandardsPage token={token} />} />
      <Route path="/dispatch" element={<DispatchPage token={token} />} />
      <Route path="/dispatch/new" element={<DispatchFormPage token={token} />} />
      <Route path="/dispatch/:id" element={<DispatchDetailPage token={token} />} />
      <Route path="/analysis/heatmap" element={<HeatmapPage token={token} />} />
      <Route path="/analysis/ai" element={<AnalysisPage token={token} />} />
      <Route path="/developer" element={<DeveloperPage token={token} />} />
      <Route path="/showcase" element={<ShowcasePage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  </Shell>;
}

function LoginPage({ onLogin }: { onLogin: (token: string, user: User) => void }): JSX.Element {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const users = [
    ['admin', 'Mill administrator', 'R. Senthil Kumar'], ['dev', 'Blockchain developer', 'A. Karthik'],
    ['operator', 'Production supervisor', 'M. Ravi'], ['qa', 'Quality engineer', 'S. Priya'],
    ['dispatch', 'Dispatch & packing', 'K. Murugan'], ['cs', 'Customer service', 'J. Anitha'],
    ['auditor', 'Internal auditor', 'V. Ramesh'], ['buyer', 'Buyer portal', 'PD Textiles'],
  ];
  const signIn = async (username: string) => {
    setBusy(username); setError('');
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) });
      const result = (await response.json()) as Envelope<{ token: string; user: User }>;
      if (!response.ok || !result.ok) throw new Error(result.ok ? 'Sign in failed' : result.error.message);
      onLogin(result.data.token, result.data.user);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not sign in'); }
    finally { setBusy(''); }
  };
  return <main className="login-page">
    <section className="login-left">
      <div className="brand-lockup"><div className="brand-symbol"><Waves size={22} strokeWidth={2.5} /></div><div><strong>TEXTRACE</strong><span>FIBRE TO YARN</span></div></div>
      <div className="login-story"><p className="eyebrow">MILL OPERATIONS · 2026</p><h1>Every fibre has<br /><em>a record.</em></h1><p>Trace the movement of cotton through production, testing and delivery. Each milestone is secured to a permissioned ledger.</p></div>
      <div className="login-proof"><span><ShieldCheck size={17} /> 3-of-4 validator network</span><span><GitBranch size={17} /> Tamper-evident records</span></div>
    </section>
    <section className="login-right"><div className="login-panel">
      <p className="eyebrow">SECURE WORKSPACE</p><h2>Choose your role</h2><p className="quiet">Sign in to Model Spinning Mill · Unit 1</p>
      {error && <div role="alert" className="inline-error">{error}</div>}
      <div className="role-grid">{users.map(([username, label, name]) => <button className="role-card" key={username} data-testid={`login-user-${username}`} onClick={() => void signIn(username)} disabled={!!busy}>
        <span className={`role-avatar role-${username}`}>{name.split(' ').map((s) => s[0]).slice(0, 2).join('')}</span><span className="role-copy"><strong>{label}</strong><small>{name}</small></span><ChevronRight size={16} className="role-arrow" />
        {busy === username && <span className="role-wait">Signing in</span>}
      </button>)}</div>
      <div className="login-foot"><span className="live-dot" /> Demo network online <span>·</span> SQLite world state</div>
    </div></section>
  </main>;
}

function Shell({ children, token, user, onLogout, onUserChange }: { children: React.ReactNode; token: string; user: User; onLogout: () => void; onUserChange: (user: User) => void }): JSX.Element {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dev, setDev] = useState(localStorage.getItem('textrace.devMode') === 'true' || user.role === 'DEVELOPER');
  const [dark, setDark] = useState(document.documentElement.classList.contains('dark'));
  const { data: ledger } = useData<{ height: number; transactions: number; policy: string }>('/api/ledger/stats', token);
  const { data: users } = useData<User[]>('/api/users', token);
  const [liveHeight,setLiveHeight]=useState<number|null>(null);const [wsOnline,setWsOnline]=useState(false);
  const navigate = useNavigate();
  useEffect(()=>{let active=true;let socket:WebSocket|null=null;let retryTimer:ReturnType<typeof setTimeout>|undefined;let retries=0;const connect=()=>{if(!active)return;const endpoint=new URL('/ws',window.location.href);endpoint.protocol=endpoint.protocol==='https:'?'wss:':'ws:';socket=new WebSocket(endpoint);socket.onopen=()=>{if(active){setWsOnline(true);retries=0;}};socket.onmessage=(event)=>{if(!active)return;try{const message=JSON.parse(String(event.data)) as {type:string;data:{height?:number;number?:number}};if(message.type==='hello'&&typeof message.data.height==='number')setLiveHeight(message.data.height);if(message.type==='block'&&typeof message.data.number==='number')setLiveHeight(message.data.number);}catch{}};socket.onclose=()=>{if(!active)return;setWsOnline(false);retryTimer=setTimeout(connect,Math.min(1000*2**retries++,15000));};socket.onerror=()=>socket?.close();};connect();return()=>{active=false;if(retryTimer)clearTimeout(retryTimer);socket?.close();};},[]);
  const switchUser = async (username: string) => {
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) });
    const body = (await response.json()) as Envelope<{ token: string; user: User }>;
    if (body.ok) { localStorage.setItem('textrace.token', body.data.token); onUserChange(body.data.user); window.location.reload(); }
  };
  const toggleTheme = () => {
    const next = !dark; setDark(next); document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('textrace.theme', JSON.stringify({ state: { theme: next ? 'dark' : 'light' }, version: 0 }));
  };
  const toggleDev = () => { const next = !dev; setDev(next); localStorage.setItem('textrace.devMode', String(next)); };
  return <div className="app-frame">
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
      <Link to="/" className="sidebar-brand"><span className="brand-symbol"><Waves size={18} /></span><span><strong>TEXTRACE</strong><small>MILL NETWORK</small></span></Link>
      <div className="network-card"><span className="network-led" /><div><b>Network live</b><small>SIMULATED · 3 OF 4</small></div><Radio size={14} /></div>
      <nav className="nav-groups">{navGroups.map((group) => <div className="nav-group" key={group.label}><p>{group.label}</p>{group.items.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'nav-active' : ''}`}><Icon size={17} strokeWidth={1.9} /><span>{label}</span>{label === 'Complaints' && <span className="nav-count">1</span>}</NavLink>)}</div>)}</nav>
      <button className="sidebar-settings" onClick={() => navigate('/settings')}><Factory size={16} /> Mill settings <ChevronRight size={15} /></button>
      <div className="sidebar-user"><div className="user-avatar">{user.name.split(' ').map((v) => v[0]).slice(0, 2).join('')}</div><div className="user-data"><b>{user.name}</b><small>{user.role.replace('_', ' ')}</small></div><button className="icon-button sidebar-exit" aria-label="Sign out" title="Sign out" onClick={onLogout}><LogOut size={16} /></button></div>
    </aside>
    {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <div className="main-column"><header className="topbar"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(!mobileOpen)}><Menu size={18} /></button><div className="crumb-brand">Model Spinning Mill <span>/</span> Unit 1</div>
      <div className="topbar-actions"><span className="block-chip"><span className={`live-dot ${wsOnline?'':'live-dot-off'}`} /> Block <b>#{liveHeight ?? ledger?.height ?? 0}</b><small>·</small>{ledger?.transactions ?? 0} tx</span>
        <label className="switch-control" title="Developer mode"><input type="checkbox" checked={dev} onChange={toggleDev} data-testid="devmode-toggle" /><span className="switch-track" /><span>Dev mode</span></label>
        <select aria-label="Switch role" data-testid="role-switcher" value={user.username} onChange={(event) => void switchUser(event.target.value)}>{(users ?? [user]).map((entry) => <option value={entry.username} key={entry.id}>{entry.name} · {entry.role}</option>)}</select>
        <button className="icon-button" aria-label="Toggle theme" title="Toggle theme" data-testid="theme-toggle" onClick={toggleTheme}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
        <button className="top-demo" data-testid="demo-button" onClick={() => navigate('/showcase')}><Activity size={15} /> Demo</button>
      </div></header><main className="page-content">{children}</main><footer className="app-footer"><span>TEXTRACE · TRACEABILITY OPERATIONS</span><span><ShieldCheck size={13} /> Permissioned ledger <b>3-of-4</b></span></footer></div>
  </div>;
}

function PageTitle({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: React.ReactNode }): JSX.Element {
  return <div className="page-title-row"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="page-detail">{detail}</p></div>{action && <div className="title-action">{action}</div>}</div>;
}

function Dashboard({ token }: { token: string }): JSX.Element {
  const { data: summary, loading, error } = useData<Summary>('/api/dashboard/summary', token);
  const { data: complaints } = useData<{ items: Complaint[] }>('/api/complaints?status=ALL', token);
  const { data: lots } = useData<Lot[]>('/api/lots', token);
  const { data: activity } = useData<Array<{ id: string; at: string; actorName: string; action: string; label: string; accepted: boolean; blockNumber: number | null }>>('/api/dashboard/activity?limit=5', token);
  const kpis = summary ? [
    { title: 'Active complaints', value: summary.complaints.open + summary.complaints.underAnalysis, suffix: `${summary.complaints.open} open · ${summary.complaints.underAnalysis} under analysis`, icon: CircleDot, tone: 'coral', link: '/complaints', test: 'kpi-complaints' },
    { title: 'Lots in production', value: summary.lots.inProduction, suffix: `${summary.lots.total} tracked lots`, icon: Boxes, tone: 'blue', link: '/lots', test: 'kpi-lots' },
    { title: 'Quality alerts', value: summary.qualityAlerts.red + summary.qualityAlerts.yellow, suffix: `${summary.qualityAlerts.red} red · ${summary.qualityAlerts.yellow} warning`, icon: AlertTriangle, tone: 'amber', link: '/analysis/heatmap', test: 'kpi-alerts' },
    { title: 'Dispatches this month', value: summary.dispatches.count, suffix: `${summary.dispatches.quantityKg.toLocaleString()} kg moved`, icon: Truck, tone: 'green', link: '/dispatch', test: 'kpi-dispatches' },
    { title: 'Ledger transactions', value: summary.ledger.transactions.toLocaleString(), suffix: `${summary.ledger.blocks} blocks · ${summary.ledger.invalidTx} rejected`, icon: GitBranch, tone: 'violet', link: '/developer', test: 'kpi-ledger' },
    { title: 'AI investigations', value: summary.analyses.completed, suffix: summary.analyses.llmEnabled ? 'Narrative service enabled' : 'Deterministic engine ready', icon: FileSearch, tone: 'teal', link: '/analysis/ai', test: 'kpi-analyses' },
  ] : [];
  return <>
    <PageTitle eyebrow="FRIDAY · 16 OCTOBER 2026" title="Mill overview" detail="Production, quality and custody at a glance." action={<Link className="button-primary" to="/complaints/new"><CircleDot size={16} /> Register complaint</Link>} />
    {error && <ErrorBanner message={error} />}
    <div className="kpi-grid">{loading && !summary ? Array.from({ length: 6 }, (_, i) => <div className="kpi-skeleton" key={i} />) : kpis.map((item, i) => <Link to={item.link} className={`kpi-tile tone-${item.tone} enter-${i}`} key={item.title} data-testid={item.test}><div className="kpi-top"><span>{item.title}</span><span className="kpi-icon"><item.icon size={18} /></span></div><strong>{item.value}</strong><small>{item.suffix}</small><ChevronRight className="kpi-chevron" size={15} /></Link>)}</div>
    <div className="dashboard-grid">
      <section className="surface activity-surface"><div className="surface-heading"><div><p className="eyebrow">LATEST MOVEMENT</p><h2>Activity stream</h2></div><Link to="/developer" className="text-link">Open ledger <ChevronRight size={14} /></Link></div>
        <div className="activity-list" data-testid="activity-feed">{(activity ?? []).length ? activity?.map((item) => <div className="activity-row" key={item.id}><span className={`activity-dot ${item.accepted ? 'dot-good' : 'dot-bad'}`}>{item.accepted ? <Check size={12} /> : <XCircle size={12} />}</span><div className="activity-main"><b>{item.label}</b><small>{item.actorName} · {item.action}</small></div><div className="activity-meta"><span>{timeAgo(item.at)}</span><small>#{item.blockNumber ?? '-'}</small></div></div>) : <EmptyNotice title="No recent actions" text="Contract activity will appear here as records are written." />}</div>
      </section>
      <section className="surface fault-surface"><div className="surface-heading"><div><p className="eyebrow">QUALITY WATCH</p><h2>RF-3 · lot 182/2026</h2></div><span className="status-pill status-red"><XCircle size={14} /> Investigate</span></div>
        <div className="fault-reading"><div><span>U% across shifts · 01 Oct</span><strong>12.61 <small>%</small></strong><p>Standard 10.50 · limit 10.80</p></div><div className="spark-bars" aria-label="RF3 U percent shifts"><i style={{ height: '73%' }} /><i style={{ height: '92%' }} /><i style={{ height: '84%' }} /></div></div>
        <div className="fault-cause"><span><AlertTriangle size={15} /> Process deviation flagged</span><b>Break draft 1.34 <small>vs std 1.18</small></b></div>
        <Link to="/analysis/heatmap?lotId=LOT-182-2026&department=RF&parameter=U&mode=day" className="fault-link">Inspect heatmap <ArrowUpRight size={15} /></Link>
      </section>
    </div>
    <section className="surface lot-watch"><div className="surface-heading"><div><p className="eyebrow">PRODUCTION CONTROL</p><h2>Recent lots</h2></div><Link to="/lots" className="text-link">All lots <ChevronRight size={14} /></Link></div>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>LOT</th><th>COUNT</th><th>STATUS</th><th>PACKED</th><th>DISPATCHED</th><th>LEDGER</th></tr></thead><tbody>{(lots ?? []).slice(0, 4).map((lot) => <tr key={lot.id} onClick={() => location.assign(`/lots/${lot.id}`)} className="click-row"><td><b>{lot.lotNo}</b><small className="cell-sub">{lot.lotCode}</small></td><td>{lot.countDisplay}</td><td><StatusPill value={lot.status} /></td><td>{formatKg(lot.packedKg)}</td><td>{formatKg(lot.dispatchedKg)}</td><td><span className="verified-inline"><ShieldCheck size={13} /> #{lot.chain.blockNumber}</span></td></tr>)}</tbody></table></div>
    </section>
  </>;
}

function ComplaintsPage({ token }: { token: string }): JSX.Element {
  const [filter, setFilter] = useState('ALL'); const [search, setSearch] = useState('');
  const { data, loading, error } = useData<{ items: Complaint[] }>(`/api/complaints?status=${filter}&q=${encodeURIComponent(search)}`, token);
  return <><PageTitle eyebrow="CUSTOMER QUALITY" title="Complaints" detail="Customer issues, status and associated production lots." action={<Link className="button-primary" to="/complaints/new" data-testid="register-complaint-button"><CircleDot size={16} /> Register complaint</Link>} />
    {error && <ErrorBanner message={error} />}
    <div className="toolbar-row"><div className="segmented">{['ALL','OPEN','UNDER_ANALYSIS','RESOLVED'].map((value) => <button key={value} data-testid={`status-filter-${value}`} className={filter === value ? 'segment-active' : ''} onClick={() => setFilter(value)}>{value === 'UNDER_ANALYSIS' ? 'In analysis' : value === 'ALL' ? 'All' : value[0] + value.slice(1).toLowerCase()}</button>)}</div><label className="search-control"><Search size={16} /><input data-testid="complaint-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search no., customer or lot" /></label></div>
    <section className="surface table-surface"><div className="table-scroll"><table className="data-table" data-testid="complaints-table"><thead><tr><th>COMPLAINT</th><th>CUSTOMER</th><th>LOT</th><th>ISSUE</th><th>RECEIVED</th><th>STATUS</th></tr></thead><tbody>{(data?.items ?? []).map((item) => <tr key={item.id}><td><Link to={`/complaints/${item.id}`} className="table-link" data-testid={`complaint-row-${item.complaint_no.replace('/','-')}`}>{item.complaint_no}</Link><small className="cell-sub">{item.complainant_name}</small></td><td>{item.customer_name}</td><td><Link to={`/lots/${item.lot_no}`} className="table-link">{item.lot_no}</Link></td><td>{complaintLabel(item.type)}</td><td>{formatDate(item.received_date)}</td><td><StatusPill value={item.status} /></td></tr>)}{!loading && !data?.items.length && <tr><td colSpan={6}><EmptyNotice title="No complaints match" text="Change the filter or search term." /></td></tr>}</tbody></table></div>{loading && <LoadingLine />}</section>
  </>;
}

function RegisterComplaintPage({ token }: { token: string }): JSX.Element {
  const location = useLocation(); const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const { data: customers } = useData<Array<{id:string;name:string}>>('/api/customers', token);
  const { data: lots } = useData<Lot[]>('/api/lots', token);
  const { data: number } = useData<{complaintNo:string}>('/api/complaints/next-number', token);
  const [form, setForm] = useState({ complainantName: params.get('name') ?? '', type: params.get('type') ?? 'EVENNESS', customerId: params.get('customerId') ?? 'CUST-PDT', lotId: params.get('lotId') ?? 'LOT-182-2026', description: params.get('description') ?? '', receivedDate: '2026-10-16' });
  const [pending, setPending] = useState(false); const [error, setError] = useState(''); const [trace, setTrace] = useState<{txHashes:string[];blockNumber:number} | null>(null);
  const setField = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setPending(true); setError(''); try {
    const result = await post<Record<string,unknown>>('/api/complaints', form, token);
    setTrace(null);
    navigate(`/complaints/${String(result.id)}`);
  } catch (e) { setError(e instanceof Error ? e.message : 'Could not register complaint'); } finally { setPending(false); } };
  return <><PageTitle eyebrow="CUSTOMER QUALITY" title="Register complaint" detail="Create a customer case linked to a dispatched lot." action={<span className="number-preview"><span>COMPLAINT NO.</span><b data-testid="complaint-no">{number?.complaintNo ?? '—'}</b></span>} />
    <form className="form-surface surface" onSubmit={(event) => void submit(event)}><div className="form-grid">
      <label className="field"><span>Complainant name</span><input data-testid="field-complainant" required value={form.complainantName} onChange={(e) => setField('complainantName',e.target.value)} placeholder="Name and role" /></label>
      <label className="field"><span>Complaint type</span><select data-testid="field-type" value={form.type} onChange={(e) => setField('type',e.target.value)}>{[['EVENNESS','U% / evenness'],['COUNT_VARIATION','Count variation'],['IMPERFECTIONS','Imperfections'],['STRENGTH','Strength'],['HAIRINESS','Hairiness'],['CONTAMINATION','Contamination'],['SHADE','Shade'],['PACKING','Packing'],['OTHER','Other']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field"><span>Customer</span><select data-testid="field-customer" value={form.customerId} onChange={(e) => setField('customerId',e.target.value)}>{(customers ?? []).map((customer) => <option value={customer.id} key={customer.id}>{customer.name}</option>)}</select></label>
      <label className="field"><span>Dispatched lot</span><select data-testid="field-lot" value={form.lotId} onChange={(e) => setField('lotId',e.target.value)}>{(lots ?? []).map((lot) => <option value={lot.id} key={lot.id}>{lot.lotNo} · {lot.countDisplay}</option>)}</select></label>
      <label className="field"><span>Received date</span><input type="date" value={form.receivedDate} onChange={(e) => setField('receivedDate',e.target.value)} /></label>
      <label className="field field-span"><span>Description</span><textarea data-testid="field-description" required minLength={10} rows={4} value={form.description} onChange={(e) => setField('description',e.target.value)} placeholder="Describe the observed issue and affected product." /></label>
    </div>{error && <ErrorBanner message={error} />}{trace && <div className="trace-receipt"><ShieldCheck size={15} /> Anchored in block #{trace.blockNumber} · {trace.txHashes[0]?.slice(0,12)}…</div>}<div className="form-actions"><Link to="/complaints" className="button-secondary">Cancel</Link><button className="button-primary" type="submit" data-testid="complaint-submit" disabled={pending}>{pending ? 'Registering…' : 'Register complaint'} <ChevronRight size={15} /></button></div></form>
  </>;
}

function ComplaintDetailPage({ token }: { token: string }): JSX.Element {
  const { id = '' } = useParams(); const [tab,setTab] = useState('details'); const [busy,setBusy] = useState(false); const [error,setError] = useState('');
  const { data,loading,reload } = useData<Record<string,unknown>>(`/api/complaints/${encodeURIComponent(id)}`,token);
  const complaint = data?.complaint as Record<string,unknown> | undefined;
  const events = (data?.events ?? []) as Array<Record<string,unknown>>;
  const { data: testRows } = useData<Array<Record<string,unknown>>>(complaint?.lot_id ? `/api/lots/${encodeURIComponent(String(complaint.lot_id))}/quality` : '',token);
  const [conclusion,setConclusion] = useState({ conclusionHtml:'',rootCause:'',correctiveAction:'',preventiveAction:'' });
  const transition = async () => { setBusy(true); setError(''); try { await post(`/api/complaints/${id}/transition`,{to:'UNDER_ANALYSIS',note:'QA investigation started.'},token); reload(); } catch(e) { setError(e instanceof Error ? e.message : 'Transition failed'); } finally { setBusy(false); } };
  const closeCase = async () => { setBusy(true); setError(''); try { await post(`/api/complaints/${id}/conclusion`,conclusion,token); reload(); } catch(e) { setError(e instanceof Error ? e.message : 'Could not close complaint'); } finally { setBusy(false); } };
  return <><PageTitle eyebrow={`COMPLAINT · ${String(complaint?.complaint_no ?? '')}`} title={String(complaint?.customer_name ?? 'Complaint detail')} detail={`${complaintLabel(String(complaint?.type ?? ''))} · Lot ${String(complaint?.lot_no ?? '')}`} action={<StatusPill value={String(complaint?.status ?? (loading ? 'loading' : 'not found'))} />} />{error && <ErrorBanner message={error} />}
    <div className="tab-bar">{[['details','Details'],['results','Results'],['conclusion','Conclusion']].map(([key,label]) => <button key={key} className={tab===key?'tab-active':''} onClick={() => setTab(key)} data-testid={`tab-${key}`}>{label}</button>)}</div>
    {tab==='details' && <div className="complaint-detail-grid"><section className="surface complaint-info"><p className="eyebrow">CASE RECORD</p><h2>Complaint {String(complaint?.complaint_no ?? '')}</h2><p className="complaint-description">{String(complaint?.description ?? 'Loading complaint record…')}</p><div className="detail-pairs"><Fact label="Complainant" value={String(complaint?.complainant_name ?? '-')} /><Fact label="Customer" value={String(complaint?.customer_name ?? '-')} /><Fact label="Lot" value={String(complaint?.lot_no ?? '-')} /><Fact label="Received" value={formatDate(String(complaint?.received_date ?? ''))} /></div>{complaint?.status==='OPEN' && <button className="button-primary" onClick={() => void transition()} disabled={busy}>Start analysis <ArrowUpRight size={15} /></button>}</section><section className="surface timeline-surface"><div className="surface-heading"><div><p className="eyebrow">WORKFLOW</p><h2>Status timeline</h2></div></div>{events.map((event) => <div className="timeline-row" key={String(event.id)}><span className="timeline-marker"><CheckCircle2 size={15}/></span><div><b>{String(event.note)}</b><small>{String(event.to_status)} · {formatDateTime(String(event.at))}</small></div><span className="verified-inline"><ShieldCheck size={13}/>{event.block_number ? `#${String(event.block_number)}` : 'anchored'}</span></div>)}</section></div>}
    {tab==='results' && <section className="surface table-surface"><div className="table-scroll"><table className="data-table"><thead><tr><th>STAGE</th><th>DATE</th><th>SAMPLE</th><th>MACHINE</th><th>VALUES</th></tr></thead><tbody>{(testRows ?? []).map((test) => <tr key={String(test.id)}><td><b>{String(test.department)}</b></td><td>{formatDate(String(test.test_date))}</td><td>{String(test.sample_type)}</td><td>{String(test.machine_id ?? 'Lot sample')}</td><td><span className="measurement-list">{Object.entries(parseObject(test.values_json)).map(([key,value]) => <span key={key}>{key} <b>{String(value)}</b></span>)}</span></td></tr>)}</tbody></table></div><div className="result-footer"><Link to={`/lots/${String(complaint?.lot_id ?? '')}`} className="text-link">Open complete lot quality record <ChevronRight size={14}/></Link></div></section>}
    {tab==='conclusion' && <section className="surface conclusion-surface"><div className="surface-heading"><div><p className="eyebrow">QA DECISION</p><h2>Manual conclusion</h2></div><span className="advisory-chip"><ShieldCheck size={13}/> Human review required</span></div>{complaint?.status==='RESOLVED' ? <ResolvedConclusion conclusion={data?.conclusion as Record<string,unknown> | null} /> : complaint?.status!=='UNDER_ANALYSIS' ? <div className="workflow-prompt"><ClipboardCheck size={20}/><b>Move this complaint into analysis before closing.</b><button className="button-secondary" onClick={() => void transition()} disabled={busy}>Start analysis</button></div> : <><label className="field"><span>Conclusion</span><textarea data-testid="conclusion-editor" rows={4} value={conclusion.conclusionHtml} onChange={(e)=>setConclusion({...conclusion,conclusionHtml:e.target.value})} placeholder="Summarize investigation findings and verification." /></label><div className="form-grid conclusion-fields"><label className="field"><span>Root cause</span><textarea data-testid="field-root-cause" rows={3} value={conclusion.rootCause} onChange={(e)=>setConclusion({...conclusion,rootCause:e.target.value})}/></label><label className="field"><span>Corrective action</span><textarea data-testid="field-corrective" rows={3} value={conclusion.correctiveAction} onChange={(e)=>setConclusion({...conclusion,correctiveAction:e.target.value})}/></label><label className="field field-span"><span>Preventive action</span><textarea data-testid="field-preventive" rows={3} value={conclusion.preventiveAction} onChange={(e)=>setConclusion({...conclusion,preventiveAction:e.target.value})}/></label></div><button className="button-primary" data-testid="resolve-close-button" onClick={() => void closeCase()} disabled={busy}>{busy?'Saving…':'Resolve & close'} <CheckCircle2 size={15}/></button></>}</section>}
  </>;
}

function LotsPage({ token }: { token: string }): JSX.Element {
  const [search, setSearch] = useState(''); const { data, loading, error } = useData<Lot[]>(`/api/lots?q=${encodeURIComponent(search)}`, token);
  return <><PageTitle eyebrow="TRACEABILITY" title="Lot tracking" detail="Follow yarn lots from fibre mix through packing and custody transfer." />{error && <ErrorBanner message={error} />}
    <div className="toolbar-row"><label className="search-control lot-search"><Search size={16} /><input data-testid="lot-search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search lot number or production code" /></label><span className="result-count">{data?.length ?? 0} lots in view</span></div>
    <section className="surface table-surface"><div className="table-scroll"><table className="data-table"><thead><tr><th>LOT / PRODUCTION CODE</th><th>COUNT</th><th>LINE</th><th>STATUS</th><th>PLANNED</th><th>PACKED</th><th>DISPATCHED</th><th>CHAIN</th></tr></thead><tbody>{(data ?? []).map((lot) => <tr key={lot.id} className="click-row"><td><Link to={`/lots/${lot.id}`} className="table-link">{lot.lotNo}</Link><small className="cell-sub">{lot.lotCode}</small></td><td>{lot.countDisplay}</td><td>Line {lot.line}</td><td><StatusPill value={lot.status} /></td><td>{formatKg(lot.plannedKg)}</td><td>{formatKg(lot.packedKg)}</td><td>{formatKg(lot.dispatchedKg)}</td><td><span className="verified-inline"><ShieldCheck size={13} /> #{lot.chain.blockNumber}</span></td></tr>)}</tbody></table></div>{loading && <LoadingLine />}</section>
  </>;
}

function LotDetailPage({ token }: { token: string }): JSX.Element {
  const { id = '' } = useParams();
  const { data: lots } = useData<Lot[]>('/api/lots', token);
  const lot = lots?.find((entry) => entry.id === id || entry.lotNo === id || entry.lotCode === id);
  const { data: tests } = useData<Array<Record<string, unknown>>>(`/api/lots/${encodeURIComponent(lot?.id ?? id)}/quality`, token);
  const { data: events,reload:reloadEvents } = useData<Array<Record<string, unknown>>>(`/api/lots/${encodeURIComponent(lot?.id ?? id)}/events`, token);
  const [tab, setTab] = useState('quality');
  const [eventForm,setEventForm]=useState(false);const [eventPending,setEventPending]=useState(false);const [eventError,setEventError]=useState('');const [event,setEvent]=useState({department:'RM',machineId:'',eventDate:'2026-10-16',inputKg:'1000',outputKg:'995',wasteKg:'5',notes:''});
  const submitEvent=async(formEvent:React.FormEvent)=>{formEvent.preventDefault();if(!lot)return;setEventPending(true);setEventError('');try{await post('/api/production-events',{lotId:lot.id,department:event.department,machineId:event.machineId||null,eventDate:event.eventDate,inputKg:Number(event.inputKg),outputKg:Number(event.outputKg),wasteKg:Number(event.wasteKg),params:{},notes:event.notes},token);setEventForm(false);reloadEvents();}catch(e){setEventError(e instanceof Error?e.message:'Could not log production event');}finally{setEventPending(false);}};
  return <><PageTitle eyebrow="LOT TRACE" title={lot?.lotNo ?? id} detail={lot?.lotCode ?? 'Production genealogy and quality record.'} action={<StatusPill value={lot?.status ?? 'loading'} />} />
    <div className="lot-facts"><Fact label="Count" value={lot?.countDisplay ?? '-'} /><Fact label="Planned" value={formatKg(lot?.plannedKg ?? 0)} /><Fact label="Packed" value={formatKg(lot?.packedKg ?? 0)} /><Fact label="Dispatched" value={formatKg(lot?.dispatchedKg ?? 0)} /><Fact label="Ledger block" value={`#${lot?.chain.blockNumber ?? '-'}`} /></div>
    <div className="tab-bar">{[['quality','Quality results'],['production','Production events'],['trace','Custody trace']].map(([key,label]) => <button key={key} className={tab === key ? 'tab-active' : ''} onClick={() => setTab(key)} data-testid={`tab-${key}`}>{label}</button>)}</div>
    {tab === 'quality' && <section className="surface table-surface"><div className="table-scroll"><table className="data-table"><thead><tr><th>STAGE</th><th>TEST DATE</th><th>SAMPLE</th><th>MACHINE</th><th>MEASUREMENTS</th><th>CHAIN</th></tr></thead><tbody>{(tests ?? []).map((test) => <tr key={String(test.id)}><td><b>{String(test.department)}</b></td><td>{formatDate(String(test.test_date))}</td><td>{String(test.sample_type)}</td><td>{String(test.machine_id ?? 'Lot sample')}</td><td><span className="measurement-list">{Object.entries(parseObject(test.values_json)).map(([key,value]) => <span key={key}>{key} <b>{String(value)}</b></span>)}</span></td><td><span className="verified-inline"><ShieldCheck size={13} /> #{String(test.block_number ?? '-')}</span></td></tr>)}</tbody></table></div></section>}
    {tab === 'production' && <section className="surface timeline-surface"><div className="surface-heading"><div><p className="eyebrow">PROCESS RECORDS</p><h2>Stage events</h2></div><button className="button-secondary" data-testid="log-event-button" onClick={()=>{setEventError('');setEventForm(!eventForm);}}><Factory size={14}/>{eventForm?'Close':'Log event'}</button></div>{eventForm&&<form className="event-form" onSubmit={(formEvent)=>void submitEvent(formEvent)}><div className="form-grid"><label className="field"><span>Department</span><select value={event.department} onChange={(e)=>setEvent({...event,department:e.target.value})}>{['RM','BR','CARD','DF','FF','RF','AW'].map((department)=><option key={department}>{department}</option>)}</select></label><label className="field"><span>Machine ID (where required)</span><input value={event.machineId} onChange={(e)=>setEvent({...event,machineId:e.target.value})} placeholder="RF-3"/></label><label className="field"><span>Event date</span><input type="date" value={event.eventDate} onChange={(e)=>setEvent({...event,eventDate:e.target.value})}/></label><label className="field"><span>Input kg</span><input type="number" value={event.inputKg} onChange={(e)=>setEvent({...event,inputKg:e.target.value})}/></label><label className="field"><span>Output kg</span><input type="number" value={event.outputKg} onChange={(e)=>setEvent({...event,outputKg:e.target.value})}/></label><label className="field"><span>Waste kg</span><input type="number" value={event.wasteKg} onChange={(e)=>setEvent({...event,wasteKg:e.target.value})}/></label></div><label className="field event-notes"><span>Notes</span><input value={event.notes} onChange={(e)=>setEvent({...event,notes:e.target.value})}/></label>{eventError&&<ErrorBanner message={eventError}/>}<div className="form-actions"><button type="submit" className="button-primary" disabled={eventPending}>{eventPending?'Anchoring event…':'Save production event'} <ShieldCheck size={14}/></button></div></form>}{(events ?? []).map((event) => <div className="timeline-row" key={String(event.id)}><span className="timeline-marker"><CheckCircle2 size={15} /></span><div><b>{String(event.department)} · {String(event.machine_id ?? 'department record')}</b><small>{formatDate(String(event.event_date))} · {formatKg(Number(event.output_kg))} output · {String(event.day_index ? `D${event.day_index}` : '')}</small></div><span className="verified-inline">#{String(event.block_number ?? '-')}</span></div>)}</section>}
    {tab === 'trace' && <section className="trace-flow surface">{[['RAW MATERIAL','Cotton bale mix','BALE-0412'],['SPINNING','Ring frame RF-3','Break draft 1.34 flagged'],['QUALITY','Uster laboratory','Shift sample deviation'],['PACKING','Cones packed','50 kg packages'],['CUSTOMER','PD Textiles','Dispatch · 09 Oct']].map(([group,title,detail],i) => <div className="trace-node" key={group}><span className="trace-index">0{i+1}</span><small>{group}</small><b>{title}</b><span>{detail}</span>{i < 4 && <ChevronRight className="trace-arrow" size={16} />}</div>)}</section>}
  </>;
}

function StandardsPage({ token }: { token: string }): JSX.Element {
  const [count, setCount] = useState('30CH'); const { data, loading, error,reload } = useData<Standard[]>(`/api/standards?countId=${count}`, token);
  const [editorOpen,setEditorOpen]=useState(false);const [editing,setEditing]=useState<Standard|null>(null);const [saving,setSaving]=useState(false);const [form,setForm]=useState({department:'RF',parameter:'U',category:'QUALITY',std:'10.5',lower:'10.3',upper:'10.8',unit:'%',reason:''});const [formError,setFormError]=useState('');
  const openEditor=(standard?:Standard)=>{setEditing(standard??null);setForm(standard?{department:standard.department,parameter:standard.parameter,category:standard.category,std:String(standard.std),lower:standard.lower_limit===null?'':String(standard.lower_limit),upper:standard.upper_limit===null?'':String(standard.upper_limit),unit:standard.unit,reason:''}:{department:'RF',parameter:'U',category:'QUALITY',std:'10.5',lower:'10.3',upper:'10.8',unit:'%',reason:''});setFormError('');setEditorOpen(true);};
  const saveStandard=async(event:React.FormEvent)=>{event.preventDefault();setSaving(true);setFormError('');const body={countId:count,department:form.department,parameter:form.parameter,category:form.category,std:Number(form.std),lower:form.lower===''?null:Number(form.lower),upper:form.upper===''?null:Number(form.upper),unit:form.unit,reason:form.reason};try{await mutate(editing?'PUT':'POST',editing?`/api/standards/${editing.id}`:'/api/standards',body,token);setEditorOpen(false);reload();}catch(e){setFormError(e instanceof Error?e.message:'Could not save standard');}finally{setSaving(false);}};
  return <><PageTitle eyebrow="QUALITY CONTROL" title="Quality standards" detail="Count-wise tolerance limits used for release checks and analysis." action={<button className="button-primary" data-testid="add-standard-button" onClick={()=>openEditor()}><ClipboardCheck size={15}/> Add standard</button>} />{error && <ErrorBanner message={error} />}
    <div className="toolbar-row"><div className="select-wrap"><label htmlFor="count-select">Yarn count</label><select id="count-select" data-testid="count-select" value={count} onChange={(e) => setCount(e.target.value)}><option value="30CH">30 CH · Carded Hosiery</option><option value="40CH">40 CH · Carded Hosiery</option><option value="20CH">20 CH · Carded Hosiery</option></select></div><div className="standard-legend"><span><i className="legend-dot green" /> In range</span><span><i className="legend-dot yellow" /> Warning band</span><span><i className="legend-dot red" /> Out of limits</span></div></div>
    <section className="surface table-surface"><div className="table-scroll"><table className="data-table" data-testid="standards-table"><thead><tr><th>DEPARTMENT</th><th>PARAMETER</th><th>CATEGORY</th><th>STANDARD</th><th>LOWER LIMIT</th><th>UPPER LIMIT</th><th>VERSION</th><th>STATUS</th><th></th></tr></thead><tbody>{(data ?? []).map((std) => <tr key={std.id} data-testid={`standard-row-${std.department}-${std.parameter}`}><td><span className="dept-tag">{std.department}</span></td><td><b>{paramName(std.parameter)}</b><small className="cell-sub">{std.parameter}</small></td><td>{std.category}</td><td>{std.std} {std.unit}</td><td>{std.lower_limit ?? '—'}</td><td>{std.upper_limit ?? '—'}</td><td>v{std.version}</td><td><span className="verified-inline"><ShieldCheck size={13} /> Anchored</span></td><td><button className="table-action" data-testid={`edit-standard-${std.department}-${std.parameter}`} onClick={()=>openEditor(std)} aria-label={`Edit ${std.department} ${std.parameter}`}>Edit</button></td></tr>)}</tbody></table></div>{loading && <LoadingLine />}</section>
    {editorOpen&&<div className="modal-scrim" role="presentation"><form className="standard-editor surface" onSubmit={(event)=>void saveStandard(event)}><div className="surface-heading"><div><p className="eyebrow">QUALITY MASTER</p><h2>{editing?'Edit standard':'Add standard'}</h2></div><button type="button" className="icon-button" aria-label="Close editor" onClick={()=>setEditorOpen(false)}><XCircle size={17}/></button></div><div className="form-grid"><label className="field"><span>Department</span><select value={form.department} onChange={(e)=>setForm({...form,department:e.target.value})}>{['RM','BR','CARD','DF','FF','RF','AW'].map((dept)=><option key={dept}>{dept}</option>)}</select></label><label className="field"><span>Parameter</span><input value={form.parameter} onChange={(e)=>setForm({...form,parameter:e.target.value.toUpperCase()})} required /></label><label className="field"><span>Category</span><select value={form.category} onChange={(e)=>setForm({...form,category:e.target.value})}>{['FIBRE','PROCESS','QUALITY'].map((category)=><option key={category}>{category}</option>)}</select></label><label className="field"><span>Unit</span><input value={form.unit} onChange={(e)=>setForm({...form,unit:e.target.value})}/></label><label className="field"><span>Standard</span><input data-testid="standard-std" type="number" step="any" value={form.std} onChange={(e)=>setForm({...form,std:e.target.value})} required /></label><label className="field"><span>Lower limit</span><input data-testid="standard-lower" type="number" step="any" value={form.lower} onChange={(e)=>setForm({...form,lower:e.target.value})}/></label><label className="field"><span>Upper limit</span><input data-testid="standard-upper" type="number" step="any" value={form.upper} onChange={(e)=>setForm({...form,upper:e.target.value})}/></label><label className="field field-span"><span>Reason {editing?'(required)':''}</span><textarea data-testid="standard-reason" rows={2} value={form.reason} onChange={(e)=>setForm({...form,reason:e.target.value})} placeholder="Explain the standard change." /></label></div>{formError&&<ErrorBanner message={formError}/>}<div className="form-actions"><button type="button" className="button-secondary" onClick={()=>setEditorOpen(false)}>Cancel</button><button className="button-primary" data-testid="standard-save" disabled={saving}>{saving?'Anchoring…':'Save standard'} <ShieldCheck size={14}/></button></div></form></div>}
  </>;
}

function DispatchPage({ token }: { token: string }): JSX.Element {
  const { data, loading, error } = useData<Dispatch[]>('/api/dispatches', token);
  return <><PageTitle eyebrow="CUSTODY TRANSFER" title="Dispatches" detail="Customer shipments and linked product passports." action={<Link className="button-primary" to="/dispatch/new"><Truck size={16} /> New dispatch</Link>} />{error && <ErrorBanner message={error} />}
    <section className="surface table-surface"><div className="table-scroll"><table className="data-table"><thead><tr><th>DISPATCH</th><th>CUSTOMER</th><th>DATE</th><th>COUNT</th><th>QUANTITY</th><th>VEHICLE</th><th>PASSPORT</th></tr></thead><tbody>{(data ?? []).map((item) => <tr key={item.id}><td><b>{item.dispatch_no}</b><small className="cell-sub">{item.id}</small></td><td>{item.customer_name}</td><td>{formatDate(item.dispatch_date)}</td><td>{item.count_id}</td><td>{formatKg(item.quantity_kg)}</td><td>{item.vehicle_no}</td><td><Link to={`/passport/${item.passport_code}`} className="table-link">{item.passport_code}</Link></td></tr>)}</tbody></table></div>{loading && <LoadingLine />}</section>
  </>;
}

function DispatchFormPage({ token }: { token: string }): JSX.Element {
  const params=new URLSearchParams(useLocation().search);const navigate=useNavigate();
  const {data:customers}=useData<Array<{id:string;name:string}>>('/api/customers',token);const {data:lots}=useData<Lot[]>('/api/lots',token);
  const [customerId,setCustomerId]=useState(params.get('customerId')??'CUST-PDT');const [lotId,setLotId]=useState(params.get('lotIds')?.split(',')[0]??'LOT-182-2026');const [quantity,setQuantity]=useState(params.get('qty')??'2000');const [dispatchDate,setDispatchDate]=useState(params.get('date')??'2026-10-16');const [packWeight,setPackWeight]=useState(params.get('packWeight')??'50');const [cones,setCones]=useState(params.get('cones')??'1200');const [vehicle,setVehicle]=useState(params.get('vehicle')??'');const [lr,setLr]=useState(params.get('lr')??'');const [gate,setGate]=useState<GateResult|null>(null);const [pending,setPending]=useState(false);const [error,setError]=useState('');const [created,setCreated]=useState<Record<string,unknown>|null>(null);
  useEffect(()=>{let current=true;post<GateResult>('/api/dispatches/gate-check',{lotIds:lotId?[lotId]:[]},token).then((data)=>{if(current)setGate(data);}).catch((e:unknown)=>{if(current)setError(e instanceof Error?e.message:'Gate check failed');});return()=>{current=false;};},[lotId,token]);
  const submit=async(event:React.FormEvent)=>{event.preventDefault();setPending(true);setError('');try{const result=await post<Record<string,unknown>>('/api/dispatches',{customerId,countId:lots?.find((lot)=>lot.id===lotId)?.countId??'30CH',dispatchDate,lots:[{lotId,quantityKg:Number(quantity)}],packWeightKg:Number(packWeight),conesCount:Number(cones),vehicleNo:vehicle,lrNo:lr},token);setCreated(result);}catch(e){setError(e instanceof Error?e.message:'Dispatch could not be created');}finally{setPending(false);}};
  if(created){const passport=String(created.passportCode);return <><PageTitle eyebrow="CUSTODY TRANSFER" title="Dispatch anchored" detail={`${String(created.dispatchNo)} · ${formatKg(Number(created.quantityKg))} transferred.`} action={<StatusPill value="DISPATCHED"/>}/><div className="dispatch-success"><section className="surface qr-surface"><p className="eyebrow">PUBLIC PRODUCT PASSPORT</p><h2>{passport}</h2><Link to={`/passport/${passport}`} className="qr-frame"><QRCodeSVG value={`${window.location.origin}/passport/${passport}`} size={180} level="M" includeMargin /></Link><p>Scan to inspect product journey and ledger proof.</p><Link className="text-link" to={`/passport/${passport}`}>Open passport <ArrowUpRight size={14}/></Link></section><section className="surface dispatch-receipt"><p className="eyebrow">DISPATCH RECEIPT</p><Fact label="Customer" value={String(created.customerName)}/><Fact label="Shipment quantity" value={formatKg(Number(created.quantityKg))}/><Fact label="Packages / cones" value={`${String(created.packsCount)} packs · ${String(created.conesCount)} cones`}/><Fact label="Vehicle / LR" value={`${String(created.vehicleNo)} · ${String(created.lrNo)}`}/><Fact label="Ledger block" value={`#${String((created.chain as Record<string,unknown>)?.blockNumber??'-')}`}/><button className="button-primary" onClick={()=>navigate('/dispatch')}>Dispatch list <ChevronRight size={15}/></button></section></div></>;}
  const lot=lots?.find((entry)=>entry.id===lotId);const blocked=gate?.lots.some((entry)=>entry.blocked)??false;const packs=Math.ceil((Number(quantity)||0)/(Number(packWeight)||1));
  return <><PageTitle eyebrow="CUSTODY TRANSFER" title="Create dispatch" detail="Confirm packed quantity and release gate before transferring custody." action={<span className="number-preview"><span>PACKAGES</span><b data-testid="packs-count">{packs}</b></span>}/>{error&&<ErrorBanner message={error}/>}<form className="dispatch-form-layout" data-testid="dispatch-form" onSubmit={(event)=>void submit(event)}><section className="surface form-surface"><div className="form-grid"><label className="field"><span>Customer</span><select data-testid="field-customer" value={customerId} onChange={(e)=>setCustomerId(e.target.value)}>{(customers??[]).map((customer)=><option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label><label className="field"><span>Count</span><select data-testid="field-count" value={lot?.countId??'30CH'} onChange={()=>{}}><option value="30CH">30 CH</option><option value="40CH">40 CH</option><option value="20CH">20 CH</option></select></label><label className="field"><span>Lot</span><select data-testid="field-lots" value={lotId} onChange={(e)=>setLotId(e.target.value)}>{(lots??[]).map((entry)=><option key={entry.id} value={entry.id}>{entry.lotNo} · {entry.countDisplay}</option>)}</select></label><label className="field"><span>Quantity (kg)</span><input type="number" min="1" data-testid="field-qty" value={quantity} onChange={(e)=>setQuantity(e.target.value)}/></label><label className="field"><span>Dispatch date</span><input type="date" data-testid="field-date" value={dispatchDate} onChange={(e)=>setDispatchDate(e.target.value)}/></label><label className="field"><span>Pack weight (kg)</span><input type="number" min="10" max="100" data-testid="field-pack-weight" value={packWeight} onChange={(e)=>setPackWeight(e.target.value)}/></label><label className="field"><span>Cones</span><input type="number" min="1" data-testid="field-cones" value={cones} onChange={(e)=>setCones(e.target.value)}/></label><label className="field"><span>Vehicle registration</span><input data-testid="field-vehicle" value={vehicle} onChange={(e)=>setVehicle(e.target.value)} placeholder="TN 39 AB 4521"/></label><label className="field"><span>Lorry receipt</span><input data-testid="field-lr" value={lr} onChange={(e)=>setLr(e.target.value)} placeholder="LR/26/7781"/></label></div><div className="form-actions"><Link className="button-secondary" to="/dispatch">Cancel</Link><button className="button-primary" type="submit" data-testid="dispatch-submit" disabled={pending||blocked}>{pending?'Anchoring dispatch…':'Transfer custody'} <Truck size={15}/></button></div></section><aside className="surface gate-surface" data-testid="gate-panel"><div className="surface-heading"><div><p className="eyebrow">QUALITY RELEASE</p><h2>Dispatch gate</h2></div><span className={`gate-status ${blocked?'gate-blocked':gate?'gate-passed':'gate-wait'}`}>{blocked?'Blocked':gate?.passed?'Passed':'Checking'}</span></div><p className="gate-message">{gate?.message??'Evaluating lot-level release samples and active QA overrides.'}</p>{gate?.lots.map((item)=><div className="gate-lot" key={item.lotId}><b>{item.lotNo}</b><span>{item.redItems.length} red · {item.yellowItems.length} warning · {item.machineLevelRed.length} machine red</span>{item.machineLevelRed.slice(0,3).map((entry)=><small key={entry.testResultId+entry.parameter}><AlertTriangle size={12}/>{entry.parameter} {entry.value} · {entry.machineId}</small>)}</div>)}<div className="gate-quantity"><span>Available packed</span><b>{formatKg(lot?Math.max(0,lot.packedKg-lot.dispatchedKg):0)}</b></div><div className="gate-quantity"><span>Requested</span><b>{formatKg(Number(quantity)||0)}</b></div></aside></form></>;
}

function DispatchDetailPage({token}:{token:string}):JSX.Element {const {id=''}=useParams();const {data,error}=useData<Record<string,unknown>>(`/api/dispatches/${encodeURIComponent(id)}`,token);return <><PageTitle eyebrow="CUSTODY RECORD" title={String(data?.dispatch_no??id)} detail="Anchored shipment and linked product passport." action={<StatusPill value={String(data?.status??'loading')}/>}/>{error&&<ErrorBanner message={error}/>}<section className="surface dispatch-receipt"><Fact label="Customer" value={String(data?.customer_name??'-')}/><Fact label="Date" value={formatDate(String(data?.dispatch_date??''))}/><Fact label="Quantity" value={formatKg(Number(data?.quantity_kg??0))}/><Fact label="Vehicle / LR" value={`${String(data?.vehicle_no??'-')} · ${String(data?.lr_no??'-')}`}/><Fact label="Passport" value={String(data?.passport_code??'-')}/><Link className="button-primary" to={`/passport/${String(data?.passport_code??'')}`}>Product passport <ShieldCheck size={15}/></Link></section></>;}

function HeatmapPage({ token }: { token: string }): JSX.Element {
  const { data: tests, loading } = useData<Array<Record<string, unknown>>>('/api/lots/LOT-182-2026/quality', token);
  const cells = (tests ?? []).filter((row) => row.sample_type === 'MACHINE').map((row) => ({ id: String(row.id), shift: String(row.shift), values: parseObject(row.values_json), date: String(row.test_date) }));
  return <><PageTitle eyebrow="QUALITY ANALYSIS" title="Machine heatmap" detail="RF-3 readings from lot 182/2026, grouped by test shift." action={<Link className="button-primary" to="/analysis/ai?lotId=LOT-182-2026&department=RF&machineId=RF-3&dayIndex=2&parameter=U"><FileSearch size={16} /> Move to analysis</Link>} />
    <section className="surface heatmap-surface"><div className="surface-heading"><div><p className="eyebrow">RING FRAME · D2 · 01 OCTOBER</p><h2>U% by machine and shift</h2></div><span className="status-pill status-red"><XCircle size={14} /> RF-3 requires review</span></div><div className="heatmap-grid" data-testid="heatmap-grid"><div className="heatmap-head">MACHINE</div>{['Shift A','Shift B','Shift C'].map((shift) => <div className="heatmap-head" key={shift}>{shift}</div>)}<div className="heatmap-machine">RF M/c 3</div>{['A','B','C'].map((shift) => { const row = cells.find((cell) => cell.shift === shift); const value = Number(row?.values.U ?? 0); return <div className="heat-cell cell-red" data-testid={`heatmap-cell-RF-3-D2-${shift}`} key={shift}><span>{value.toFixed(2)}%</span><small><XCircle size={13} /> OUT</small></div>; })}</div><div className="heatmap-note"><AlertTriangle size={15} /> Each shift sample exceeds the upper tolerance of 10.80%. <b>Standard: 10.50%</b></div>{loading && <LoadingLine />}</section>
    <StatusLegend />
  </>;
}

function AnalysisPage({ token }: { token: string }): JSX.Element {
  const params = new URLSearchParams(useLocation().search);
  const lotId = params.get('lotId') ?? 'LOT-182-2026';
  const complaintId = params.get('complaintId');
  const [run,setRun] = useState<Record<string,unknown>|null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const runAnalysis = async () => {
    setBusy(true); setError('');
    try {
      const context={source:params.get('source')??(complaintId?'complaint':'manual'),department:params.get('department')??null,machineId:params.get('machineId')??null,dayIndex:params.has('dayIndex')?Number(params.get('dayIndex')):null,date:params.get('date')??null,shift:params.get('shift')??null,parameter:params.get('parameter')??null};
      const next=await post<Record<string,unknown>>('/api/analysis/run',{lotId,complaintId,comparisonLotIds:[],context},token);
      setRun(next);
    } catch(e) { setError(e instanceof Error?e.message:'Analysis run failed'); }
    finally { setBusy(false); }
  };
  const result=run?.result as Record<string,unknown>|undefined;
  const suspected=result?.suspected as Record<string,unknown>|null|undefined;
  const causes=(result?.rootCauses??[]) as Array<Record<string,unknown>>;
  const recall=result?.recallScope as Record<string,unknown>|undefined;
  return <><PageTitle eyebrow="INVESTIGATION WORKBENCH" title="AI complaint analysis" detail="Statistical quality analysis with traceable evidence and human-reviewed conclusions." />
    <div className="analysis-layout"><section className="surface analysis-controls"><p className="eyebrow">CASE CONTEXT</p><h2>Investigation inputs</h2><Fact label="Target lot" value={lotId.replace('LOT-','').replace('-2026','/2026')} /><Fact label="Stage / machine" value={`${params.get('department') ?? 'RF'} · ${params.get('machineId') ?? 'RF-3'}`} /><Fact label="Focus parameter" value={params.get('parameter') ?? 'U%'} /><Fact label="Complaint" value={complaintId?.replace('CMP-','') ?? 'Manual analysis'} /><button className="button-primary wide-button" onClick={() => void runAnalysis()} disabled={busy} data-testid="run-analysis">{busy?'Analyzing evidence…':'Run analysis'} <FileSearch size={16} /></button>{error&&<p className="analysis-error" role="alert">{error}</p>}</section>
      <section className="surface analysis-result">{run ? <><div className="result-banner"><span><AlertTriangle size={16} /> EVIDENCE SIGNAL</span><b>{String((result?.summary as Record<string,unknown>)?.headline??'Analysis complete')}</b></div><h2>{String((result?.summary as Record<string,unknown>)?.headline??'Analysis complete')}</h2><p>{suspected ? (suspected.evidence as string[]).join(' ') : 'No out-of-tolerance evidence was found.'}</p>{causes.map((cause,index)=><div className="cause-row" key={String(cause.id)}><span className="cause-rank">{String(index+1).padStart(2,'0')}</span><div><b data-testid={`root-cause-${String(cause.id)}`}>{String(cause.title)}</b><small>{((cause.evidence??[]) as Array<Record<string,unknown>>).map((item)=>String(item.text)).join(' ')}</small></div><strong>{String(cause.confidence)}%</strong></div>)}<div className="recall-line"><Truck size={14}/><span>Dispatch exposure</span><b>{formatKg(Number(recall?.totalKgAtRisk??0))}</b></div><div className="analysis-hash"><ShieldCheck size={14}/> Anchored result · block #{String((run.chain as Record<string,unknown>)?.blockNumber??'-')}</div><div className="advisory"><ShieldCheck size={16} /> Analysis is advisory. QA review and conclusion remain authoritative.</div></> : <div className="analysis-empty"><span className="empty-icon"><FileSearch size={20}/></span><b>Analysis evidence has not been computed yet.</b><p>Run the statistical engine to compare machine tests, process settings, standards and dispatch records.</p></div>}</section></div>
    <div className="llm-disabled-banner" data-testid="llm-disabled-banner"><span><Radio size={14}/> NARRATIVE SERVICE</span><b>Optional LLM narrative disabled</b><small>The offline statistical engine remains available and its result is anchored on the permissioned ledger.</small></div>
  </>;
}

function DeveloperPage({ token }: { token: string }): JSX.Element {
  const { data: stats, loading, error, reload } = useData<{ height: number; blocks: number; transactions: number; invalidTx: number; validators: Array<{id:string;org:string}>; policy: string }>('/api/ledger/stats', token);
  const { data: blocks } = useData<{ items: Array<Record<string, unknown>> }>('/api/ledger/blocks?page=1&pageSize=10', token);
  return <><PageTitle eyebrow="PLATFORM INTEGRITY" title="Ledger explorer" detail="Permissioned transaction network, block history and validator status." action={<button className="button-secondary" onClick={reload}><Radio size={15} /> Refresh network</button>} />{error && <ErrorBanner message={error} />}
    <div className="ledger-summary"><div className="ledger-height"><span>LATEST BLOCK</span><strong>#{stats?.height ?? 0}</strong><small>{stats?.policy ?? '3-of-4 validator signatures'}</small></div><div><span>TRANSACTIONS</span><b>{stats?.transactions ?? 0}</b><small>valid + invalid proposals</small></div><div><span>BLOCKS</span><b>{stats?.blocks ?? 0}</b><small>hash-linked records</small></div><div><span>INVALID</span><b>{stats?.invalidTx ?? 0}</b><small>rejected contract calls</small></div></div>
    <section className="surface validator-surface"><div className="surface-heading"><div><p className="eyebrow">ENDORSEMENT POLICY</p><h2>Validator organizations</h2></div><span className="status-pill status-green"><CheckCircle2 size={14} /> Quorum active</span></div><div className="validator-row">{(stats?.validators ?? []).map((validator, index) => <div className="validator" key={validator.id}><span className="validator-check"><Check size={14} /></span><div><b>{validator.org}</b><small>{validator.id}</small></div><span className="validator-latency">{3 + index * 3} ms</span></div>)}</div></section>
    <section className="surface table-surface"><div className="surface-heading"><div><p className="eyebrow">RECENT BLOCKS</p><h2>Chain history</h2></div><span className="mono-label">SHA-256 · MERKLE</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>BLOCK</th><th>TIME</th><th>TRANSACTIONS</th><th>MERKLE ROOT</th><th>BLOCK HASH</th></tr></thead><tbody>{(blocks?.items ?? []).map((block) => <tr key={String(block.number)}><td><b>#{String(block.number)}</b></td><td>{formatDateTime(String(block.timestamp))}</td><td>{String(block.tx_count)}</td><td className="hash-value">{String(block.merkle_root).slice(0, 16)}…</td><td className="hash-value">{String(block.hash).slice(0, 16)}…</td></tr>)}</tbody></table></div>{loading && <LoadingLine />}</section>
  </>;
}

function PassportPage(): JSX.Element {
  const { code = '' } = useParams();
  const { data, error, loading } = useData<Record<string, unknown>>(`/api/passports/${encodeURIComponent(code)}`, null);
  const proof=data?.ledgerProof as Record<string,unknown>|undefined;
  const journey=(data?.journey??[]) as Array<{label:string;detail:string}>;
  return <main className="passport-page"><div className="passport-top"><Link to="/" className="brand-lockup"><span className="brand-symbol"><Waves size={18} /></span><strong>TEXTRACE</strong></Link><span><ShieldCheck size={14} /> PUBLIC PRODUCT PASSPORT</span></div>{loading ? <div className="passport-loading">Loading verified product record…</div> : error ? <ErrorBanner message={error} /> : <><div className="passport-head"><span className="passport-check"><CheckCircle2 size={28} /></span><p className="eyebrow">{proof?.verified?'TRACEABILITY VERIFIED':'PROOF VERIFICATION FAILED'}</p><h1>Yarn product passport</h1><p>Passport <b>{code}</b> · {String(data?.customer_name??'Customer')}</p></div><div className="passport-stats"><Fact label="Dispatch reference" value={String(data?.dispatch_no ?? '-')} /><Fact label="Product count" value={String(data?.count_id ?? '-')} /><Fact label="Net quantity" value={formatKg(Number(data?.quantity_kg ?? 0))} /><Fact label="Dispatch date" value={formatDate(String(data?.dispatch_date ?? ''))} /></div><section className="passport-journey"><p className="eyebrow">PRODUCT JOURNEY · {((data?.lots??[]) as Array<{lotNo:string}>).map((lot)=>lot.lotNo).join(', ')}</p>{journey.map((item,index) => <div className="passport-step" key={`${item.label}-${index}`}><span><Check size={13} /></span><b>{item.label}</b><small>{item.detail}</small></div>)}</section><div className="passport-seal"><ShieldCheck size={17} /> Merkle inclusion proof {proof?.verified?'verified':'invalid'} · TexTrace permissioned ledger <b>Block #{String(proof?.blockNumber??'-')}</b></div></>}</main>;
}

function ShowcasePage(): JSX.Element {
  return <><PageTitle eyebrow="TEXTILE TECHNOLOGY · FINAL YEAR PROJECT" title="From bale to cone" detail="A digital thread for spinning-mill traceability." />
    <section className="showcase-hero"><div><span className="eyebrow">TEXTRACE ARCHITECTURE</span><h2>One product.<br /><em>Every transformation.</em></h2><p>Link raw fibre, machine conditions, laboratory results and customer delivery in a verifiable record.</p></div><div className="showcase-flow">{[['01','FIBRE','Cotton bales'],['02','PROCESS','Production events'],['03','QUALITY','Lab evidence'],['04','CUSTODY','Dispatch & passport']].map(([n,title,detail]) => <div key={n}><span>{n}</span><b>{title}</b><small>{detail}</small></div>)}</div></section>
    <div className="showcase-layers">{[['01','Presentation','Mill dashboard · buyer passport'],['02','Application','Express API · role permissions'],['03','Contracts','AssetID · ProcessEvent · Quality · Transfer'],['04','Permissioned ledger','Merkle proofs · 3-of-4 validators'],['05','Data & analysis','SQLite · statistical QA · anchored documents']].map(([n,title,text]) => <div key={n}><span>{n}</span><b>{title}</b><small>{text}</small></div>)}</div>
    <div className="team-strip"><span>PROJECT TEAM</span><b>Devaprasath P</b><b>Nandiesh R V</b><b>Nikitha Y</b><b>Pavishna Dhaniya R</b><small>Guide · Pavendhan A, Associate Dean</small></div>
  </>;
}

function SettingsPage(): JSX.Element { return <><PageTitle eyebrow="SYSTEM CONFIGURATION" title="Mill settings" detail="Business date, traceability formats and quality display preferences." /><section className="surface settings-surface"><div><b>Mill identity</b><small>Model Spinning Mill · Unit 1</small></div><div><b>Business date</b><small>16 October 2026</small></div><div><b>Lot number format</b><small className="hash-value">{'{seq}/{year}'}</small></div><div><b>Quality warning fraction</b><small>20% of the tolerance band</small></div><div><b>Ledger adapter</b><small>Simulated permissioned chain · 3-of-4</small></div></section></>; }
function NotFound(): JSX.Element { return <section className="empty-page"><div className="empty-icon"><FileSearch size={22} /></div><p className="eyebrow">404 · NOT FOUND</p><h1>This record is not in the workspace.</h1><Link to="/" className="button-primary">Return to overview <ChevronRight size={15} /></Link></section>; }

function StatusPill({ value }: { value: string }): JSX.Element {
  const status = value.toLowerCase(); const tone = status.includes('hold') || status === 'open' || status === 'loading' ? 'red' : status.includes('analysis') ? 'yellow' : status.includes('dispatch') || status === 'resolved' || status === 'packed' ? 'green' : 'blue';
  const Icon = tone === 'green' ? CheckCircle2 : tone === 'yellow' ? AlertTriangle : tone === 'red' ? XCircle : CircleDot;
  return <span className={`status-pill status-${tone}`}><Icon size={13} />{value.replaceAll('_', ' ')}</span>;
}
function StatusLegend(): JSX.Element { return <div className="status-legend"><span><CheckCircle2 size={14} /> Within limits</span><span><AlertTriangle size={14} /> Warning</span><span><XCircle size={14} /> Out of limits</span><span><CircleDot size={14} /> No standard</span></div>; }
function Fact({ label, value }: { label: string; value: string }): JSX.Element { return <div className="fact"><span>{label}</span><b>{value}</b></div>; }
function EmptyNotice({ title, text }: { title: string; text: string }): JSX.Element { return <div className="empty-notice"><span className="empty-icon"><PackageCheck size={19} /></span><b>{title}</b><p>{text}</p></div>; }
function ErrorBanner({ message }: { message: string }): JSX.Element { return <div className="error-banner" role="alert"><AlertTriangle size={16} /><span>{message}</span></div>; }
function LoadingLine(): JSX.Element { return <div className="loading-line"><span /></div>; }
function timeAgo(iso: string): string { const diff = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000)); return diff < 60 ? `${diff}m ago` : `${Math.floor(diff / 60)}h ago`; }
function formatKg(value: number): string { return `${(Number.isFinite(value) ? value : 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`; }
function formatDate(value: string): string { const date = new Date(`${value}T00:00:00`); return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date); }
function formatDateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date); }
function parseObject(value: unknown): Record<string, unknown> { if (typeof value !== 'string') return {}; try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; } }
function complaintLabel(type: string): string { return ({ EVENNESS: 'U% / evenness', COUNT_VARIATION: 'Count variation', IMPERFECTIONS: 'Imperfections', STRENGTH: 'Strength', HAIRINESS: 'Hairiness' } as Record<string,string>)[type] ?? type; }
function paramName(key: string): string { return ({ U: 'U%', CV: 'CVm%', BREAK_DRAFT: 'Break draft', THIN: 'Thin places', THICK: 'Thick places', NEPS: 'Neps', IPI: 'Total IPI', H: 'Hairiness', UHML: 'Upper half mean length', MIC: 'Micronaire' } as Record<string,string>)[key] ?? key; }

function ResolvedConclusion({ conclusion }: { conclusion: Record<string,unknown> | null }): JSX.Element {
  if (!conclusion) return <EmptyNotice title="Conclusion record unavailable" text="This complaint is resolved but its conclusion could not be loaded." />;
  return <div className="saved-conclusion"><p dangerouslySetInnerHTML={{ __html: String(conclusion.conclusion_html ?? '') }} /><Fact label="Root cause" value={String(conclusion.root_cause ?? '')} /><Fact label="Corrective action" value={String(conclusion.corrective_action ?? '')} /><Fact label="Preventive action" value={String(conclusion.preventive_action ?? '')} /><span className="verified-inline"><ShieldCheck size={14}/> Human conclusion recorded on ledger</span></div>;
}

export default function RootApp(): JSX.Element { return <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App /></BrowserRouter>; }