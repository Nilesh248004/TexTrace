> **Superseded.** This document describes TexTrace v1 (bale-to-cone prototype). The current product is v2 — see [README.md](../README.md), [V2_AUDIT.md](V2_AUDIT.md) and [V2_CLIENT_GUIDE.md](V2_CLIENT_GUIDE.md). Ledger, contract-runtime and color-logic sections below still apply.

# TexTrace — Build Specification (internal, for implementers)

TexTrace is a blockchain-based **fibre-to-yarn (bale-to-cone) traceability dashboard** for a spinning mill
(Textile Technology final-year project). This document is the binding implementation contract. The mentor-approved
UI spec (user prompt) is summarised in §13–§15; where this file is more specific, follow this file.

**Already written (do not rewrite; extend only if a section below says so):**

| File | What it is |
|---|---|
| `shared/params.ts` | Departments, stage order, parameter registry (keys/labels/units/applicability) |
| `shared/quality.ts` | Tolerance → color logic (`evaluate`, `worstColor`, standard index helpers) |
| `shared/format.ts` | Dates (DD/MM/YYYY), complaint no `NN/YYYY`, configurable lot formats, `parseLotQuery` |
| `shared/permissions.ts` | Roles, contract function registry, permission matrix, menu access |
| `shared/types.ts` | All domain DTOs (camelCase), DevTrace, ledger types, read models, AI types |
| `shared/api.ts` | HTTP route table `ApiRoutes` (request/response types), envelopes, WS events |
| `server/config.ts` | Env config (`config`) |
| `server/lib/hash.ts` | `canonicalJson`, `sha256Hex`, `hashObject`, `hmacHex`, `ZERO_HASH` |
| `server/lib/events.ts` | `bus.publish(WsEvent)`, `bus.invalidate(domains)` |
| `server/db/schema.sql` | Full SQLite schema (snake_case) |
| `server/db/index.ts` | `getDb/openDb/setDb/wipeDb`, `nextSeq/peekSeq/bumpSeqTo/newId`, settings helpers, JSON helpers |
| `server/db/entities.ts` | Entity registry: snapshot fields, `recordHashOf`, `snapshotOf`, `diffSnapshots`, `domainsFor` |
| `server/ledger/types.ts` | `LedgerService` adapter interface + `PendingTx` |
| `server/contracts/types.ts` | Runtime interfaces: `ExecContext`, `ContractModule`, `ContractRuntime`, `ContractRejection` |

---

## 1. Tech & conventions

- **Single npm package** at the repo root. `npm install && npm run dev` starts API (tsx watch, port 4000) and Vite
  (port 5173, proxies `/api` and `/ws`). TypeScript strict, ESM (`"type": "module"`).
- **Imports:** `@shared/*` → `shared/*` works in server, client and tests (tsconfig paths + Vite/Vitest aliases).
  Client also uses `@/*` → `client/src/*`. Server-internal imports are relative (`../db`, `./types`). No file extensions.
- **No new dependencies.** Everything needed is installed (see package.json). Never run `npm install`/`npm i`.
  If something is truly missing, stop and report it in your final message.
- **Never** start long-running servers on ports 4000/5173 in parallel builds; if you must run the server, use
  `API_PORT=<unique port> DB_FILE=/tmp/...` (use your scratch dir) and kill it when done.
- DB rows are snake_case; DTOs are camelCase (mapping in `server/services/mappers.ts`). JSON columns are TEXT.
- Dates: business dates are `YYYY-MM-DD` strings; timestamps are ISO-8601 UTC strings. UI displays `DD/MM/YYYY`.
- Hashes are lowercase hex **without** `0x` in storage; UI shows `0x` + first 10 chars (`shortHash`).
- IDs are human-readable and deterministic: `LOT-182-2026`, `CMP-22-2026`, `DSP-2026-0112`, `CUST-PDT`, `RF-3`,
  `BALE-0412`, `TR-000123`, `PE-000123`, `PK-000012`, `DOC-0003`, `AN-0005`, `CON-0003`, `OVR-0002`, `CE-000031`,
  `STD-30CH-RF-U`, `U-QA`. Use `newId(db, prefix, pad)` / `ctx.newId(prefix, pad)`.
- Every money/qty is kg (REAL). Round displayed kg to 1 decimal.
- Code style: small focused modules, comments only where non-obvious, no `any` leaks across module boundaries
  (internal `any` OK where SDK typing forces it).

## 2. Folder structure (final)

```
server/
  index.ts                 # bootstrap: open DB, init ledger, seed if empty, start HTTP + WS (B2)
  app.ts                   # createApp(): express app (exported for supertest) (B2)
  config.ts, lib/{hash,events}.ts, db/{schema.sql,index.ts,entities.ts}          # DONE
  lib/sanitize.ts          # allowlist HTML sanitizer for conclusion rich text (contracts agent)
  lib/pdf.ts               # tiny dependency-free PDF writer (seed agent) — used for the seeded complaint letter
  ledger/
    types.ts               # DONE
    merkle.ts              # merkleRoot(hashes), merkleProof(hashes, i), verifyProof(...)
    validators.ts          # validator set (4 orgs), sign/verify (HMAC), endorsement policy 3-of-4
    simulated.ts           # SimulatedLedger implements LedgerService (SQLite-backed)
    fabric.ts              # FabricLedgerAdapter stub (documented TODO; throws 'not configured')
    index.ts               # getLedger(): LedgerService singleton chosen by config.ledger.adapter
  contracts/
    types.ts               # DONE
    runtime.ts             # createRuntime(db, ledger): ContractRuntime  (+ getRuntime() singleton)
    context.ts             # ExecContext implementation (tracked writes, checks, seq, notifications)
    access.ts              # AccessContract   (login, updateSettings) + permission check helper
    assetId.ts             # AssetIDContract  (registerBale, registerLot, registerCustomer, registerMachine, anchorDocument, issuePassport)
    processEvent.ts        # ProcessEventContract (logStageEvent, recordPacking)
    quality.ts             # QualityContract  (recordTestResult, upsertStandard, deleteStandard, evaluateGate, recordOverride,
                           #                   registerComplaint, transitionComplaint, anchorAnalysis, recordConclusion)
    transfer.ts            # TransferContract (createDispatch)
    gate.ts                # pure quality-gate evaluation used by Quality.evaluateGate (and the gate-check endpoint)
    derive.ts              # derived lot quantities (producedKg/packedKg/dispatchedKg/currentStage) — shared with services
    index.ts               # CONTRACT_MODULES registry
  analysis/
    stats.ts               # mean, sd, median, MAD, robust z, pearson, clamp
    knowledge.ts           # root-cause knowledge base (hypotheses, evidence scorers, actions)
    engine.ts              # analyze(dataset): AnalysisResult (deterministic, offline)
    narrative.ts           # template narrative (no LLM) from AnalysisResult
    llm.ts                 # Anthropic narrative layer (validated JSON, numeric guard), LlmMeta
    hashing.ts             # inputDigest(dataset) + inputHash/outputHash
  services/                # read models + orchestration used by routes (B1-R / B2)
    mappers.ts             # row -> DTO (+ chainRef with `verified`)
    auth.ts, users.ts, settings.ts, notifications.ts
    lots.ts                # list/search/detail, production view, quality view, heatmap
    trace.ts               # lot trace view, bale forward trace, genealogy graph
    complaints.ts, standards.ts, dispatches.ts, passports.ts, dashboard.ts
    analysis.ts            # dataset assembly + candidates + run orchestration (engine -> llm -> anchor)
    integrity.ts           # validateChain(): ledger.validateLedger() + record re-hash checks
    tamper.ts              # tamper presets + restore (direct DB writes, bypassing contracts)
    audit.ts               # audit queries + JSON/CSV export
    ledgerViews.ts         # block/tx explorer helpers
  api/
    router.ts              # mounts all routers under /api
    middleware.ts          # auth (Bearer token), error handler, request context
    respond.ts             # sendAction(res, ActionResult), sendOk, sendError, zod -> 422 with trace
    routes/*.ts            # one router per domain (auth, meta, dashboard, complaints, documents, lots, standards,
                           #   analysis, dispatch, ledger, dev, demo)
    ws.ts                  # WebSocket server on /ws, subscribes to bus
    routeRegistry.ts       # ApiRouteInfo[] for the API explorer
  seed/
    data.ts                # deterministic seeded PRNG + static master data (users, counts, customers, machines, standards)
    generate.ts            # generateScenario(): plain data for bales, lots, events, tests, packing, dispatches, complaints
    loader.ts              # seedDatabase(db, runtime, { profile }) — executes the scenario THROUGH the contracts
    cli.ts                 # `npm run seed [-- --profile pre-demo]`
client/
  index.html, src/main.tsx, src/App.tsx, src/index.css
  src/lib/{api.ts,ws.ts,queryClient.ts,utils.ts,export.ts,hash.ts,pdfReport.ts}
  src/stores/{session.ts,devMode.ts,traces.ts,theme.ts,demo.ts}
  src/hooks/{useMeta.ts,useStandards.ts,useAction.ts,useQualityEval.ts,...}
  src/components/ui/*       # shadcn/ui primitives
  src/components/layout/*   # AppShell, Sidebar, TopBar
  src/components/common/*   # QualityCell, StatusBadge, Legend, OnChainBadge, DevPanel, DevTray, ExportButtons, DataTable, ...
  src/pages/<area>/*        # one folder per screen
  src/demo/*                # Demo Mode runner (scripted scenario)
tests/
  unit/*.test.ts            # vitest: ledger, quality colors, analysis engine, contracts, integrity
  e2e/demo.e2e.ts           # Playwright (system Chrome) — runs the demo end to end, saves docs/screenshots/*.png
docs/SPEC.md (this), README.md (final)
```

## 3. Domain model (spinning mill)

- **Count**: yarn count, e.g. `30CH` = 30s Ne Carded Hosiery (display "30 CH"). Seed also has `40CH`, `20CH` standards.
- **Departments / stages** (`STAGE_ORDER`): RM (bale mix) → BR (blowroom) → CARD → DF (draw frame) → FF (fly frame/simplex)
  → RF (ring frame) → AW (autoconer) → PACK.
- **Lines**: two production lines (machine groups). Line A: BR-1, CARD-1..4, DF-1..4, FF-1..4, RF-1..6, AW-1..4.
  Line B: BR-2, CARD-5..8, DF-5..8, FF-5..8, RF-7..12, AW-5..8. Even lot seq → line A, odd → line B.
  ProcessEvent/test rule: a machine must belong to the lot's line.
- **Lot**: a mixing lot of one count, e.g. `182/2026`, code `30CH 182 X/26 001` (formats configurable in Settings).
- **Bale**: raw-material bale with HVI fibre values; consumed (kg) by one or two consecutive lots (laydown overlap).
- **Production event**: per lot / department / machine / date (/ shift) with input/output/waste kg and machine settings
  (`params` keyed by PROCESS param keys).
- **Test result**: `MACHINE` samples (per machine/day/shift → heatmap) and `LOT` samples (one release test per
  department per lot → QUALITY tab rows, quality gate). Values keyed by QUALITY param keys.
- **Day index** `D1..Dn`: the n-th distinct production date of that department for that lot.
- **Standard** (Quality Standards Master): per count + department + parameter: std, lower, upper (either may be null for
  one-sided), category FIBRE/PROCESS/QUALITY. Drives every color, the gate and the AI.
- **Packing** → **Dispatch** (custody transfer to customer, quality-gated) → **Product Passport** (public QR page).
- **Complaint** `NN/YYYY` with workflow OPEN (red) → UNDER_ANALYSIS (yellow) → RESOLVED (green).
  Timeline labels: "Complaint received", "Registered on ledger", "Under analysis", "Resolved & closed".

Derived lot fields (never stored): `producedKg` = Σ AW output_kg; `packedKg` = Σ packing.total_kg;
`dispatchedKg` = Σ dispatch_lots.quantity_kg; `currentStage` = last stage with an event (PACK if packed).
Stored lot `status` transitions: PLANNED → IN_PRODUCTION (first event) → PACKED (first packing) → DISPATCHED (first
dispatch). ON_HOLD is set when a LOT-level test is RED; a QA override restores the previous status
(PACKED if packing exists else IN_PRODUCTION).

## 4. Color logic (GLOBAL REQUIREMENT A)

Implemented in `shared/quality.ts` — always use `evaluate(value, standard, settings.warnFraction)`.
GREEN within band and not near an edge; YELLOW in the last 20% (configurable) of the band toward either limit;
RED outside. Always render color **plus** icon + text label (`Within limits` / `Warning` / `Out of limits`), and a legend.
Client colors are computed **client-side** from the standards query (`useStandards(countId)`), so editing a standard
recolors everything immediately (WS `invalidate: ['standards', ...]`). Server uses the same function for the gate, alerts,
AI, dashboard counts, passport.

## 5. Ledger (simulated permissioned chain) — `server/ledger/*`

- **Genesis**: block 0, `prevHash = ZERO_HASH`, one tx `System.genesis` with payload
  `{ network: 'textrace-permissioned', adapter, validators, policy: '3-of-4', contracts: CONTRACTS, createdAt }`.
- **Tx hash** = `sha256(canonicalJson({ contract, fn, payload, actorId, actorRole, status, reason, entityRefs, timestamp, nonce }))`.
  `nonce = sha256(prevBlockHash + ':' + index).slice(0, 16)` (deterministic).
- **Merkle root**: leaves = tx hashes (hex strings). Parent = `sha256(left + right)` (concatenated hex). Odd count →
  duplicate the last. One leaf → root = that leaf. Empty → `sha256('')`. `getMerkleProof` returns sibling steps
  with position; `verifyMerkleProof` recomputes.
- **Block hash** = `sha256(canonicalJson({ number, timestamp, prevHash, merkleRoot, txCount, proposer }))`.
- **Validators** (one per org): `validator-1/MillOrg`, `validator-2/QualityOrg`, `validator-3/BuyerOrg`,
  `validator-4/AuditOrg`. Key = `hmac(config.ledger.validatorSecret, validatorId)`. Each validator independently
  re-verifies: every tx hash recomputes, merkle root recomputes, prevHash = current head hash, timestamp monotonic.
  Approval signature = `hmacHex(key, blockHash)`. Policy **3-of-4**; commit throws if quorum not met.
  `latencyMs` is a deterministic pseudo value (e.g. 3–18 ms derived from hash bytes) — no randomness.
  Proposer = `orderer-1`.
- **Block per action**: the runtime commits all txs of one action in one block (seed groups related calls).
- **INVALID txs** (rejections, permission denials) are committed too (Fabric-style), status `INVALID` + reason, no entity refs.
- **validateLedger()** checks, in order, and reports *every* issue with blockNumber/txHash/field:
  genesis present; for each block: prevHash = previous block hash (`PREV_HASH_BROKEN`), recomputed tx hashes
  (`TX_HASH_MISMATCH`, field = the path whose recomputed digest differs from `ledger_txs.field_digests` — digests are
  stored at commit for every top-level tx field and every top-level payload key, e.g. `payload.lots`; fall back to
  `'tx'` if digests were also altered), merkle root
  (`MERKLE_MISMATCH`), block hash (`BLOCK_HASH_MISMATCH`), signatures (`SIGNATURE_INVALID`), quorum (`QUORUM_NOT_MET`).
  It must be fast (≤ 1.5 s for ~8k txs): prepared statements, single pass.
- `stats()` → `LedgerStats` incl. `byContract` counts.
- `fabric.ts`: class `FabricLedgerAdapter implements LedgerService` whose methods throw
  `new Error('Hyperledger Fabric adapter not configured — set LEDGER_ADAPTER=simulated')`, with a header comment mapping
  each method to Fabric concepts (channel, chaincode invoke, block events, `qscc`).

## 6. Contract runtime — `server/contracts/runtime.ts`, `context.ts`

`runtime.run(req, body)`:
1. `t0`; create trace skeleton; open `db.transaction`.
2. `x.call(fn, args)` for each call:
   - **Access check**: `PERMISSIONS[fn].includes(actor.role)` (SYSTEM actor bypasses). If not → throw
     `ContractRejection('access:permission', 'Access contract: role DISPATCH is not permitted to invoke Quality.recordConclusion', 'PERMISSION_DENIED')`.
     The recorded INVALID tx for a permission denial is **`Access.checkPermission`** with payload
     `{ requested: fn, role, userId, argsHash }`.
   - Build `ExecContext` (contract, fn, actor, timestamp, settings). Call the handler.
   - Tracked writes accumulate per call: `DbChange[]` (before/after full rows), `EntityRef[]`
     (`{ type, id, version, recordHash: recordHashOf(type,row), snapshot: snapshotOf(type,row) }`).
     If the same entity is written twice in one call keep only the final ref.
   - The pending tx payload = `args` unless the handler called `ctx.setPayload()`.
   - Checks (`ctx.check` / `ctx.note`) accumulate into `ContractInvocation.checks`.
3. **Success** → `ledger.commit(pendingTxs, { timestamp })` (still inside the SQLite transaction) → backfill
   `tx_hash`, `block_number`, `record_hash` on every written entity row (UPDATE … WHERE id; this does not change the record
   hash) and insert `entity_anchors` rows; insert queued notifications. Commit.
4. **ContractRejection** → rollback everything; then in a new transaction commit ONE block containing only the rejected
   call's tx with `status: 'INVALID'`, `reason: '<rule>: <message>'`, `entityRefs: []`. HTTP status: PERMISSION_DENIED 403,
   NOT_FOUND 404, VALIDATION_FAILED 422, CONTRACT_REJECTED 422, CONFLICT 409.
5. **Unexpected error** → rollback, no block, status 500, trace accepted=false reason `Internal error: <message>`.
6. Build `DevTrace` (all fields; `response.body` = what the route sends; truncate any JSON string > 20 KB in request/response
   with `"…(truncated N bytes)"`), insert `audit_log` (unless `silent`), publish WS: `trace`, `block` (if any),
   `invalidate` (domains = `domainsFor(entity types touched)`; for rejections `['ledger','audit','dashboard']`),
   one `notification` event per inserted notification.
7. `recordNonLedger()` builds and stores a trace without any tx (tamper, validate, reset, request-validation failure,
   upload hash mismatch). `extra.bypassedContracts = true` for tamper.

Timestamps: `req.timestamp ?? new Date().toISOString()`; if earlier than the chain head timestamp (clock skew), use head
timestamp + 1 ms. `settings` = `getSettings(db)` at action start.

## 7. Smart contracts — rules (enforced) and writes

Args below are the `x.call(fn, args)` shapes. "→" = writes. All rule names (first arg of `ctx.check`) in brackets.
Every function lists its human-readable rules in `ContractFunctionDef.rules` (shown in Developer Console).

### Access
- `login { userId }` → none. [user-exists]. Returns user. (Session tokens are created by the API layer AFTER the action
  succeeds, never put on-chain or in DbChange.)
- `updateSettings { patch: Partial<Settings> }` → settings rows (insertRaw/updateRaw). [format-has-seq] lot formats must
  contain `{seq}`; [warn-fraction] 0 ≤ f ≤ 0.5; [business-date] valid date; [quality-columns] ⊆ QUALITY params.

### AssetID
- `registerCustomer { code, name, city, contactName, email, id? }` → customer (id `CUST-<code>`). [unique-code] [name-required].
- `registerMachine { department, machineNo, line, make, model }` → machine (id `<DEPT>-<no>`, label `machineLabel()`). [unique] [dept-valid].
- `registerBale { baleNo, supplier, station, variety, ginLot, weightKg, arrivalDate, fibre }` → bale (remaining = weight).
  [unique-bale-no] [weight-range] 100–250 kg; [fibre-keys] ⊆ FIBRE params; [fibre-range] MIC 2.5–6.5, UHML 20–40,
  UI 70–90, STR 20–40, SFI 2–20, TRASH 0–10, MOIST 3–12.
- `registerLot { countId, line, plannedKg, startDate, bales: [{baleId, kgUsed}], seq? }` → lot (status PLANNED),
  lot_bales, bale.remaining_kg updates. seq = `args.seq ?? nextSeq('lot:<year>')` (if args.seq given, `bumpSeqTo`).
  lotNo/lotCode via `formatLotTemplate(settings.lotNoFormat|lotCodeFormat, { seq, year, count, mark: settings.lotMark, batch: 1 })`.
  [count-exists] [line-valid] [planned-range] 500–20000; [bale-exists] [bale-available] kgUsed ≤ remaining;
  [mass-balance:fibre] Σ kgUsed ≥ plannedKg (fibre in ≥ planned yarn out).
- `anchorDocument { sha256, filename, mimeType, sizeBytes, storagePath }` → document. [hash-format] 64 hex;
  [pdf-only] mime `application/pdf`; [size-limit] ≤ 10 MB. If the same sha256 already exists → `note('duplicate', …)` and
  return the existing row (no insert).
- `issuePassport { dispatchId }` → passport row with `code = dispatch.passport_code`. [dispatch-exists] [not-issued].

### ProcessEvent
- `logStageEvent { lotId, department, machineId?, eventDate, shift?, inputKg, outputKg, wasteKg, params, notes? }`
  → production_event (+ lot status PLANNED→IN_PRODUCTION). dayIndex = 1-based rank of eventDate among distinct
  event dates for (lot, dept) including this one.
  [lot-exists]; [lot-open] lot not DISPATCHED unless dept = PACK; [stage-order] dept ≠ RM requires ≥1 event of the
  previous stage in STAGE_ORDER (`Stage order violation: cannot log RF before FF has started for lot 182/2026`);
  [machine-required] for CARD/DF/FF/RF/AW; [machine-dept] machine.department = dept; [machine-line] machine.line = lot.line;
  [mass-balance:event] |input − (output + waste)| ≤ 0.5% of input + 0.5 kg; [waste-limit] waste% ≤ BR 6, CARD 8, DF 1.5,
  FF 1.5, RF 4, AW 2, RM 0.5; [mass-balance:stage] cumulative output(dept) ≤ cumulative output(previous stage) × 1.01 + 1;
  [date-window] lot.startDate ≤ eventDate ≤ businessDate; [params-keys] ⊆ PROCESS params for dept, finite.
  Tolerance: evaluate each param vs PROCESS standard → `note('tolerance:<DEPT>:<PARAM>', 'BREAK_DRAFT 1.34 outside 1.14–1.24 (RED) — flagged')`
  for yellow/red; red → notify warning.
- `recordPacking { lotId, packDate, packWeightKg, packsCount, conesPerPack }` → packing (serials `P<seq>-0001…`
  using sequence `pack:<lotId>`), lot status IN_PRODUCTION/ON_HOLD stays ON_HOLD, IN_PRODUCTION→PACKED.
  [aw-started]; [pack-weight] 10–100; [packs-positive]; [mass-balance:packing] cumulative packed ≤ cumulative AW output × 1.005;
  [date-window].

### Quality
- `recordTestResult { lotId, department, machineId?, sampleType, testDate, shift?, values, instrument?, remarks? }`
  → test_result (testedBy = actor.id). [lot-exists] [dept-testable] ∈ MACHINE_TEST_DEPARTMENTS; [stage-started] an event
  exists for (lot, dept); [sample-machine] MACHINE requires machine of dept + lot line, LOT requires machineId null;
  [values-keys] ⊆ QUALITY params for dept, ≥ 1 value; [values-sane] all ≥ 0, U/CV < 60, IPI < 5000;
  [date-window] first event date of dept ≤ testDate ≤ businessDate. dayIndex (MACHINE) = index of testDate among the
  dept's distinct event dates (nearest previous). Tolerance notes for every value (`tolerance:RF:U` …).
  Red → notification (LOT sample: critical + lot status → ON_HOLD; MACHINE: warning).
- `upsertStandard { countId, department, parameter, category, std, lower, upper, unit?, reason? }` → standard
  (id `STD-<count>-<dept>-<param>`; create or update + reactivate) and standards_history (CREATE/UPDATE).
  [count-exists] [param-valid] parameter ∈ PARAMS, applicable to dept, category = param category;
  [limits-present] at least one limit; [limits-order] lower ≤ std ≤ upper; [reason-required] (update) ≥ 5 chars.
  Notify info `Standard updated: 30 CH RF U% → std 10.5 (10.3 – 10.8). All results recolored.`
- `deleteStandard { id, reason }` → standard active=0 (version+1) + history DELETE. [exists-active] [reason-required].
  (standards_history.tx_hash/block_number may stay NULL — services join entity_anchors on (standard, version).)
- `evaluateGate { lotIds }` → no writes; returns `GateResult` (via `gate.ts`): per lot, evaluate every value of every LOT
  sample (latest per department) → redItems/yellowItems; MACHINE samples → machineLevelRed (warning only);
  blocked = redItems.length > 0 && no qa_override for the lot. `passed` = no lot blocked. `setPayload` with a compact
  summary `{ lotIds, passed, blocked: [...], machineLevelRed: n }`.
- `recordOverride { lotId, reason }` → qa_override; lot ON_HOLD → previous status. [lot-exists]
  [override-needed] lot has LOT-level red; [reason-length] ≥ 15 chars.
- `registerComplaint { complainantName, type, customerId, lotId, description, documentId?, receivedDate, seq? }`
  → complaint (status OPEN, dispatch_id = latest dispatch of that lot to that customer) + complaint_event (null→OPEN,
  note 'Complaint registered on ledger'). seq = `args.seq ?? nextSeq('complaint:<year of receivedDate>')`.
  [customer-exists] [lot-exists] [lot-dispatched-to-customer] (`Lot 185/2026 was never dispatched to PD Textiles`);
  [type-valid] [description-length] ≥ 10; [complainant-required]; [document-exists] if given;
  [received-date] dispatchDate ≤ receivedDate ≤ businessDate. Notify warning `New complaint 22/2026 — PD Textiles, lot 182/2026`.
- `transitionComplaint { complaintId, to, note }` → complaint.status/updated_at + complaint_event.
  Allowed: OPEN→UNDER_ANALYSIS, UNDER_ANALYSIS→OPEN, RESOLVED→UNDER_ANALYSIS (reopen: [reopen-role] ADMIN/QA only).
  [no-direct-resolve] to = RESOLVED is rejected ("Use Resolve & Close (Quality.recordConclusion)").
- `anchorAnalysis { id, complaintId?, lotId, runNo, context, comparisonLotIds, result, inputHash, outputHash, llm }`
  → analyses row. [lot-exists] [complaint-lot-match] [comparison-limit] ≤ 15, exist, same count, exclude target;
  [output-hash] outputHash = sha256(canonical(result)); [input-hash-format]. `setPayload({ analysisId, complaintId, lotId,
  runNo, inputHash, outputHash, engineVersion, model, llmStatus })`.
- `recordConclusion { complaintId, conclusionHtml, rootCause, correctiveAction, preventiveAction, analysisId? }`
  → conclusion (html sanitized with `lib/sanitize.ts` allowlist: p br strong b em i u s ul ol li h3 h4 blockquote code pre;
  all attributes stripped) + complaint RESOLVED + complaint_event (UNDER_ANALYSIS→RESOLVED, note = 'Resolved & closed: <rootCause>').
  [complaint-exists] [status-under-analysis] (`Complaint must be Under Analysis before it can be closed`);
  [not-concluded]; [fields-required] rootCause/corrective/preventive ≥ 10 chars, conclusion text ≥ 20 chars;
  [analysis-belongs] if analysisId. Notify info `Complaint 22/2026 resolved`.

### Transfer
- `createDispatch { customerId, countId, dispatchDate, lots: [{lotId, quantityKg}], packWeightKg, conesCount?, vehicleNo,
  lrNo, invoiceNo?, gate: GateResult, seq? }` → dispatch (id `DSP-<yyyy>-<seq4>`, no `DSP/<yyyy>/<seq4>`,
  `packsCount = ceil(qty / packWeight)`, `conesCount` default = packsCount × conesPerPack of the lot's packing,
  `passport_code = 'PP-' + sha256(id + timestamp).slice(0,8).toUpperCase()`, gate JSON, override_ids) + dispatch_lots
  + lot status → DISPATCHED. [customer-exists] [lots-present] unique; [lot-count-match] lot.countId = countId;
  [quantity-positive]; [mass-balance:custody] per lot quantity ≤ packedKg − dispatchedKg
  (`Mass balance: lot 182/2026 has 900.0 kg packed & undispatched, requested 2000 kg`); [quality-gate] `gate.passed`
  (`Quality gate: lot 185/2026 has RED results (RF COUNT_CV 2.31 > 2.00). Record a QA override with reason to proceed.`);
  [pack-weight] 10–100; [vehicle-format] `/^[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{0,3}[ -]?\d{3,4}$/i`; [lr-required];
  [dispatch-date] ≥ first pack date of each lot and ≤ businessDate. Machine-level reds → `note('gate:machine-level', …)`.
  Notify info `Dispatch DSP/2026/0113 — 2,000 kg 30 CH to PD Textiles`.

The API dispatch action = `evaluateGate` → `createDispatch({..., gate})` → `issuePassport({ dispatchId })` (3 txs, 1 block).

## 8. Services, integrity, tamper

- `mappers.ts`: `chainRef(type, row)` → `{ txHash, blockNumber, recordHash, version, verified }`, verified =
  `row.record_hash != null && recordHashOf(type,row) === row.record_hash`. Map every entity to its DTO.
- `integrity.validateChain()` = `ledger.validateLedger()` + record checks over every ENTITIES table:
  latest anchor per (type,id) (`entity_anchors` max version) vs re-hashed current row → `RECORD_HASH_MISMATCH` with
  `field` = first diff path from `diffSnapshots(onChainSnapshot, currentSnapshot)` (on-chain snapshot = entityRef in the
  anchor's tx), expected/actual values, blockNumber, txHash, entityType/Id; anchor hash ≠ entityRef hash on chain →
  `ANCHOR_MISMATCH`; anchors without row → `RECORD_MISSING`; `verifyExtra` failures. Returns ChainValidationReport;
  publish WS `integrity`. Target: < 2 s on the seeded DB.
- `tamper.ts` (direct SQL, no contracts, stores originals in tamper_log):
  - `hide-bad-result`: the highest-U% MACHINE test of lot 182/2026 RF → set `values_json.U` to 10.52.
  - `change-dispatch-qty`: dispatch of lot 182/2026 to PD Textiles (or latest dispatch) → quantity_kg − 200.
  - `edit-ledger-payload`: latest `Transfer.createDispatch` tx → payload `lots[0].quantityKg` − 500 (tx hash not updated
    → TX_HASH_MISMATCH at that block).
  - `record` / `block` generic modes (entityType/entityId/field[.jsonKey]/value; blockNumber/txIndex/field path/value).
  - `restore()` reverts all un-restored tampers (reverse order).

## 9. HTTP API — `server/api/*`

- Route table and types: `shared/api.ts` (`ApiRoutes`). Implement every route listed. Envelope `{ ok, data, trace? }`.
- Auth: `Authorization: Bearer <token>` (sessions table). Public: `POST /api/auth/login`, `GET /api/passports/:code`,
  `GET /api/meta` (works without auth; user-specific bits omitted), `GET /api/documents/:id/file` (requires token via header
  OR `?token=` query so `<iframe>` can load it). Missing/invalid token → 401 `UNAUTHENTICATED`.
- Reads: role-agnostic for internal roles; BUYER may only read lots/dispatches/passports of their own customer (filter).
- Writes: validate body with zod → on failure `recordNonLedger` (accepted=false, 422 `VALIDATION_FAILED`, trace returned).
  Then `runtime.run(...)` and `sendAction(res, result)`.
- Login: `POST /api/auth/login { username }` → runtime action `auth.login` (`Access.login`), then create session token
  (`randomHex(24)`), respond `{ token, user }` + trace.
- Documents: `multer` memory storage, 10 MB, field `file`, plus `clientSha256`. Server recomputes sha256; mismatch →
  recordNonLedger 422 (`Hash mismatch: browser 0x… vs server 0x…`). Magic bytes must start with `%PDF`. Store at
  `uploads/<sha256>.pdf`; action `document.upload` → `AssetID.anchorDocument`. Response `DocumentUploadResult`.
- Analysis run: `POST /api/analysis/run` → services/analysis: assemble dataset → `analyze()` → `llm.narrate()` (async,
  bounded by `config.ai.timeoutMs`) → hashes → `runtime.run({ action: 'analysis.run', extra: { prompt, model, latencyMs,
  inputJson, outputJson, llmStatus } })` with `Quality.anchorAnalysis` (+ `Quality.transitionComplaint` OPEN→UNDER_ANALYSIS
  when the complaint is OPEN). runNo = 1 + max run_no for the complaint (or lot when no complaint).
- Dispatch: `POST /api/dispatches/gate-check` (read-only GateResult, no tx). `POST /api/dispatches` (3 txs).
- Ledger/dev endpoints per route table. `GET /api/dev/audit/export?format=json|csv` downloads the audit log
  (CSV columns: timestamp, user, role, action, label, accepted, reason, contracts, txHashes, blockNumber).
- `GET /api/dev/routes` → `routeRegistry.ts` (every route with summary, auth, contract fn, sample body).
- Demo: `POST /api/demo/reset { profile }` (ADMIN/DEVELOPER) → `wipeDb` → ledger.init → seed profile → broadcast
  `invalidate ['*']` → trace via recordNonLedger (after reset).
- WS `/ws`: on connect send `hello`; forward every bus event as JSON. Client reconnects with backoff.
- Static: in production (`NODE_ENV=production`) serve `dist/` with SPA fallback.
- Bootstrap (`server/index.ts`): open DB → ledger.init() → if `!isSeeded()` seed profile `full` (log duration) → listen.

## 10. AI Complaint Analysis — `server/analysis/*`

Deterministic statistical engine first (works offline), optional LLM narrative second.

**Dataset** (`AnalysisDataset`, assembled in services/analysis.ts): target lot bundle (tests, events, bales with kgUsed),
comparison bundles (≤ 15 same-count lots), active standards of the count, machines, all dispatches (with lots),
machine usage of all lots, complaint, context (from heatmap: department/machineId/dayIndex/date/shift/parameter).

**Candidates** (`GET /api/analysis/candidates?lotId`): all other lots of the same count with start date within ±30 days;
`defaultSelected` = no LOT-level red, up to 15, nearest in time first.

**Engine** `analyze(ds): AnalysisResult` (engineVersion `stat-1.0`):
1. Focus params = complaint type params (`COMPLAINT_TYPE_PARAMS`) ∪ context.parameter; default
   `U, CV, THIN, THICK, NEPS, IPI, H, CSP, RKM, CV1M, CV3M, CV10M, COUNT_CV`. Focus weight 1.5.
2. **LOT** deviations: each LOT test value vs standard (`evaluate`) and vs comparison lots' LOT values of the same
   dept/param (mean, sample sd with floor `max(sd, 0.05 × half-band, 1e-6)`, z). Keep if yellow/red or |z| ≥ 2.
3. **MACHINE_DAY** deviations: per dept/param, group target MACHINE tests by (machine, dayIndex) → cell mean (+ shifts).
   Within-lot robust z = 0.6745 × (x − median) / MAD (MAD floor = 0.05 × half-band). Keep if yellow/red or |robust z| ≥ 3.
   Context cell is always evaluated and gets weight ×1.3.
4. **PROCESS** deviations: target production event params vs PROCESS standards (per machine/day) + z vs comparison lots'
   same dept/param event values. Keep if yellow/red or |z| ≥ 3.
5. **FIBRE**: kg-weighted mean of consumed bales' fibre values vs FIBRE standards and vs comparison lots' weighted means.
6. Significance 0–100 = round(100 × min(1, 0.45·min(|normalized|,2)/2 + 0.45·min(|z|,6)/6 + 0.10·[red]) × weights),
   capped 100. Rank desc, keep top 25.
7. **Suspected location**: the highest-significance MACHINE_DAY deviation among focus params (tie → upstream-most).
   Confidence from: red severity, number of other quality params also red/yellow at the same cell, upstream departments
   (earlier in STAGE_ORDER) clean on that date, matching PROCESS deviation at the same machine/day. Evidence strings cite
   numbers, e.g. `RF M/c 3 · D2 (01/10/2026): U% 12.61 vs std 10.50 (limits 10.30–10.80), robust z 14.2 vs 23 other RF machine-days`.
8. **Correlations**: for the suspected dept, observations = (lot, machine, date) across target + comparison lots: cell mean
   of the suspected quality param joined with the production event params of the same lot/machine/date; Pearson r for each
   PROCESS param with n ≥ 8; strong |r| ≥ 0.6, moderate ≥ 0.35, weak otherwise; keep |r| ≥ 0.2.
9. **Root causes** (knowledge.ts): hypotheses with scorers → confidence 0–100 + evidence items with numbers:
   `RF_BREAK_DRAFT` (RF suspected cell + BREAK_DRAFT deviation same machine/day + correlation),
   `RF_DRAFTING_MECH` (cots/aprons/top-arm: localized RF anomaly with THIN+THICK ↑, TOP_ARM_KG deviation or maintenance
   note mentioning cots/apron), `RF_SPACER`, `RF_SPINDLE_SPEED` (hairiness), `UPSTREAM_FF` (FF U%/CV deviations on the
   feeding dates — if FF clean, low confidence and say so), `UPSTREAM_DF` (DF U%/CV1M/CV3M), `CARDING` (neps/U, card
   settings), `RAW_MATERIAL` (FIBRE deviations: MIC, SFI, UHML, TRASH), `AW_WINDING` (AW-only hairiness/IPI with
   WIND_SPEED), `COUNT_CONTROL` (COUNT/COUNT_CV/HANK), `TESTING_ERROR` (single isolated spike, no corroboration).
   Return causes with confidence ≥ 10, sorted, max 5. Each cause has corrective + preventive actions in the KB.
10. **Recall scope**: lots that ran on the suspected machine on the suspected date(s) (HIGH = target lot; MEDIUM = other lot
   same machine same date; LOW = same machine next date if that cell is not clean); dispatches containing HIGH/MEDIUM lots
   → customers; totalKgAtRisk = Σ those dispatch qty; estimatedAffectedKg = lot producedKg × (suspected machine-day RF
   output_kg / lot RF output_kg); basis sentence with the numbers.
11. **Actions**: corrective/preventive from the top causes (dedupe), each with owner + priority.
12. **Summary** + **template narrative** (`narrative.ts`, source `template`), e.g. headline
   `Evenness defect traced to RF M/c 3 on D2 (01/10/2026) — break draft 1.34 vs std 1.18`.

**LLM layer** (`llm.ts`, Anthropic TypeScript SDK `@anthropic-ai/sdk`):
- Enabled iff `ANTHROPIC_API_KEY` set. Model `config.ai.model` (default `claude-opus-5-5`), effort `config.ai.effort`
  (default `medium`), timeout `config.ai.timeoutMs`, `maxRetries: 2`.
- Request: `client.beta.messages.create({ model, max_tokens: 16000, betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default', output_config: { effort, format: { type: 'json_schema', schema: NARRATIVE_JSON_SCHEMA } },
  system, messages: [{ role: 'user', content }] })` — when `AI_FALLBACKS=off` (or a 400 `BadRequestError` occurs with
  fallbacks) use `client.messages.create` with the same body minus `betas`/`fallbacks`. Do NOT send `thinking`
  disabled / `budget_tokens` / temperature (they 400 on this model). Cast params `as any` only if SDK types lag.
- Check `stop_reason === 'refusal'` before reading content → status `refusal`. Read the first `text` block, `JSON.parse`,
  validate with zod `{ headline ≤ 200 chars, narrative ≤ 3000 chars, rootCauseExplanations: [{ causeId ∈ input cause ids,
  explanation }], cautions: string[] }`.
- **Numeric guard**: every number in the LLM output text must exist in the evidence JSON (compare at 0–2 decimal rounding;
  integers ≤ 31 that appear in the input as day/machine numbers are OK). Any unknown number → status `rejected`,
  issues listed, fall back to the template narrative. Never let the model add data.
- System prompt: textile QA analyst; use ONLY the provided evidence; cite numbers exactly; advisory — the QA engineer's
  manual conclusion is final; output JSON only. User content: compact evidence JSON (summary, top 12 deviations,
  suspected, root causes with evidence, correlations, recall scope, actions).
- Errors: catch typed SDK errors (`Anthropic.RateLimitError`, `Anthropic.APIError`, …) → status `error` + message; on any
  failure use template narrative. Without a key → status `disabled` (UI shows banner "AI narrative disabled").
- `LlmMeta` records prompt (system + user), input/output JSON, model, latency, validation.
- Hashing: `inputHash = hashObject(inputDigest(ds))` where digest = { target lot id, comparison ids, context, complaint id,
  standards [id, version, std, lower, upper], tests [id, record_hash] sorted, events [id, record_hash] sorted };
  `outputHash = hashObject(result)` (result includes the narrative).

## 11. Seed data — `server/seed/*` (deterministic, mulberry32 seed 20261016)

Profiles: **`full`** (default first run) and **`pre-demo`** (= full minus the 09/10/2026 PD Textiles dispatch and complaint
22/2026 + its PDF; the demo creates them live). Everything goes **through the contracts** (`runtime.run` with
`silent: true`, historical `timestamp`, actor = the seeded user of the right role) so every record is anchored.
Group related calls into one action/block (e.g. all MACHINE tests of a lot/department/day). Execute actions in global
timestamp order (ledger time must be monotonic). Target: full seed < 8 s.

**Users** (username → role, name, title): `admin` ADMIN "R. Senthil Kumar" (Mill Admin); `dev` DEVELOPER "A. Karthik"
(Blockchain Developer); `operator` PRODUCTION "M. Ravi" (Spinning Supervisor); `qa` QA "S. Priya" (QA Engineer);
`dispatch` DISPATCH "K. Murugan" (Dispatch & Packing In-charge); `cs` CUSTOMER_SERVICE "J. Anitha" (Customer Service
Executive); `auditor` AUDITOR "V. Ramesh" (Internal Auditor); `buyer` BUYER "PD Textiles – Purchase" (customer CUST-PDT).
User ids `U-<USERNAME uppercased>`.

**Counts**: 30CH (30s Carded Hosiery, ne 30), 40CH (ne 40), 20CH (ne 20).
**Customers**: CUST-PDT PD Textiles (Tiruppur), CUST-VKF Velan Knit Fabrics (Tiruppur), CUST-SLH Sri Lakshmi Hosiery
(Coimbatore), CUST-KVW Kaveri Weaves (Erode).
**Machines**: per §3 lines (BR 2, CARD 8, DF 8, FF 8, RF 12, AW 8). Makes: LMW / Rieter / Trützschler / Savio / Murata (generic).

**Standards 30CH** (std, lower, upper; `—` = null):
- RM FIBRE: MIC 4.2 (3.8, 4.6); UHML 28.8 (28.0, 29.6); UI 82.0 (80.5, 84.0); STR 29.5 (28.0, 31.5); SFI 8.5 (6.5, 10.0);
  TRASH 2.5 (1.5, 3.5); MOIST 7.5 (6.5, 8.5).
- BR PROCESS: BEATER_RPM 750 (700, 800); WASTE_PCT 3.2 (2.5, 4.0).
- CARD PROCESS: CYL_RPM 450 (430, 470); LICKER_RPM 900 (850, 950); FLAT_SPEED 250 (230, 270); DEL_SPEED 150 (140, 160);
  WASTE_PCT 5.5 (4.5, 6.5). CARD QUALITY: HANK 0.120 (0.116, 0.124); U 3.2 (2.9, 3.6); CV 4.0 (3.6, 4.5); NEPS_G 40 (—, 60).
- DF PROCESS: DEL_SPEED 450 (420, 480); BREAK_DRAFT 1.70 (1.60, 1.80); TOTAL_DRAFT 8.0 (7.6, 8.4); DOUBLINGS 8 (8, 8).
  DF QUALITY: HANK 0.120 (0.117, 0.123); U 2.6 (2.3, 3.0); CV 3.0 (2.6, 3.5); CV1M 0.8 (—, 1.2); CV3M 0.5 (—, 0.8).
- FF PROCESS: FLYER_RPM 1000 (950, 1050); TPI 1.25 (1.20, 1.30); BREAK_DRAFT 1.20 (1.15, 1.25).
  FF QUALITY: HANK 1.10 (1.07, 1.13); U 4.5 (4.1, 4.9); CV 5.7 (5.2, 6.2).
- RF PROCESS: SPINDLE_RPM 17500 (17000, 18000); TPI 21.5 (21.0, 22.0); BREAK_DRAFT 1.18 (1.14, 1.24); TOTAL_DRAFT 33.0
  (32.0, 34.0); SPACER_MM 3.00 (2.75, 3.25); TOP_ARM_KG 14.0 (13.0, 15.0).
  RF QUALITY: **U 10.5 (10.3, 10.8)**; CV 13.3 (13.0, 13.7); THIN 2 (—, 5); THICK 60 (—, 90); NEPS 90 (—, 130); IPI 152 (—, 220);
  H 5.8 (5.4, 6.3); CSP 2250 (2150, —); RKM 15.5 (14.8, —); ELONG 5.0 (4.5, 5.5); COUNT 30.0 (29.5, 30.5); COUNT_CV 1.5 (—, 2.0).
- AW PROCESS: WIND_SPEED 1200 (1100, 1300); SPLICE_STR 85 (80, —); CUTS_100KM 80 (—, 110).
  AW QUALITY: U 10.7 (10.4, 11.0); CV 13.6 (13.2, 14.0); THIN 3 (—, 6); THICK 70 (—, 100); NEPS 100 (—, 140); IPI 173 (—, 240);
  H 6.2 (5.8, 6.8); CSP 2200 (2100, —); RKM 15.2 (14.5, —); ELONG 4.8 (4.3, 5.4); CV1M 3.2 (—, 4.0); CV3M 2.5 (—, 3.2);
  CV10M 1.8 (—, 2.4); COUNT 30.0 (29.5, 30.5); COUNT_CV 1.5 (—, 2.0).
- 40CH / 20CH: same parameter set, plausibly scaled (finer count → higher U/IPI, lower CSP; COUNT std = ne).

**Lots**: 15 lots of 30CH, seq 175…189 (k = 0…14), start = 2026-09-15 + 2k days, planned 4500 kg, line by parity.
Stage day offsets from start: RM d0; BR d0–d1 (1 event/day on the line's BR); CARD d0–d3; DF d0–d3; FF d1–d4;
RF d1–d4; AW d2–d5; PACK d3–d6 (stop at businessDate 2026-10-16: lots 188/189 are IN_PRODUCTION, 187 PACKED).
Per day: one event per machine (4 cards, 4 DF, 4 FF, 6 RF, 4 AW), shift null; kg flow consistent with all mass-balance
rules (each stage processes ~¼ of upstream output per day, logged after upstream on the same day). Bales: ~32 per lot
(160–180 kg), 2 bales shared with the next lot; varieties Shankar-6 / MCU-5 / Bunny Bt; stations Rajkot / Adilabad /
Coimbatore; suppliers "Saurashtra Ginning Co." / "Telangana Cotton Traders" / "Kongu Cotton Agencies".
**Machine tests**: per machine per day per shift (A, B, C) for CARD, DF, FF, RF, AW (date = event date).
**LOT tests**: one per department per lot on the department's last day (values ≈ mean of machine tests, small noise).
Values: mostly green; ~6% of machine values yellow; isolated reds only where specified. Make RF U% depend on settings
(e.g. `U = 10.5 + 9·(BREAK_DRAFT − 1.18) + 2·|SPACER_MM − 3.0| + noise(0.07)`) so correlation analysis is meaningful.
Keep RF U% values ≥ 10.36 except planted cases (lower limit 10.30 is RED below).

**PLANTED FAULT (the AI must find it):** lot **182/2026** (line A, start 29/09), **RF M/c 3 (RF-3), D2 = 01/10/2026**:
production event BREAK_DRAFT **1.34** (std 1.18, RED), TOP_ARM_KG 13.6, notes `Preventive maintenance: top roller cots
changed; break-draft change gear replaced`. Machine tests that day: shifts A/B/C U% 12.48 / 12.71 / 12.63, CV% 15.7 / 16.1 / 15.9,
THIN 9 / 11 / 10, THICK 118 / 126 / 121, NEPS ~96, IPI accordingly; other RF-3 days and all other RF machines normal; FF/DF/CARD
on 30/09–01/10 normal (rules out upstream); bales normal (rules out RM); AW tests of lot 182 on 01/10–02/10 slightly elevated
(U 10.90–10.96 yellow, CV1M 3.85 yellow). Lot-level (LOT) results of 182: RF U 10.74 (yellow), RF CV 13.62 (yellow),
RF THIN 4.6 (yellow), AW U 10.84 (green), everything else green → **no lot-level red, gate passes with machine-level warnings**.

**Other quality story**: lot 179 LOT AW H 6.92 (RED) → ON_HOLD → QA override (reason "Customer Kaveri Weaves accepts
hairiness up to 7.0 for weaving; approved by QA Manager") → dispatched; lot 185 LOT RF COUNT_CV 2.31 (RED) → ON_HOLD, not
dispatched; lot 176 LOT RF NEPS 124 (yellow); lot 177 LOT RF COUNT 29.62 (yellow); lot 183 LOT RF CSP 2168 + RKM 14.92
(yellow); recent machine-level reds: lot 188 RF-5 D1 H 6.45; lot 189 FF-6 D1 U 4.95.

**Packing**: 50 kg packs, 30 cones/pack, per lot per pack day ≈ ¼ of AW output (whole packs). Lot 182 packs 4,400 kg (88 packs).
**QA override**: lot 179 on 2026-09-29.
**Dispatches** (date → lot → customer, kg): 22/09 175→Velan 2500; 24/09 176→Sri Lakshmi 3000; 26/09 177→Velan 2000;
28/09 178→Kaveri 2400; 30/09 179→Kaveri 1800 (override); 02/10 180→PD Textiles 2500; 04/10 181→Velan 2200;
07/10 182→Sri Lakshmi 1500; 08/10 183→Sri Lakshmi 2000; **09/10 182→PD Textiles 2000 (40 packs × 50 kg, 1200 cones,
vehicle TN 39 AB 4521, LR LR/26/7781) [full only]**; 10/10 184→Kaveri 2500; 14/10 186→Velan 2000. Dispatch seq starts at 101.
Each through evaluateGate → createDispatch → issuePassport.
**Complaints** (seq bumped so the first is 16): 16/2026 Sri Lakshmi, lot 176, IMPERFECTIONS, rcvd 02/10, RESOLVED;
17/2026 Velan, lot 177, COUNT_VARIATION, 03/10, RESOLVED; 18/2026 Kaveri, lot 179, HAIRINESS, 06/10, RESOLVED;
19/2026 PD Textiles, lot 180, PACKING, 08/10, UNDER_ANALYSIS; 20/2026 Velan, lot 181, SHADE, 10/10, OPEN;
21/2026 Sri Lakshmi, lot 183, STRENGTH, 12/10, UNDER_ANALYSIS; **22/2026 PD Textiles, lot 182, EVENNESS, 14/10, OPEN, with
PDF letter [full only]** — complainant "Mr. D. Prakash (QA Manager, PD Textiles)", description: "Barré / streaks observed
in single jersey fabric knitted from cones of lot 30CH 182 X/26 001 (invoice with dispatch of 09/10/2026). Approx. 6 rolls
affected. Request investigation and credit." Resolved complaints get realistic manual conclusions (QA user).
Seeded AI analyses (via the real engine, B2): complaints 16, 17, 18, 21 (one run each).
**PDF**: `server/lib/pdf.ts` writes a valid single-page PDF (Helvetica, text lines, correct xref) for the complaint letter;
store it in uploads and anchor via `AssetID.anchorDocument`.
Mark seeded notifications older than 3 days (vs businessDate) as read.

## 12. Developer view (GLOBAL REQUIREMENT B)

- Top bar: **Developer Mode** switch (persisted; default ON for DEVELOPER). When ON, every action shows an expandable
  **DevPanel** (inline under the form/button that triggered it, and in a global **Dev Tray** drawer listing the session's
  recent traces). DevPanel sections: summary (accepted/rejected + reason, action, user + role, timestamp, duration),
  contract invocations (contract.fn, payload JSON, checks list with ✓/✗), tx hash(es) + block # (links), validator approvals
  (4 rows, signature, latency), DB diff (before/after per row, changed fields highlighted), API request/response JSON,
  extra (AI: model, latency, prompt, input/output JSON; tamper: bypassed contracts).
- **Developer Console** page (`/developer`, tabs): Live Log (WS stream of traces, filter, pause), Block Explorer (blocks
  list → block detail with txs, merkle root, approvals; tx detail with payload, entity refs, merkle proof verification),
  Contracts (registry: functions, roles, rules, invocation counts; invocation history table), Integrity (Validate Chain
  button + report listing issues with block/tx/entity/field/expected/actual; Tamper simulation presets; Restore),
  API Explorer (route list; pick route, edit JSON body, send with current token, show response + trace), Audit Export
  (JSON/CSV download + table).
- Every record in the normal UI shows `OnChainBadge` ("Verified on-chain ✔ #1234" or red "Integrity mismatch ✖") linking
  to `/ledger/tx/:hash` (readable by all signed-in users).

## 13. Screens (mentor wireframes) — routes

| Route | Screen |
|---|---|
| `/login` | Sign-in: role cards (one per seeded user) |
| `/` | 1. Dashboard: sidebar + top bar (mill name, Dev Mode toggle, role switcher, notifications, theme, Demo). 2×3 tiles: Complaints (total + "N open" split), Lots in production, Quality alerts (red/yellow, last 7 days), Dispatches this month (count + kg), Ledger blocks/transactions, AI analyses completed. Tiles link to modules. Below: recent activity feed + quality trend chart (RF U% daily mean with green band/yellow zones/red points, legend). |
| `/complaints` | 2. Complaints list: Complaint No, Customer, Lot No, Type, Date, Status (color dot + icon + label). Filter by status (chips with counts), search, sort, pagination, "Register Complaint", CSV/PDF export. |
| `/complaints/new` | 3. Register Complaint: auto Complaint No (NN/YYYY, from `/next-number`), Name, Type (dropdown), Customer (dropdown), Lot No (autocomplete), Description, Doc (PDF upload; SHA-256 computed in the browser with WebCrypto, shown, then uploaded + anchored). Workflow steps indicator Complaint → Registered → Resolved. |
| `/complaints/:id` | 4. Complaint detail, tabs DETAILS · RESULTS · CONCLUSION (`?tab=`). Details: form data, linked lot/customer/dispatch info, PDF viewer (iframe), status timeline with tx badges. Results: lot test results (color-coded, QUALITY table) + latest AI analysis output (+ "Open AI Analysis"). Conclusion: rich text (tiptap) + root cause + corrective + preventive + "Resolve & Close" (QA). AI is advisory; human conclusion final. Export complaint report PDF. |
| `/lots`, `/lots/:id` | 5. Lot Tracking: search box (accepts `182/2026` or `30CH 182 X/26 001`), tabs PRODUCTION · QUALITY · DISPATCH & TRACE. PRODUCTION: stage cards RM/BR/CARD/DF/FF/RF/AW with "Std vs Lot" table per param (std, limits, lot mean, min–max, color) + per-machine breakdown, "Log production event" dialog. QUALITY: rows AW, RF, FF, DF, CARD × configurable columns (U%, CV%, Thin, Thick, Neps, IPI, H, CSP, RKM, Elong, CV1m, CV3m, CV10m; column picker), each cell colored, Test date, Tested by, on-chain badge; expand row → machine tests; "Enter test result" dialog. DISPATCH & TRACE: Production → Packing → Dispatch timeline with timestamps; backward trace (dispatch/cone → lot → machines → bales) and forward trace (bale → lots → customers, click a bale); interactive genealogy graph (@xyflow/react). |
| `/standards` | 6. Count-wise Quality Master: select count; table Department · Parameter · Std · Lower (−) · Upper (+) (+ unit, category, version, on-chain badge); add/edit/delete (ADMIN/QA) with reason; version history drawer; live preview of the color band. |
| `/analysis/heatmap` | 7. U% Analysis: select lot (+ department, parameter toggle U%/CV%/IPI/H…, day-wise/shift-wise toggle). Grid rows M/c 1…N, columns D1…Dn (or D1·A…), each cell value + color + icon; legend; click cell → "Move to Analysis" dialog → navigates to AI Analysis pre-filled (lot, dept, machine, day, shift, param, complaint if the lot has an open complaint). |
| `/analysis/ai` | 8. AI Complaint Analysis: left "List of Lots" (≤ 15 selectable comparison lots, same count/period, with color chips); right-top ANALYSIS panel (context chips, Run / Re-run, version selector, banner when LLM disabled, cards: deviations ranked, suspected stage/machine/day/shift, evidence, root causes with confidence bars, recall scope, recommended actions, narrative); right-bottom CONCLUSION (manual) panel → writes to the complaint conclusion (or links to complaint Conclusion tab). Dev panel shows prompt/input/output/model/latency. |
| `/dispatch`, `/dispatch/new`, `/dispatch/:id` | 9. Dispatch: list + form (Customer, Count, Quantity, Date DD/MM/YYYY, Lot No(s), pack weight → auto packs (2000 ÷ 50 = 40), cones, vehicle, LR). Live gate-check panel (blocked/red with reasons + "QA override" for QA role; machine-level warnings). On success: QR Product Passport card (qrcode.react) linking to `/passport/:code`. Detail shows Production → Packing → Dispatch chain. |
| `/passport/:code`, `/verify` | Public Product Passport (no login, no app shell): lot, color-coded quality, certifications (marked demo), journey, ledger proof (block, merkle proof ✔, validator approvals). `/verify`: enter/scan passport code. |
| `/developer`, `/ledger/tx/:hash`, `/ledger/block/:n` | Developer Console (§12) + explorer detail pages. |
| `/showcase` | 10. Project Showcase: problem statement, objectives, 5-layer architecture diagram, bale-to-cone flow, roadmap Jul 2026 – Mar 2027 (Title Selection, Literature Review, Study of Spinning Mill, Solution Proposal, Validation & Finalization, Implementation & Software Development), team (Devaprasath P, Nandiesh R V, Nikitha Y, Pavishna Dhaniya R), guide (Pavendhan A, Associate Dean, Dept. of Textile Technology). |
| `/settings` | Admin: mill name, lot number/code formats with live preview, warn fraction, business date, quality columns; users & roles matrix (read-only). |

5-layer architecture: (1) Presentation (React dashboard, QR passport), (2) Application/API (Express, WebSocket, auth/RBAC),
(3) Smart-contract layer (AssetID, ProcessEvent, Quality, Transfer, Access), (4) Permissioned ledger (blocks, Merkle,
validators 3-of-4, LedgerService adapter → Fabric/Besu), (5) Data & integration (SQLite world state, off-chain docs anchored
by SHA-256, AI analysis engine + LLM narrative, lab instruments/MES feeds).

## 14. Demo Mode (client `src/demo/*`)

Top-bar "Demo" button opens a panel: **Run scripted demo**, **Reset demo data** (profile full), step list with status,
captions overlay, speed control, pause/next. The runner uses the real API (as the right role — it logs in as each role in
turn) and navigates to each screen, highlighting elements (`data-demo="..."` attributes):
0. Reset to `pre-demo` (as admin).
1. Dispatch (as `dispatch`): open `/dispatch/new`, fill PD Textiles · 30 CH · lot 182/2026 · 2000 kg · 09/10/2026 · 50 kg
   packs → 40 packs · 1200 cones · TN 39 AB 4521 · LR/26/7781 → submit → toast with tx hash → passport QR.
2. Complaint (as `cs`): `/complaints/new` → fill 22/2026 (complainant, EVENNESS, PD Textiles, lot 182/2026, description),
   generate the complaint letter PDF in the browser (jsPDF), hash it (WebCrypto), upload + anchor → register → list shows RED.
3. Trace: complaint detail → Details (dispatch link) → Lot 182/2026 DISPATCH & TRACE (genealogy graph) → QUALITY (RF row yellow).
4. Heatmap: `/analysis/heatmap?lotId=…&department=RF&parameter=U` → highlight M/c 3 · D2 RED → click → Move to Analysis.
5. AI (as `qa`): `/analysis/ai?...` pre-filled → Run → root cause RF M/c 3 break draft; complaint turns YELLOW.
6. Conclusion (as `qa`): complaint Conclusion tab → fill manual conclusion → Resolve & Close → GREEN.
7. Developer (as `dev`): `/developer` Live Log shows every tx → Integrity: Validate Chain ✔ → Tamper "hide bad result" →
   Validate ✖ (shows block #, test_result id, field `values_json.U`, expected 12.71, actual 10.52) → Restore → Validate ✔.
Pages must accept prefill via URL params (`/dispatch/new?customerId=&lotIds=&qty=&date=&packWeight=&cones=&vehicle=&lr=`,
`/complaints/new?customerId=&lotId=&type=&name=&description=`, analysis params) so the runner can drive the real forms.

## 15. UI/UX

shadcn/ui look (neutral enterprise), light/dark (class strategy, toggle in top bar), responsive (tablet-first shopfloor:
sidebar collapses < 1024 px to a sheet), consistent Card/Table styles, skeleton loaders on every query, `sonner` toasts that
show `tx 0xabc… · block #1234` (clickable), CSV + PDF export on every table and the complaint report (jsPDF + autotable with
colored cells + OK/WARN/OUT text), keyboard navigation, ARIA labels on icon buttons, focus rings, color + icon + text for
every status. Framer Motion for subtle page/tile transitions only. No console errors or React key warnings.

## 16. Tests (vitest, `tests/unit/`)

`ledger.test.ts` (tx/block hashing, merkle root/proof, chain links, signatures/quorum, validateLedger detects edits),
`quality.test.ts` (green/yellow/red boundaries incl. spec example 10.5/10.3/10.8, one-sided, degenerate),
`format.test.ts`, `contracts.test.ts` (permission denial recorded as INVALID tx; stage order; mass balance; tolerance
notes; gate blocks red without override; complaint workflow), `analysis.test.ts` (engine on seeded data finds RF-3 D2 +
RF_BREAK_DRAFT top cause; numeric guard rejects invented numbers), `integrity.test.ts` (tamper presets detected with exact
field; restore → valid), `api.test.ts` (supertest smoke: login, list, write with trace, 401/403). Use in-memory DB
(`openDb(':memory:')` + `setDb`) and seed profiles in tests.
