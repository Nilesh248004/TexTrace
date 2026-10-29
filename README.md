# TexTrace v2 — mill-to-customer traceability for a cotton spinning mill

Think of yourself as the owner of a spinning mill that sells yarn lots. When a customer says *"lot 101 I bought yesterday has more hairiness"*, TexTrace answers on one screen:

1. when the lot left the mill (invoice, vehicle, driver, transporter, LR, cartons) and how it was packed (cone colour code, cones per carton, weights),
2. which yarn lot, count and **mix ratio** it is, which **bales** went into the mix (supplier, HVI, bay/bin, issue date),
3. the complete journey — bale store → blow room → card → drawing → [comber] → fly frame → ring frame → autoconer → packing → FG store → dispatch → delivered — with IN/OUT times on every machine,
4. QUALITY, PRODUCTION and ACCESSORIES results for every stage and machine, each judged **green / yellow / red** against the master version active on the production date,
5. an **AI analysis** (deterministic statistics first, optional LLM narrative) that ranks the likely cause with evidence, the lots and customers at risk, and recommended actions — followed by the QA head's manual conclusion, closed on the ledger.

Everything is anchored on a simulated permissioned ledger (hash-chained blocks, Merkle roots, 3-of-4 validator signatures); *Validate chain* and a tamper simulation prove it.

## Run it

```bash
npm install
npm run dev          # API on :4000 (seeds itself on first start), web on :5173
npm test             # unit + API suite (SQLite in memory)
npm run typecheck
npm run seed         # wipe + reseed the configured database
```

`.env` (see `.env.example`): `DATABASE_URL` (Neon Postgres; SQLite file otherwise), `ANTHROPIC_API_KEY` (optional LLM narrative), `LEDGER_VALIDATOR_SECRET`. Deployment notes: [docs/DEPLOY.md](docs/DEPLOY.md).

Demo date is **28 Oct 2026, 15:10 IST** — all seed data is relative to it. Sign in with any persona on the login page: mill owner `admin`, QA head `qa`, operator `operator`, dispatch `dispatch`, customer service `cs`, developer `dev`, auditor `auditor`, and the customers (separate portal login) `pdt` (PD Textiles), `vkf`, `slh`, `kvw`, `ggt`.

## The 60-second Lot 101 demo

1. Sign in as `qa`, type **101** in the search box → the **Lot Passport**: dispatch (TN-39-AB-4521, left yesterday 08:30), 12 cartons + part carton with green-tip cones, mix M-001, 7 bales with store locations, 11-stage timeline with IN/OUT times, three tabs Quality / Production / Accessories — RF-6 spindle speed and traveller age red, hairiness red, mix short-fibre index red.
2. Sign out, sign in as customer `pdt` → **Report a problem** → lot 101 → Hairiness → submit.
3. Sign in as `qa` → *Complaints* → the new complaint → **Run AI analysis**: #1 RF 6 (spindle speed + 30-day-old traveller, r = 0.92 across all 40s CH ring runs, sibling frame RF 7 healthy, corrected on 21 Oct), #2 mix M-001 (bales 9005/9007 from Sri Venkateswara Ginning), recall scope lots 102, 110–112 and their customers (lot 110 already has an open complaint from Ganga Garments).
4. Write the conclusion and **Close complaint** (signed, on the ledger) → the customer sees *Closed* and the reply in the portal.
5. `dev` → *Developer Console*: every step with request/response JSON, contract rules, tx hash, block, validators and DB diff; **Validate chain**; run a **tamper** and see the exact field flagged.

## Architecture

| Layer | Where |
|---|---|
| Masters (Count & Mix, Quality, Production, Accessories, Color Code; versions, approval workflow, completeness) | `server/contracts/master.ts`, `server/domain/masters.ts`, UI `client/src/pages/Masters*.tsx` |
| Judgement (green / yellow = last 20 % of tolerance / red) | `shared/quality.ts`, `server/domain/masters.ts` — every value is judged on the server against the version active on its date |
| Smart contracts (AssetID, ProcessEvent, Quality, Master, Transfer, Access) + permission matrix | `server/contracts/*`, `shared/permissions.ts` |
| Ledger + integrity | `server/ledger/*`, `server/domain/integrity.ts` |
| Lot passport, live location, trace, alerts, dashboards | `server/domain/lots.ts`, `server/domain/overview.ts` |
| Complaint analysis | `server/analysis/engine.ts` (deterministic), `server/analysis/narrative.ts` (optional LLM, output rejected if it cites numbers the engine did not produce) |
| Seed (real-looking mill, deterministic, relative to the demo date) | `server/seed/*` |
| UI | `client/src` — staff app, customer portal, public QR passport |

Design notes and the gap analysis against v1: [docs/V2_AUDIT.md](docs/V2_AUDIT.md). Client conventions: [docs/V2_CLIENT_GUIDE.md](docs/V2_CLIENT_GUIDE.md).
