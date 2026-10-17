# TexTrace — Frontend contract (internal, for implementers)

Read with `docs/SPEC.md` (§4 color logic, §12 developer view, §13 screens, §14 demo, §15 UI/UX) and `shared/api.ts`
(every endpoint + response type). React 18 + TS + Vite + Tailwind 3 + shadcn/ui (Radix) + Recharts 2 + Framer Motion 11 +
@tanstack/react-query 5 + zustand 5 + @xyflow/react 12 + sonner + cmdk + tiptap 2 + jspdf 4/jspdf-autotable 5 + qrcode.react.
**No new dependencies.** Icons: `lucide-react` (0.468).

## 1. Files & routes

```
client/index.html                     # <title>TexTrace</title>, Inter + JetBrains Mono (Google Fonts), #root
client/src/main.tsx                   # providers: QueryClientProvider, BrowserRouter, TooltipProvider, Toaster, ws start
client/src/App.tsx                    # routes below (React.lazy per page, Suspense -> PageSkeleton)
client/src/index.css                  # Tailwind layers + design tokens (§3)
```

| Route | Component file (default export) | Shell |
|---|---|---|
| `/login` | `pages/auth/LoginPage.tsx` | none |
| `/passport/:code` | `pages/passport/PassportPage.tsx` | none (public) |
| `/verify` | `pages/passport/VerifyPage.tsx` | none (public) |
| `/` | `pages/dashboard/DashboardPage.tsx` | AppShell |
| `/complaints` | `pages/complaints/ComplaintsListPage.tsx` | AppShell |
| `/complaints/new` | `pages/complaints/RegisterComplaintPage.tsx` | AppShell |
| `/complaints/:id` | `pages/complaints/ComplaintDetailPage.tsx` (`?tab=details\|results\|conclusion`) | AppShell |
| `/lots`, `/lots/:id` | `pages/lots/LotTrackingPage.tsx` (`?tab=production\|quality\|trace`) | AppShell |
| `/bales/:id` | `pages/lots/BaleTracePage.tsx` | AppShell |
| `/standards` | `pages/standards/StandardsPage.tsx` (`?countId=`) | AppShell |
| `/analysis/heatmap` | `pages/analysis/HeatmapPage.tsx` | AppShell |
| `/analysis/ai` | `pages/analysis/AiAnalysisPage.tsx` | AppShell |
| `/dispatch` | `pages/dispatch/DispatchListPage.tsx` | AppShell |
| `/dispatch/new` | `pages/dispatch/DispatchFormPage.tsx` | AppShell |
| `/dispatch/:id` | `pages/dispatch/DispatchDetailPage.tsx` | AppShell |
| `/developer` | `pages/developer/DeveloperConsolePage.tsx` (`?tab=live\|blocks\|contracts\|integrity\|api\|audit`) | AppShell |
| `/ledger/tx/:hash` | `pages/developer/TxDetailPage.tsx` | AppShell |
| `/ledger/block/:number` | `pages/developer/BlockDetailPage.tsx` | AppShell |
| `/showcase` | `pages/showcase/ShowcasePage.tsx` | AppShell |
| `/settings` | `pages/settings/SettingsPage.tsx` | AppShell |
| `*` | `pages/NotFoundPage.tsx` | AppShell |

AppShell routes require a session (redirect to `/login?next=`). Menu visibility via `canSee(role, menu)`
(shared/permissions.ts); a route the role can't see renders an "Access restricted" state (not a crash).

## 2. Infrastructure APIs (built in F0 — page code MUST use these, not ad-hoc fetch)

### `lib/api.ts`
```ts
export class ApiClientError extends Error { status: number; code: ApiError['code']; details?: unknown; trace?: DevTrace }
export interface WriteResult<T> { data: T; trace: DevTrace | null }
export async function request<T>(method: 'GET'|'POST'|'PUT'|'DELETE', path: string,
  opts?: { query?: Record<string, unknown>; body?: unknown; form?: FormData }): Promise<{ data: T; trace: DevTrace | null }>
// Adds Authorization: Bearer <token>; on 401 clears the session and redirects to /login (except for /api/auth/login).
// Non-ok envelope -> throws ApiClientError (with .trace when the server sent one).
```
### `lib/endpoints.ts` — one typed function per route in `shared/api.ts`
Reads return `Promise<T>`; writes return `Promise<WriteResult<T>>`. Names (all must exist):
```
auth.login(username) / auth.me() / users.list()
meta.get() / settings.update(patch) / notifications.list() / notifications.markRead(id)
dashboard.summary() / dashboard.activity(limit?) / dashboard.qualityTrend(q)
counts.list() / customers.list() / machines.list(department?) / bales.list(q?) / bales.forwardTrace(id) / bales.register(body)
complaints.list(q) / complaints.nextNumber() / complaints.register(body) / complaints.get(id)
complaints.transition(id, body) / complaints.conclude(id, body)
documents.upload(file: Blob, clientSha256, filename?) / documents.get(id) / documents.fileUrl(id) (adds ?token=)
lots.list(q?) / lots.search(q) / lots.get(id) / lots.register(body) / lots.production(id) / lots.events(id, dept?)
lots.quality(id) / lots.heatmap(id, q) / lots.trace(id)
productionEvents.create(body) / testResults.create(body) / testResults.get(id) / packing.create(body)
standards.list(countId?, includeInactive?) / standards.create(body) / standards.update(id, body) / standards.remove(id, reason) / standards.history(id)
analysis.status() / analysis.candidates(lotId) / analysis.run(body) / analysis.list(q) / analysis.get(id)
dispatches.list(q?) / dispatches.get(id) / dispatches.gateCheck(lotIds) / dispatches.create(body)
overrides.create(body) / overrides.list(lotId?) / passports.get(code)
ledger.stats() / ledger.blocks(page, pageSize) / ledger.block(n) / ledger.tx(hash) / ledger.entity(type, id) / ledger.validate()
dev.audit(q) / dev.auditEntry(actionId) / dev.auditExportUrl(format) / dev.contracts() / dev.invocations(q) / dev.routes()
dev.tamper(body) / dev.restore() / demo.reset(profile)
```
### `lib/queryKeys.ts` — first segment is the WS invalidation domain (`QueryDomain`)
```ts
export const qk = { meta: ['meta'], dashboard: { summary: ['dashboard','summary'], ... }, complaints: { list: (q) => ['complaints','list',q], detail: (id) => ['complaints','detail',id], next: ['complaints','next'] },
  lots: { list, search, detail, production, quality, heatmap, trace, events }, standards: { list: (countId) => ['standards','list',countId], history },
  dispatches: {...}, analysis: {...}, ledger: {...}, audit: {...}, notifications: ['notifications'], customers: ['customers'], bales: {...}, documents: {...} }
```
### `lib/ws.ts`
```ts
export function startWs(queryClient: QueryClient): void           // called once in main.tsx; auto-reconnect w/ backoff
export function onWsEvent<T extends WsEvent['type']>(type: T, cb: (data: Extract<WsEvent,{type:T}>['data']) => void): () => void
export function useWsEvent(type, cb): void                         // hook form
export function useWsStatus(): 'connecting'|'open'|'closed'
// 'invalidate' -> queryClient.invalidateQueries({ queryKey: [domain] }) for each domain ('*' = all)
// 'trace' -> useTraces.getState().add(trace) (dedupe by actionId); 'notification' -> invalidate notifications + toast (info/warning/critical styling)
```
### Stores (`stores/*.ts`, zustand + `persist` where noted — storage keys are fixed; scripts/shot.ts relies on them)
```ts
useSession  // persist 'textrace.session' -> { token: string|null; user: User|null; setSession(t,u); clear() }
useDevMode  // persist 'textrace.devMode' -> { enabled: boolean; toggle(); set(v: boolean) }  (default: false; set true on login as DEVELOPER)
useTheme    // persist 'textrace.theme'   -> { theme: 'light'|'dark'|'system'; setTheme(t) }  (applies .dark on <html>)
useTraces   // memory -> { traces: DevTrace[] (newest first, max 200); add(t); clear(); trayOpen: boolean; setTrayOpen(v); focusId: string|null; focus(actionId) }
```
### Hooks (`hooks/*.ts`)
```ts
useMeta(): UseQueryResult<MetaResponse>                              // staleTime 60s
useSettings(): Settings | undefined                                   // from meta
useStandards(countId?: string): UseQueryResult<Standard[]>            // active standards; key qk.standards.list(countId)
useEvaluator(countId?: string): { ready: boolean; evaluate(dept: string, param: string, value: number|null|undefined): Evaluation & { standard: Standard|null }; standardFor(dept, param): Standard|null }
   // uses shared/quality evaluate + buildStandardIndex + settings.warnFraction -> recolors instantly when standards change
useAction<V, T>(fn: (v: V) => Promise<WriteResult<T>>, opts?: { success?: string | ((data: T) => string); onSuccess?: (data: T, trace: DevTrace|null) => void; onError?: (e: ApiClientError) => void })
   : { run(v: V): Promise<T | undefined>; isPending: boolean; trace: DevTrace | null; error: ApiClientError | null; data: T | undefined; reset(): void }
   // success toast: "<message> · tx 0x1a2b3c4d5e… · block #1234" with action "View tx" (-> /ledger/tx/:hash) or, when Dev Mode is on, "Inspect" (opens Dev Tray focused on the trace)
   // error toast: trace.reason || error.message; ALWAYS stores the trace (accepted or rejected) in useTraces
useCan(fn: ContractFunction): { allowed: boolean; enabled: boolean; reason: string | null }
   // enabled = allowed || devMode  (Dev Mode lets you press the button to demonstrate an Access-contract denial)
useBusinessDate(): string    // settings.businessDate
```

## 3. Design system (F0) — tokens in `index.css`

shadcn/ui "new-york" look, neutral (zinc) base, `--radius: 0.6rem`, Inter for UI, JetBrains Mono for hashes/JSON.
Primary accent = blue `#2a78d6` (dark `#3987e5`). Additional tokens (HSL triplets like shadcn):

| Token | Light | Dark | Use |
|---|---|---|---|
| `--ok` | #0ca30c | #0ca30c | status good mark/icon |
| `--warn` | #fab219 | #fab219 | status warning mark/icon |
| `--bad` | #d03b3b | #d03b3b | status critical mark/icon |
| `--ok-soft` / `--warn-soft` / `--bad-soft` | light tints (≈ 8–14% of the hue on white) | dark tints (≈ 18–22% on #1a1a19) | cell/badge fills |
| `--ok-foreground` / `--warn-foreground` / `--bad-foreground` | #006300 / #7a4f00 / #a32121 | #5fd35f / #fcc65a / #f08a8a | text on soft fills |
| `--chain` / `--chain-soft` | violet #6250d6 / tint | #9085e9 / tint | on-chain badges, ledger accents |
| chart: `--chart-surface` `--chart-grid` `--chart-axis` `--chart-muted` | #fcfcfb #e1e0d9 #c3c2b7 #898781 | #1a1a19 #2c2c2a #383835 #898781 | Recharts chrome |
| `--series-1..7` | #2a78d6 #eb6834 #1baf7a #eda100 #e87ba4 #008300 #6250d6 | #3987e5 #d95926 #199e70 #c98500 #d55181 #008300 #9085e9 | categorical (fixed order) |

**Status is never color alone:** green ⇄ `CheckCircle2` + "Within limits", yellow ⇄ `AlertTriangle` + "Warning",
red ⇄ `XCircle` + "Out of limits", none ⇄ `MinusCircle` + "No standard". Complaint status: OPEN red `CircleDot` "Open",
UNDER_ANALYSIS yellow `Loader` "Under Analysis", RESOLVED green `CheckCircle2` "Resolved".
Text never wears the yellow status hue; use `*-foreground` tokens on soft fills.

**Charts (dataviz rules):** one y-axis only; 2px lines, round caps; markers r ≥ 4 with a 2px surface-colored ring;
area/band washes at ~10% opacity; gridlines solid 1px `--chart-grid` (never dashed); axis text `--chart-muted`,
tabular-nums on ticks; a single-series chart has no legend box (title names it) but the status legend is shown;
crosshair + tooltip (value first, label second); hit areas ≥ 24px; every chart has a "Table" toggle (table view twin);
refetch keeps the previous render (react-query `placeholderData: keepPreviousData`) — skeletons only on first load;
bars ≤ 24px thick with 4px rounded data ends; no dual axes; categorical colors in fixed order and bound to the entity.
Tolerance band on trend charts: green wash between the warning bounds, yellow washes in the warning zones, solid hairline
limit lines with direct labels ("Upper 10.80"), red points outside.

## 4. Shared components (F0) — props are the contract

`components/ui/*` — shadcn primitives: accordion, alert, alert-dialog, avatar, badge, button, card, checkbox, collapsible,
command, dialog, dropdown-menu, hover-card, input, label, popover, progress, radio-group, scroll-area, select, separator,
sheet, skeleton, switch, table, tabs, textarea, toggle, toggle-group, tooltip, sonner (Toaster).

`components/common/*`:
```tsx
<QualityCell value={number|null} parameter="U" evaluation={Evaluation & {standard}} compact? showIcon? className? />
   // td-friendly: soft fill + icon + value (formatParamValue); tooltip "U% 12.71 — Out of limits (above upper 10.80) · Std 10.50 · Limits 10.30–10.80"; sr-only label text
<QualityBadge color="green|yellow|red|none" label? size="sm|md" />        // icon + text label
<StatusLegend warnFraction={0.2} className? />                         // green/yellow/red/none with icons + one-line rule explanation
<ComplaintStatusBadge status={ComplaintStatus} />
<OnChainBadge chain={OnChainRef|null} compact? />                       // "Verified on-chain ✔ #1234" (chain token) | "Integrity mismatch ✖ #1234" (bad) | "Not anchored"; links /ledger/tx/:hash; tooltip with tx hash, record hash, version
<HashText value={string} chars?={10} copy? />                           // 0x1a2b3c… + copy button, mono
<TxLink hash /> <BlockLink number />
<DevPanel trace={DevTrace|null} title? defaultOpen? force? />            // renders only when Dev Mode ON (or force); collapsible sections per SPEC §12; data-testid="dev-panel"
<DevTray />                                                            // global right-side Sheet listing useTraces; focus support; data-testid="dev-tray"
<JsonView value={unknown} collapsed?={1} maxHeight? />                 // syntax-colored collapsible JSON
<DbDiffView changes={DbChange[]} />                                    // before/after with changed fields highlighted
<ExportButtons filename title columns={ExportColumn[]} rows={T[]} subtitle? />   // CSV + PDF buttons
   // ExportColumn<T> = { header: string; value: (row: T) => string | number | null; color?: (row: T) => QualityColor | null }
<DataTable<T> columns={DataColumn<T>[]} data={T[]} getRowId searchable? searchPlaceholder? pageSize?={10} onRowClick? toolbar? emptyText? loading? exportName? rowTestId?={(row)=>string} />
   // DataColumn<T> = { id: string; header: string; cell: (row: T) => ReactNode; sortValue?: (row: T) => string|number; align?: 'left'|'right'|'center'; className?: string; exportValue?: (row: T) => string|number|null; exportColor?: (row: T) => QualityColor|null }
   // sortable headers (aria-sort), keyboard accessible pagination, built-in ExportButtons when exportName set
<PageHeader title description? actions? breadcrumbs?={[{label, to?}]} />
<KpiTile label value sublabel? icon to? tone?="default|ok|warn|bad" testId? />   // clickable card -> module (Link)
<Timeline items={{ title; time?: string; description?: ReactNode; tone?: QualityColor; chain?: OnChainRef|null }[]} />
<LotSearch value? onSelect={(lot: LotListItem) => void} placeholder? autoFocus? testId? />  // cmdk combobox over endpoints.lots.search
<EmptyState icon? title description? action? /> <ErrorState error retry? /> <PageSkeleton /> <TableSkeleton rows cols />
<ConfirmDialog ... />  <KeyValue items={[{label, value}]} />  <SectionCard title description? actions? children />
<AccessRestricted />
```
`lib/export.ts`: `exportCsv(filename, columns, rows)`, `exportPdf({ filename, title, subtitle?, columns, rows, orientation? })`
(jspdf + autotable; colored cells via `COLOR_RGB`, value text suffixed with `COLOR_SYMBOL` e.g. `12.71 (OUT)`; header with
mill name + generated timestamp + "Verified on TexTrace ledger"). `lib/hash.ts`: `sha256Hex(blob: Blob): Promise<string>` (WebCrypto).
`lib/utils.ts`: `cn()`, `formatNumber`, re-export shared format helpers.

Layout (`components/layout/*`): `AppShell` (sidebar + top bar + `<Outlet/>` + `DevTray` + demo overlay mount point),
`Sidebar` (sections: Overview — Dashboard; Quality — Complaints, Lot Tracking, Quality Master, U% Analysis, AI Analysis;
Logistics — Dispatch, Verify Passport; Platform — Developer Console, Settings, Project Showcase; collapsible on < 1024px into a
Sheet; active item highlight; role-filtered), `TopBar` (mill name + "Permissioned ledger · block #N" live chip, Developer Mode
switch (`data-testid="devmode-toggle"`), role switcher dropdown listing seeded users with role labels (`role-switcher`; switching =
endpoints.auth.login(username) → new session; toast with tx), notifications popover (`notifications-button`, unread count),
theme toggle (`theme-toggle`), Demo button (`demo-button`, renders `<DemoLauncher/>` from `@/demo/DemoLauncher` — F0 creates a
minimal placeholder file that the demo engineer replaces), user avatar menu (sign out)).

## 5. Domain components shared across pages (owned by F1 engineers; props fixed here)

```tsx
// owned by Lots engineer — components/domain/LotQualityTable.tsx
<LotQualityTable lotId={string} countId={string} compact? showActions?={true} testIdPrefix?="quality" />
   // QUALITY tab table: rows AW, RF, FF, DF, CARD; configurable columns (settings.qualityColumns + column picker);
   // each cell <QualityCell>; Test date, Tested by, <OnChainBadge>; expand row -> machine tests; export CSV/PDF
// owned by Lots engineer — components/domain/GenealogyGraph.tsx
<GenealogyGraph graph={TraceGraph} height?={520} onNodeClick?={(node: TraceNode) => void} />
// owned by Heatmap engineer — components/domain/Heatmap.tsx
<Heatmap data={HeatmapData} countId={string} onCellClick?={(cell, machine, column) => void} highlight?={{ machineId, columnKey }} />
// owned by AI engineer — components/domain/analysis/AnalysisSummary.tsx (+ siblings)
<AnalysisSummary run={AnalysisRun} compact? />  // headline, suspected location, top causes w/ confidence bars, recall scope, actions
<AnalysisNarrativeBanner llm={LlmMeta} />      // "AI narrative disabled" banner when llm.status === 'disabled'
// owned by Complaints engineer — lib/pdfReport.ts
exportComplaintReport(detail: ComplaintDetail, opts: { quality?: LotQualityView; standards: Standard[]; warnFraction: number }): void
```

## 6. Test hooks (`data-testid`) — Playwright e2e + Demo Mode depend on these exact ids

- Login: `login-user-<username>` (cards/buttons for admin, dev, operator, qa, dispatch, cs, auditor, buyer).
- Top bar: `devmode-toggle`, `role-switcher`, `role-option-<username>`, `notifications-button`, `theme-toggle`, `demo-button`.
- Dashboard: `kpi-complaints`, `kpi-lots`, `kpi-alerts`, `kpi-dispatches`, `kpi-ledger`, `kpi-analyses`, `quality-trend-chart`, `activity-feed`.
- Complaints list: `complaints-table`, `complaint-row-<seq>-<year>` (e.g. `complaint-row-22-2026`), `status-filter-ALL|OPEN|UNDER_ANALYSIS|RESOLVED`, `register-complaint-button`, `complaint-search`.
- Register: `complaint-no`, `field-complainant`, `field-type`, `field-customer`, `field-lot`, `field-description`, `field-document` (file input), `document-hash`, `complaint-submit`.
- Detail: `tab-details`, `tab-results`, `tab-conclusion`, `complaint-status`, `pdf-viewer`, `status-timeline`, `conclusion-editor` (contenteditable), `field-root-cause`, `field-corrective`, `field-preventive`, `resolve-close-button`, `open-ai-analysis`, `export-report`.
- Lot tracking: `lot-search-input`, `tab-production`, `tab-quality`, `tab-trace`, `quality-table`, `quality-row-<DEPT>`, `production-stage-<DEPT>`, `genealogy-graph`, `trace-chain`, `log-event-button`, `enter-test-button`.
- Standards: `count-select`, `standards-table`, `standard-row-<DEPT>-<PARAM>`, `edit-standard-<DEPT>-<PARAM>`, `standard-std`, `standard-lower`, `standard-upper`, `standard-reason`, `standard-save`, `add-standard-button`.
- Heatmap: `heatmap-lot-select`, `heatmap-dept-select`, `param-toggle-<PARAM>`, `mode-toggle-day`, `mode-toggle-shift`, `heatmap-grid`, `heatmap-cell-<machineId>-<columnKey>` (e.g. `heatmap-cell-RF-3-D2`), `move-to-analysis`.
- AI: `comparison-lot-list`, `comparison-lot-<lotId>`, `run-analysis`, `analysis-result`, `suspected-location`, `root-cause-<id>`, `recall-scope`, `llm-disabled-banner`, `analysis-version-select`, `conclusion-panel`.
- Dispatch: `dispatch-form`, `field-customer`, `field-count`, `field-lots`, `field-qty`, `field-date`, `field-pack-weight`, `packs-count`, `field-cones`, `field-vehicle`, `field-lr`, `gate-panel`, `dispatch-submit`, `passport-qr`, `qa-override-button`.
- Developer: `dev-tab-live|blocks|contracts|integrity|api|audit`, `live-log`, `validate-chain`, `integrity-report`, `integrity-status`, `tamper-preset-hide-bad-result|change-dispatch-qty|edit-ledger-payload`, `restore-tamper`, `export-audit-json`, `export-audit-csv`.
- Global: `dev-panel`, `dev-tray`, `onchain-badge`.

## 7. URL prefill params (Demo Mode + e2e drive the real forms with these)

- `/dispatch/new?customerId=CUST-PDT&countId=30CH&lotIds=LOT-182-2026&qty=2000&date=2026-10-09&packWeight=50&cones=1200&vehicle=TN%2039%20AB%204521&lr=LR%2F26%2F7781`
- `/complaints/new?customerId=CUST-PDT&lotId=LOT-182-2026&type=EVENNESS&name=...&description=...`
- `/analysis/heatmap?lotId=LOT-182-2026&department=RF&parameter=U&mode=day`
- `/analysis/ai?lotId=LOT-182-2026&complaintId=CMP-22-2026&department=RF&machineId=RF-3&dayIndex=2&shift=&parameter=U&source=heatmap[&autorun=1]`
- `/complaints/:id?tab=conclusion`, `/lots/:id?tab=trace`, `/developer?tab=integrity`

## 8. Verifying your pages

Run your own servers (never 4000/5173): `API_PORT=41NN DB_FILE=/tmp/tt-41NN.db npx tsx server/index.ts` (seeds on first
start) and `API_PORT=41NN WEB_PORT=52NN npx vite` (proxy follows API_PORT). Then
`npx tsx scripts/shot.ts --base http://localhost:52NN --user qa --path /complaints --out /tmp/x.png [--dev] [--dark] [--full] [--click <css>] [--waitFor <css>]`
→ prints consoleErrors/pageErrors/failedRequests and saves a screenshot you can open with the Read tool to LOOK at it.
Fix every console error, React warning, failed request and visual defect on your pages. Kill your servers when done.
Typecheck: `npx tsc -p tsconfig.json --noEmit 2>&1 | grep client/src/<your paths>`.
