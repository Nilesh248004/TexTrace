import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Building2, Check, Search, ShieldCheck, Sparkles, UserRound, Waves } from 'lucide-react';
import { request, useGet } from '../lib/api';
import { useSession } from '../lib/store';
import { Notice, Spinner } from '../components/ui';
import { fmtD } from '../lib/fmt';

interface Demo { username: string; name: string; role: string; roleLabel: string; title: string; customerId: string | null }
type Tab = 'all' | 'staff' | 'customers';

const TABS: { id: Tab; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'staff', label: 'Mill staff' }, { id: 'customers', label: 'Customers' }];
/** Everything the sign-in screen says about the mill comes from the database (GET /api/auth/demo-context). */
interface DemoContext {
  millName: string; businessDate: string;
  lot: null | { id: string; lotNo: string; countDisplay: string; quote: string; deviation: string | null; steps: { key: string; label: string; state: 'done' | 'warn' | 'todo' }[] };
}

const initials = (name: string) => name.split(' ').map((p) => p[0]).slice(0, 2).join('');
/** Customer logins carry "Role, Company" in the title; staff carry the role in the title and the permission group as the tag. */
function describe(u: Demo): { role: string; tag: string } {
  if (u.role !== 'BUYER') return { role: u.title, tag: u.roleLabel };
  const i = u.title.indexOf(',');
  return i < 0 ? { role: u.title, tag: u.roleLabel } : { role: u.title.slice(0, i).trim(), tag: u.title.slice(i + 1).trim() };
}

function Persona({ u, kind, selected, disabled, onPick, onGo }: { u: Demo; kind: 'staff' | 'customer'; selected: boolean; disabled: boolean; onPick: () => void; onGo: () => void }): JSX.Element {
  const d = describe(u);
  return <button type="button" className={`persona ${kind}${selected ? ' selected' : ''}`} aria-pressed={selected} disabled={disabled} onClick={onPick} onDoubleClick={onGo} data-testid={`login-user-${u.username}`}>
    <span className="avatar" aria-hidden="true">{initials(u.name)}</span>
    <span className="persona-text"><b>{u.name}</b><small>{d.role}</small><em className="tag" title={d.tag}>{d.tag}</em></span>
    <span className="persona-check" aria-hidden="true"><Check size={11} strokeWidth={3.2} /></span>
  </button>;
}

export default function Login(): JSX.Element {
  const users = useGet<Demo[]>('/api/auth/demo-users', { enabled: true, retry: 0, refetchInterval: (q) => (q.state.status === 'error' ? 3000 : false) });
  const health = useGet<{ ledger: { blocks: number } }>('/api/health', { enabled: true, retry: 0 });
  const ctx = useGet<DemoContext>('/api/auth/demo-context', { enabled: true, retry: 0 });
  const lot = ctx.data?.lot ?? null;
  const set = useSession((s) => s.set); const nav = useNavigate();
  const [err, setErr] = useState(''); const [busy, setBusy] = useState('');
  const [picked, setPicked] = useState(''); const [query, setQuery] = useState(''); const [tab, setTab] = useState<Tab>('all');
  const login = async (u: string) => {
    setBusy(u); setErr('');
    try { const r = await request<{ token: string; user: never }>('POST', '/api/auth/login', { username: u }); set(r.data.token, r.data.user); nav((r.data.user as { role: string }).role === 'BUYER' ? '/portal' : '/'); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Sign-in failed'); } finally { setBusy(''); }
  };
  const everyone = users.data ?? [];
  const q = query.trim().toLowerCase();
  const matches = (u: Demo) => !q || [u.name, u.title, u.roleLabel].some((s) => s.toLowerCase().includes(q));
  const staff = everyone.filter((u) => u.role !== 'BUYER' && matches(u)); const customers = everyone.filter((u) => u.role === 'BUYER' && matches(u));
  const chosen = everyone.find((u) => u.username === picked);
  const chosenInfo = chosen ? describe(chosen) : null;
  const online = !!health.data;
  const list = (items: Demo[], kind: 'staff' | 'customer') => items.map((u) => <Persona key={u.username} u={u} kind={kind} selected={picked === u.username} disabled={!!busy} onPick={() => setPicked(u.username)} onGo={() => void login(u.username)} />);
  return <div className="login-wrap">
    <aside className="login-hero">
      <div className="login-top">
        <div className="brand" style={{ padding: 0 }}><span className="brand-mark"><Waves size={18} /></span><span><b>TEXTRACE</b><small>MILL-TO-CUSTOMER TRACEABILITY</small></span></div>
        <span className={`login-status${online ? ' on' : ''}`} role="status"><i />{online ? 'Ledger online' : health.error ? 'Ledger unreachable' : 'Connecting…'}</span>
      </div>
      <div className="login-pitch">
        <h1 className="login-title">{lot ? <>When a customer says <em>“{lot.quote}”</em>, answer on one screen.</> : <>When a customer reports a problem with a lot, answer on one screen.</>}</h1>
        <p>Every bale, mix, machine, test, accessory, packing and dispatch record is judged against the active master and anchored on a permissioned ledger — with an AI investigator that ranks the likely cause and the customers at risk.</p>
        {lot ? <div className="trace" aria-label={`Trace chain for lot ${lot.lotNo}${lot.deviation ? `: a deviation was found at ${lot.deviation.toLowerCase()}` : ': every step is within its master'}`}>
          <div className="trace-head"><span><code>LOT {lot.lotNo}</code> Trace chain</span>{lot.deviation ? <span className="trace-flag">Deviation found</span> : <span className="trace-flag ok">Within master</span>}</div>
          <ol className="trace-steps">{lot.steps.map((s) => <li key={s.key} className={s.state}><span className="node">{s.state === 'done' ? <Check size={12} strokeWidth={3} /> : s.state === 'warn' ? '!' : <i />}</span>{s.label}</li>)}</ol>
          <div className="trace-ai"><Sparkles size={13} /> AI investigator ranks the likely cause and the customers at risk.</div>
        </div> : null}
      </div>
      <div className="login-foot"><ShieldCheck size={15} /> {ctx.data ? `${ctx.data.millName} · ${fmtD(`${ctx.data.businessDate}T06:00:00+05:30`)}` : 'Demo mill'} · pick a persona to sign in</div>
    </aside>

    <main className="login-panel">
      <div className="login-body">
        <header>
          <span className="login-kicker">Sign in</span>
          <h2 className="login-heading">Who’s signing in today?</h2>
          <p className="login-sub">Mill staff enter the traceability workspace. Customers use a separate portal login.</p>
        </header>
        {err ? <Notice tone="bad">{err}</Notice> : null}
        {users.isLoading ? <Spinner /> : null}
        {users.error ? <Notice tone="warn">The mill data is being prepared (first start only) — this screen refreshes by itself.</Notice> : null}
        <div className="login-tools">
          <label className="login-search"><Search size={15} aria-hidden="true" /><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, role or company" aria-label="Search personas" /></label>
          <div className="login-tabs" role="group" aria-label="Filter personas">{TABS.map((t) => <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>)}</div>
        </div>
        <div className="login-lists">
          {tab !== 'customers' && staff.length ? <section className="login-section staff"><div className="section-head"><span className="sq"><Building2 size={14} /></span><b>Mill staff</b><span className="count">{staff.length}</span></div><div className="persona-grid">{list(staff, 'staff')}</div></section> : null}
          {tab !== 'staff' && customers.length ? <section className="login-section customers"><div className="section-head"><span className="sq"><UserRound size={14} /></span><b>Customer portal</b><span className="count">{customers.length}</span><span className="note">Separate login</span></div><div className="persona-grid">{list(customers, 'customer')}</div></section> : null}
          {users.data && !(tab !== 'customers' && staff.length) && !(tab !== 'staff' && customers.length) ? <p className="login-empty">No persona matches “{query.trim()}”. Try a name, a role or a company.</p> : null}
        </div>
      </div>
      <footer className="login-bar">
        <div className="bar-info">{chosen && chosenInfo
          ? <><span className={`avatar mini ${chosen.role === 'BUYER' ? 'customer' : 'staff'}`} aria-hidden="true">{initials(chosen.name)}</span><span><b>{chosen.name}</b><small>{chosenInfo.role} · {chosenInfo.tag}</small></span></>
          : <><i className="idle" aria-hidden="true" /><span>No persona selected</span></>}</div>
        <button type="button" className="login-go" disabled={!chosen || !!busy} onClick={() => chosen && void login(chosen.username)} data-testid="login-submit">
          {busy ? 'Signing in…' : chosen ? `Sign in as ${chosen.name}` : 'Select a persona'} <ArrowRight size={16} />
        </button>
      </footer>
    </main>
  </div>;
}
