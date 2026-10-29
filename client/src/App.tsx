import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useSession } from './lib/store';
import { Shell } from './components/Shell';
import { Spinner, PageHead, Card, CardBody } from './components/ui';
import Login from './pages/Login';

const page = <T extends { default: React.ComponentType }>(f: () => Promise<T>) => lazy(f);
const Dashboard = page(() => import('./pages/Dashboard'));
const LiveBoard = page(() => import('./pages/LiveBoard'));
const Lots = page(() => import('./pages/Lots'));
const LotPassport = page(() => import('./pages/LotPassport'));
const Production = page(() => import('./pages/Production'));
const Quality = page(() => import('./pages/Quality'));
const Accessories = page(() => import('./pages/Accessories'));
const Dispatch = page(() => import('./pages/Dispatch'));
const DispatchNew = page(() => import('./pages/DispatchNew'));
const DispatchDetail = page(() => import('./pages/DispatchDetail'));
const Complaints = page(() => import('./pages/Complaints'));
const ComplaintNew = page(() => import('./pages/ComplaintNew'));
const ComplaintWorkspace = page(() => import('./pages/ComplaintWorkspace'));
const Masters = page(() => import('./pages/Masters'));
const MasterEditor = page(() => import('./pages/MasterEditor'));
const Analytics = page(() => import('./pages/Analytics'));
const Customers = page(() => import('./pages/Customers'));
const Developer = page(() => import('./pages/Developer'));
const PublicPassport = page(() => import('./pages/PublicPassport'));
const PortalShell = page(() => import('./portal/PortalShell'));
const PortalHome = page(() => import('./portal/PortalHome'));
const PortalOrders = page(() => import('./portal/PortalOrders'));
const PortalDispatches = page(() => import('./portal/PortalDispatches'));
const PortalLots = page(() => import('./portal/PortalLots'));
const PortalLot = page(() => import('./portal/PortalLot'));
const PortalReport = page(() => import('./portal/PortalReport'));
const PortalComplaints = page(() => import('./portal/PortalComplaints'));
const PortalComplaint = page(() => import('./portal/PortalComplaint'));

function NotFound(): JSX.Element { return <div className="page"><PageHead eyebrow="404" title="This page is not in the workspace" /><Card><CardBody>Use the sidebar or the search box to find a lot, bale, machine or customer.</CardBody></Card></div>; }

export default function App(): JSX.Element {
  const { token, user } = useSession();
  const loc = useLocation();
  return <Suspense fallback={<Spinner label="Opening workspace…" />}>
    <Routes>
      <Route path="/passport/:code" element={<PublicPassport />} />
      {!token || !user ? <Route path="*" element={<Login />} /> : user.role === 'BUYER' ? <>
        <Route path="/portal" element={<PortalShell />}>
          <Route index element={<PortalHome />} /><Route path="orders" element={<PortalOrders />} /><Route path="dispatches" element={<PortalDispatches />} /><Route path="lots" element={<PortalLots />} /><Route path="lots/:id" element={<PortalLot />} />
          <Route path="report" element={<PortalReport />} /><Route path="complaints" element={<PortalComplaints />} /><Route path="complaints/:id" element={<PortalComplaint />} />
        </Route>
        <Route path="*" element={<Navigate to="/portal" replace state={{ from: loc.pathname }} />} />
      </> : <>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} /><Route path="live" element={<LiveBoard />} /><Route path="lots" element={<Lots />} /><Route path="lots/:id" element={<LotPassport />} />
          <Route path="production" element={<Production />} /><Route path="quality" element={<Quality />} /><Route path="accessories" element={<Accessories />} />
          <Route path="dispatch" element={<Dispatch />} /><Route path="dispatch/new" element={<DispatchNew />} /><Route path="dispatch/:id" element={<DispatchDetail />} />
          <Route path="complaints" element={<Complaints />} /><Route path="complaints/new" element={<ComplaintNew />} /><Route path="complaints/:id" element={<ComplaintWorkspace />} />
          <Route path="masters" element={<Masters />} /><Route path="masters/:versionId" element={<MasterEditor />} /><Route path="analytics" element={<Analytics />} />
          <Route path="customers" element={<Customers />} /><Route path="developer" element={<Developer />} />
          <Route path="portal/*" element={<Navigate to="/" replace />} /><Route path="*" element={<NotFound />} />
        </Route>
      </>}
    </Routes>
  </Suspense>;
}
