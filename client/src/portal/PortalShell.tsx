import { useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Boxes, ClipboardList, Home, ListChecks, LogOut, MessageSquareWarning, Moon, ShieldCheck, Sun, Truck, Waves } from 'lucide-react';
import { useGet } from '../lib/api';
import { useSession, useUi } from '../lib/store';
import { useMeta } from '../components/portal/ui';
import type { PortalSummary } from '../components/portal/types';

const NAV = [
  { to: '/portal', label: 'Home', icon: Home, end: true },
  { to: '/portal/orders', label: 'Orders', icon: ClipboardList },
  { to: '/portal/dispatches', label: 'Dispatches', icon: Truck },
  { to: '/portal/lots', label: 'My lots', icon: Boxes },
  { to: '/portal/report', label: 'Report a problem', icon: MessageSquareWarning },
  { to: '/portal/complaints', label: 'My complaints', icon: ListChecks, badge: true },
];

/** Customer portal frame: no sidebar — a friendly top bar with the TexTrace mark, the customer's name and simple navigation. */
export default function PortalShell(): JSX.Element {
  const { user, clear } = useSession(); const { theme, setTheme } = useUi();
  const nav = useNavigate(); const loc = useLocation();
  const summary = useGet<PortalSummary>('/api/portal/summary', { staleTime: 30_000 });
  const meta = useMeta();
  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); }, [theme]);
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  useEffect(() => { const t = document.title; document.title = 'TexTrace — Customer portal'; return () => { document.title = t; }; }, []);
  const c = summary.data?.customer;
  const openComplaints = (summary.data?.complaints.open ?? 0) + (summary.data?.complaints.inProgress ?? 0);

  return <div className="portal">
    <header className="pt-top no-print">
      <div className="pt-top-in">
        <div className="pt-brand"><span className="pt-mark"><Waves size={22} /></span><span style={{ minWidth: 0 }}><b>TEXTRACE</b><small data-testid="portal-customer">{c ? `${c.name} · ${c.city}` : user?.name ?? 'Customer portal'}</small></span></div>
        <div className="grow" />
        <button className="btn icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Light mode' : 'Dark mode'} data-testid="theme-toggle">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
        <button className="btn" onClick={() => { clear(); nav('/'); }} data-testid="portal-signout"><LogOut size={17} /> Sign out</button>
      </div>
      <nav className="pt-nav" aria-label="Customer portal">
        {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')} data-testid={`portal-nav-${n.to.split('/').pop() === 'portal' ? 'home' : n.to.split('/').pop()}`}><n.icon size={18} />{n.label}{n.badge && openComplaints ? <span className="n" title="Complaints still open">{openComplaints}</span> : null}</NavLink>)}
      </nav>
    </header>
    <main className="pt-main"><Outlet /></main>
    <footer className="pt-foot no-print"><ShieldCheck size={18} /><span>Every record you see here is written on {meta.data?.millName ?? 'the mill'}'s tamper-evident ledger, so it cannot be quietly changed afterwards. Questions? Reply to your usual contact at the mill.</span></footer>
  </div>;
}
