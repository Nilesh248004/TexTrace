# TexTrace v2 — client guide (for page builders)

Stack: React 18 + react-router 6 + @tanstack/react-query + zustand + lucide-react + recharts + jspdf(-autotable). Plain CSS classes in `client/src/index.css` (design tokens, light/dark). No Tailwind utilities needed.

Servers are already running — **do not start your own**: API `http://localhost:4000` (tsx watch), web `http://localhost:5173` (vite, proxies `/api` and `/ws`). Server code lives in `server/` (read it, do not edit it; report a needed server change in your final message instead). Type-check with `npx tsc -p tsconfig.json --noEmit`.

## Data + types
* All response DTOs are in `shared/domain.ts` (`LotPassport`, `LotSummary`, `Judged`, `JourneyStage`, `OwnerDashboard`, `AnalysisResult`, `Heatmap`, `Alert`, `BackTrace`, `ForwardTrace`, …) and `shared/params.ts` (stages, parameters, masters, complaint types, `STAGE_INFO`, `PARAMS`, `paramDef`, `COMPLAINT_TYPE_LABEL`, …). `shared/types.ts` has ledger / `DevTrace` types. Import with `@shared/...`.
* Routers (what each endpoint returns): `server/api/lots.ts` (search, live, lots, passport, trace, bales, production, quality, accessories, packing, dispatches, owner dashboard, heatmap, write actions), `server/api/masters.ts`, `server/api/complaints.ts`, `server/api/portal.ts`, `server/api/dev.ts`. `server/app.ts` has login, meta and the public `/api/passports/:code`.
* **Everything is judged on the server.** A `Judged` value carries `value, std, lower, upper, color ('green'|'yellow'|'red'|'none'), text, versionNo, …` — render it with `<J j={judged} />`, never re-evaluate in the client.
* Global filters (top bar): `useUi()` has `count` (`'ALL'|'20S'|'30CH'|'40CH'|'40CP'`) and `judge` (`'asOf'|'latest'` master version). Endpoints that accept `count` / `mode` should receive them: `const { count, mode } = useGlobalParams(); useGet('/api/lots' + qstr({ count, mode }))`.
* Time: the mill runs on IST. Use `fmtDT / fmtDTShort / fmtD / fmtT / fmtDuration` from `lib/fmt` (never `toLocaleString`). Demo "now" is 28 Oct 2026 15:10 IST (`GET /api/meta` → `now`).

## Hooks (`client/src/lib/api.ts`)
```ts
const q = useGet<LotSummary[]>('/api/lots' + qstr({ count, mode }));   // react-query; q.data, q.isLoading, q.error
const m = useMut<BodyType, ResultType>('POST', '/api/complaints', 'Register complaint'); // path may be (body)=>string
const result = await m.mutateAsync(body);   // throws ApiError (message is user-friendly); the ledger trace bar appears automatically
await download('/api/masters/versions/MV-40CH-QUALITY-2/export', 'file.csv'); // authenticated download
```
After any write every query is invalidated, so lists refresh by themselves. A written action shows a "Committed on the ledger" card (block, tx, validators) — do not add your own toast for that.

## UI kit (`client/src/components/ui.tsx`)
`J` (judged cell), `ColorPill`, `Pill`, `Legend` (use `<Legend chain />` under tables), `ChainBadge chain={row.chain}` (put on every record row/card), `Card/CardHead/CardBody`, `PageHead`, `Kpi`, `Tabs`, `Seg`, `Modal`, `Drawer`, `Field`, `Notice`, `Loading q={query}` (skeleton / error wrapper), `Spinner`, `Skeleton`, `Fact`, `Swatch`, `Tip`, `Collapse`, `JsonBlock`, `Hash`, `StageStepper journey={…}` (lot journey), `StageIcon`, `KeyValues`, `COLOR_TEXT`. Layout classes: `page`, `row`, `row between`, `stack`, `grid g2|g3|g4|g5|g6|g-main`, `muted small tiny bold nowrap right`, `card`, `btn primary|danger|ok|ghost sm icon`, `input select textarea`, `pill green|yellow|red|gray|blue|chain`, `judged`, `heat` + `cell green|yellow|red|none`, `board/lane/lot-card`, `alert-row`, `notice`, `kv`, `tbl`.
`DataTable` (`components/DataTable.tsx`): `columns: Col<T>[]` (`key, header, value(row) → sortable/searchable/exported text, render(row), num, color(row) for PDF fills`), `rows`, `rowKey`, `filters` (select filters; options derived from rows), `exportName`, `title`, `onRowClick`, `legend`, `pageSize`, `rowTone`. It provides search, sort, pagination, CSV and PDF export.

## Rules (acceptance criteria of the product)
1. Every table: search, sort, filter by count/lot/machine/date where relevant, pagination, CSV + PDF export (use `DataTable`), colour-coded cells with `<Legend chain />`, on-chain badge on records.
2. Colour is never alone: `J`/`ColorPill` carry an icon + text; tooltips explain the master (std, limits, version). Dark mode must look right (use the CSS variables, never hard-coded colours except master colour swatches).
3. The demo data is fully populated — never render an empty state for the seeded scenarios, and never show "N/A" for a required field (show the real value or a dash only when the value truly does not exist).
4. Friendly language and plain-English tooltips (`Judged.plain`) wherever a customer might read it; staff screens can be denser.
5. Add `data-testid` to the primary controls of your pages (examples: `lot-search`, `run-analysis`, `complaint-conclude`, `master-approve`, `tab-quality`).
6. Pages must work at ≥ 900 px wide and degrade to one column on phones; print CSS exists (`no-print`, `print-only`) — printable pages are noted in the briefs.
7. Writes go through contracts and can be rejected (403/409/422). Always show the server's message in a `Notice tone="bad"`.
8. Do **not** edit shared files (`index.css`, `components/*`, `lib/*`, `App.tsx`, `server/*`, `shared/*`). If you need a small shared change (a CSS class, a helper), put it in your own file (or a `<style>`-free inline style) and mention it in your report. Create extra components in your own files (e.g. `client/src/components/passport/*`).
9. Verify in the browser: `npx tsx scripts/shot.ts --user qa --path /lots/LOT-101 --out /tmp/x.png [--full] [--click "text=Quality"] [--dark]` (prints console/page/network errors) and open the PNG. Fix everything it reports. Test writes only on lots other than 101 and leave the database otherwise alone (no reset).

## Demo facts
Counts: `20S`, `30CH`, `40CH`, `40CP`. Lots 101–140 (`/lots/LOT-101`). Lot 101: 40s CH, PD Textiles, dispatched 27 Oct, RF-6 problem. Users (username): `admin` (owner), `qa`, `operator`, `dispatch`, `cs`, `dev`, `auditor`; customers `pdt` `vkf` `slh` `kvw` `ggt`. Machines: `BR-1..2`, `CARD-1..12`, `DFB-1..2`, `DFF-1..3`, `COMB-1..2`, `FF-1..4`, `RF-1..10`, `AW-1..4`. Master versions: `MV-<count>-<TYPE>-<n>` (e.g. `MV-40CH-QUALITY-2`; `MV-30CH-PRODUCTION-2` is a draft; `MV-40CP-ACCESSORIES-2` is QA-approved).
