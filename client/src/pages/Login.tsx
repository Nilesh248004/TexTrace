import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, ShieldCheck, UserRound, Waves } from 'lucide-react';
import { request, useGet } from '../lib/api';
import { useSession } from '../lib/store';
import { Card, Notice, Spinner } from '../components/ui';

interface Demo { username: string; name: string; role: string; roleLabel: string; title: string; customerId: string | null }

export default function Login(): JSX.Element {
  const users = useGet<Demo[]>('/api/auth/demo-users', { enabled: true, retry: 0, refetchInterval: (q) => (q.state.status === 'error' ? 3000 : false) });
  const set = useSession((s) => s.set); const nav = useNavigate();
  const [err, setErr] = useState(''); const [busy, setBusy] = useState('');
  const login = async (u: string) => {
    setBusy(u); setErr('');
    try { const r = await request<{ token: string; user: never }>('POST', '/api/auth/login', { username: u }); set(r.data.token, r.data.user); nav((r.data.user as { role: string }).role === 'BUYER' ? '/portal' : '/'); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Sign-in failed'); } finally { setBusy(''); }
  };
  const staff = (users.data ?? []).filter((u) => u.role !== 'BUYER'); const customers = (users.data ?? []).filter((u) => u.role === 'BUYER');
  return <div className="login-wrap"><Card className="login-card">
    <div className="login-hero">
      <div className="brand" style={{ padding: 0 }}><span className="brand-mark"><Waves size={18} /></span><span><b>TEXTRACE</b><small>MILL-TO-CUSTOMER TRACEABILITY</small></span></div>
      <h1 style={{ fontSize: 28, lineHeight: 1.15, marginTop: 10 }}>When a customer says <em style={{ color: 'hsl(var(--sidebar-primary))' }}>“lot 101 has more hairiness”</em>, answer on one screen.</h1>
      <p>Every bale, mix, machine, test, accessory, packing and dispatch record is judged against the active master and anchored on a permissioned ledger — with an AI investigator that ranks the likely cause and the customers at risk.</p>
      <div className="row" style={{ gap: 8, marginTop: 'auto', fontSize: 12.5, color: 'hsl(var(--sidebar-muted-foreground))' }}><ShieldCheck size={15} /> Demo mill · 28 Oct 2026 · pick a persona to sign in</div>
    </div>
    <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {err ? <Notice tone="bad">{err}</Notice> : null}
      {users.isLoading ? <Spinner /> : null}
      {users.error ? <Notice tone="warn">The mill data is being prepared (first start only) — this screen refreshes by itself.</Notice> : null}
      <div className="stack tight"><div className="eyebrow row"><Building2 size={13} /> Mill staff</div>
        {staff.map((u) => <button key={u.username} className="persona" onClick={() => void login(u.username)} disabled={!!busy} data-testid={`login-user-${u.username}`}><span className="avatar" style={{ background: 'hsl(var(--primary-soft))', color: 'hsl(var(--primary))' }}>{u.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span><span><b>{u.name}</b><small>{u.title} · {u.roleLabel}</small></span></button>)}
      </div>
      <div className="stack tight"><div className="eyebrow row"><UserRound size={13} /> Customer portal (separate login)</div>
        {customers.map((u) => <button key={u.username} className="persona" onClick={() => void login(u.username)} disabled={!!busy} data-testid={`login-user-${u.username}`}><span className="avatar" style={{ background: 'hsl(var(--chain-soft))', color: 'hsl(var(--chain-foreground))' }}>{u.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span><span><b>{u.name}</b><small>{u.title}</small></span></button>)}
      </div>
    </div>
  </Card></div>;
}
