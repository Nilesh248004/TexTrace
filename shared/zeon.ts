// What Zeon (the in-app assistant) is allowed to point people at, shared by the server (validates every suggestion) and the client.
// Navigation and form pre-fills are checked here, per role, so a suggestion can never send someone to a page their role cannot use.
import { canInvoke, type Role } from './permissions';
import { COMPLAINT_TYPES, type ComplaintType } from './params';

export interface ZeonPage { path: string; label: string; about: string; pattern: RegExp; roles?: Role[] }

/** Pages of the staff workspace. The Developer Console is limited to the roles the sidebar shows it to. */
export const STAFF_PAGES: ZeonPage[] = [
  { path: '/', label: 'Dashboard', about: 'Mill KPIs: yarn spun, realization, quality alerts, complaints, stock, dispatches, waste and efficiency by stage.', pattern: /^\/$/ },
  { path: '/live', label: 'Live Lot Location', about: 'Every lot and bale with its current stage, machine and time in stage.', pattern: /^\/live$/ },
  { path: '/lots', label: 'Lot Passport', about: 'Search every lot; open one for its full cotton-to-customer record.', pattern: /^\/lots$/ },
  { path: '/lots/<lot>', label: 'A lot passport', about: 'One lot: mix, bales, journey, quality, production, packing, dispatch and ledger proof.', pattern: /^\/lots\/[\w-]+$/ },
  { path: '/production', label: 'Production', about: 'Every stage run with IN/OUT, quantities, waste and machine settings. Log a production run here.', pattern: /^\/production$/ },
  { path: '/quality', label: 'Quality', about: 'Lab results by department and machine, judged against the active master. Record a test result here.', pattern: /^\/quality$/ },
  { path: '/accessories', label: 'Accessories & Packing', about: 'Traveller, cot and apron ages, packing records and the cone colour codes.', pattern: /^\/accessories$/ },
  { path: '/dispatch', label: 'Dispatch', about: 'All consignments with invoice, vehicle and QA release status.', pattern: /^\/dispatch$/ },
  { path: '/dispatch/new', label: 'New dispatch', about: 'Create a customer dispatch (needs QA release and a passed quality gate).', pattern: /^\/dispatch\/new$/ },
  { path: '/dispatch/<id>', label: 'A dispatch', about: 'One consignment with its lots, QR passport and quality gate.', pattern: /^\/dispatch\/[\w-]+$/ },
  { path: '/complaints', label: 'Complaints', about: 'All customer complaints and their status.', pattern: /^\/complaints$/ },
  { path: '/complaints/new', label: 'Register a complaint', about: 'Register a customer complaint against a sold lot.', pattern: /^\/complaints\/new$/ },
  { path: '/complaints/<id>', label: 'A complaint', about: 'Investigation workspace: evidence, AI analysis and the QA conclusion.', pattern: /^\/complaints\/[\w-]+$/ },
  { path: '/masters', label: 'Masters', about: 'The versioned standards every result is judged against.', pattern: /^\/masters$/ },
  { path: '/analytics', label: 'Analytics', about: 'Machine-by-day heatmaps for ring-frame quality.', pattern: /^\/analytics$/ },
  { path: '/customers', label: 'Customers', about: 'Customer purchase history and complaint history.', pattern: /^\/customers$/ },
  { path: '/pdf-import', label: 'PDF Import', about: 'Upload historical records for extraction and review.', pattern: /^\/pdf-import$/ },
  { path: '/developer', label: 'Developer Console', about: 'Ledger proof, action log, chain validation and tamper checks.', pattern: /^\/developer$/, roles: ['ADMIN', 'DEVELOPER', 'AUDITOR'] },
];

/** Pages of the customer portal (the only area customer logins can reach). */
export const PORTAL_PAGES: ZeonPage[] = [
  { path: '/portal', label: 'Home', about: 'Your orders, shipments, lots and complaints at a glance.', pattern: /^\/portal$/ },
  { path: '/portal/orders', label: 'Orders', about: 'Your purchase orders and how much has been sent.', pattern: /^\/portal\/orders$/ },
  { path: '/portal/dispatches', label: 'Dispatches', about: 'Your shipments with vehicle, invoice and delivery status.', pattern: /^\/portal\/dispatches$/ },
  { path: '/portal/lots', label: 'My lots', about: 'The yarn lots you bought, each with its own passport.', pattern: /^\/portal\/lots$/ },
  { path: '/portal/lots/<lot>', label: 'A lot passport', about: 'What the mill measured for one of your lots.', pattern: /^\/portal\/lots\/[\w-]+$/ },
  { path: '/portal/report', label: 'Report a problem', about: 'Tell the mill about a problem with a lot.', pattern: /^\/portal\/report$/ },
  { path: '/portal/complaints', label: 'My complaints', about: 'Your reported problems and the mill’s replies.', pattern: /^\/portal\/complaints$/ },
  { path: '/portal/complaints/<id>', label: 'A complaint', about: 'The status and reply for one complaint.', pattern: /^\/portal\/complaints\/[\w-]+$/ },
];

export const pagesFor = (role: Role): ZeonPage[] => (role === 'BUYER' ? PORTAL_PAGES : STAFF_PAGES.filter((p) => !p.roles || p.roles.includes(role)));

/** Only app-internal paths, only pages this role can open. Query strings are allowed (they carry form pre-fills). */
export function canNavigate(role: Role, target: string): boolean {
  if (typeof target !== 'string' || target.length > 400 || !target.startsWith('/') || target.startsWith('//') || /[\s\\<>]/.test(target)) return false;
  const path = target.split(/[?#]/)[0];
  return pagesFor(role).some((p) => p.pattern.test(path));
}

export interface ComplaintFormValues { lot: string; type: ComplaintType; description: string }

/**
 * A link to the complaint form with its fields filled in. Returns null when the role may not register a complaint or the values are
 * not valid. Nothing is submitted: the person reviews the form and presses its own button.
 */
export function complaintFormPath(role: Role, v: { lot?: unknown; type?: unknown; description?: unknown }): { path: string; values: ComplaintFormValues } | null {
  if (!canInvoke(role, 'Quality.registerComplaint')) return null;
  const lot = String(v.lot ?? '').replace(/^lot[\s-]*/i, '').trim();
  const type = String(v.type ?? '').toUpperCase() as ComplaintType;
  const description = String(v.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!/^\d{1,6}$/.test(lot) || !(COMPLAINT_TYPES as readonly string[]).includes(type)) return null;
  const q = new URLSearchParams({ lot, type });
  if (description) q.set('desc', description);
  return { path: `${role === 'BUYER' ? '/portal/report' : '/complaints/new'}?${q.toString()}`, values: { lot, type, description } };
}

// ---- wire types
export interface ZeonMessage { role: 'user' | 'assistant'; content: string }
export type ZeonAction =
  | { type: 'navigate'; path: string; label: string }
  | { type: 'open_form'; form: 'complaint'; path: string; label: string; summary: string };
export interface ZeonContext { route: string; title?: string; lastError?: { label: string; reason: string; at: string } | null }
export interface ZeonChatRequest { messages: ZeonMessage[]; context: ZeonContext }
export interface ZeonChatResponse { reply: string; actions: ZeonAction[]; configured: boolean }
