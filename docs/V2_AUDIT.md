# TexTrace v2 — audit of v1 and gap list

Audit date: 28 Oct 2026 (demo "today"). Baseline: `tsc` clean, 8 unit tests passing.

## 1. What v1 has, and what is kept

| Area | v1 state | v2 decision |
|---|---|---|
| Simulated permissioned ledger (`server/ledger/*`) — hash-chained blocks, Merkle roots, 3-of-4 validator HMAC signatures, chain validation | Works, complete | **Kept unchanged** |
| Contract runtime (`server/contracts/runtime.ts`, `context.ts`) — one DB tx per action, permission matrix, tracked writes, DevTrace, audit log, INVALID-tx on rejection | Works | **Kept**; contract modules rewritten for the new domain, new `Master` contract added |
| DB driver (SQLite + Neon Postgres), entity registry with record hashes + `entity_anchors` | Works | **Kept**; registry extended with the v2 entities |
| Color logic `shared/quality.ts` (green / yellow = last 20 % of tolerance / red) | Works | **Kept**; every judged value now carries the master version it was judged against |
| Complaint workflow (OPEN → UNDER_ANALYSIS → RESOLVED, manual conclusion, ledger events) | Works | **Kept**, extended (issue types, customer reply, sign-off, attachments, repeat alerts) |
| AI analysis (`analysis/engine.ts`) | 83-line stub: one hard-coded `BREAK_DRAFT 1.18` rule, no comparison lots, no correlations | **Replaced** by a real deterministic engine; LLM narrative layer on top |
| Developer view | Block list only — no action log, no request/response/DB-diff, no validate-chain / tamper routes, no lot ledger trace | **Rebuilt** as Developer Console |

## 2. Gaps against the v2 spec

### Data model
- G1. Only 3 counts (20CH/30CH/40CH), no compact; **no mix recipe**, no process route per count.
- G2. 1 bale, no storage bay/bin, no received/issued timestamps; lots linked to bales directly (no **mix** entity, so no mix-level traceability).
- G3. Production events are date-only: no **IN/OUT timestamps**, no dwell time, no batch references (sliver → roving lots), no waste type, no efficiency / breaks / kWh.
- G4. Stages stop at `PACK`: no bale store, comber, drawing breaker/finisher split, finished-goods store, dispatch, delivered.
- G5. Quality standards exist for one count and 12 parameters; no frequency/instrument, no versions, no effective dates, no approval workflow. Production and accessory masters do not exist at all.
- G6. No accessories (traveller, cots, aprons, spacers), no change-interval master, no overdue warning.
- G7. Packing has no colour code, no cone/carton/tare/gross weights, no verification, no packing slip.
- G8. Dispatch lacks driver, transporter, destination, cartons, gross weight, delivery time, QA release, invoice date; no orders.
- G9. Seed: 3 lots, 7 tests, 1 dispatch, 1 complaint, 5 machines. Spec wants ~40 lots, ~120 bales, ~35 machines, every table filled.

### Screens / API
- G10. UI is 427 dense lines, 12 pages; dashboard contains hard-coded "RF-3 · lot 182/2026" text; lot list returns hard-coded status/colors; the lot detail page is a stub.
- G11. Missing: Live Lot Location, Lot Passport (3 tabs + print/PDF), Production, Quality, Accessories & Packing, Masters (grid editor, clone, import/export, completeness, versioning), Analytics, customer portal, owner dashboard (count cards, WIP, realization, heatmaps, alerts), forward/backward trace, universal search, global count selector, reusable table with search/sort/filter/pagination/CSV/PDF.
- G12. Complaint intake lacks issue types, attachments, complaint-type → parameter lens, investigation workspace, recall scope, repeat-complaint alert.
- G13. Customer portal: BUYER role exists but there are no customer-scoped endpoints and no friendly-language screens.

### Quality of v1 internals worth fixing along the way
- Lot status/colour in `/api/lots` is faked from the status string → replaced by real judgement against masters.
- `/api/analysis/candidates` hard-codes `'30 CH'` and `'RF'` → replaced.
- Business date frozen at 16 Oct 2026 → demo clock anchored at 28 Oct 2026 (see §3).

## 3. Design decisions for v2

1. **Everything is judged on the server** (`server/domain/judge.ts`). Each value returned to the UI carries `{value, std, lower, upper, color, label, deviation, versionNo}`; the UI only renders. A lot is judged against the master version whose `effective_from ≤ production date < effective_to`. A toggle re-judges against the latest active version ("what if").
2. **Masters** = versioned (`master_versions`) + items (`master_items`) for 5 types: `COUNT_MIX`, `QUALITY`, `PRODUCTION`, `ACCESSORIES`, `COLOR`. Workflow DRAFT → QA_APPROVED → ACTIVE (→ SUPERSEDED). All transitions and item edits are ledger transactions (`Master.*`).
3. **Journey** = `stage_runs` (one row per lot × stage × machine with `in_at` / `out_at`), including bale store, FG store, dispatch and delivered, so "where is it now" is a query, not a guess.
4. **Traceability**: `mixes` + `mix_bales` (bale → mix) and `lots.mix_id` (mix → lot); batch references (`CS-…`, `DB-…`, `RV-…`) on stage runs give sliver/roving-lot lineage.
5. **Demo clock**: business date 28 Oct 2026; live actions use a clock that starts at the seed time and never runs behind the ledger head.
6. **Seed** is deterministic (seeded PRNG), dates relative to the demo date, committed to the ledger as one block per production day, with a synthetic audit-log entry per action so the Developer Console is populated from the first screen.
7. **Scenario**: lot 101 (40s CH, PD Textiles) is planted with RF-6 over spindle-speed master + overdue traveller + high-SFI mix. The complaint for lot 101 is *not* pre-seeded so it can be registered live (`/complaints/new?lot=101&type=HAIRINESS`).
