-- TexTrace v2 schema (off-chain world state + simulated permissioned ledger).
-- Every business entity table carries the 4 anchor columns:
--   tx_hash      : hash of the ledger tx that last wrote this row
--   block_number : block containing that tx
--   record_hash  : SHA-256 of the canonical business snapshot (see server/db/entities.ts) at `version`
--   version      : increments on every contract write
-- Anchor columns are NOT part of the record hash. Validate Chain re-hashes rows and compares to entity_anchors + the chain.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sequences (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL -- JSON
);

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,           -- 'U-QA'
  username    TEXT NOT NULL UNIQUE,       -- 'qa'
  name        TEXT NOT NULL,
  role        TEXT NOT NULL,
  org         TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  customer_id TEXT                        -- BUYER only
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  severity   TEXT NOT NULL,               -- 'info' | 'warning' | 'critical'
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  link       TEXT,
  created_at TEXT NOT NULL,
  read       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
  action_id    TEXT PRIMARY KEY,
  timestamp    TEXT NOT NULL,
  user_id      TEXT,
  username     TEXT,
  role         TEXT,
  action       TEXT NOT NULL,
  label        TEXT NOT NULL,
  method       TEXT NOT NULL,
  path         TEXT NOT NULL,
  accepted     INTEGER NOT NULL,
  reason       TEXT,
  contracts    TEXT NOT NULL DEFAULT '[]', -- JSON ["Quality.registerComplaint", ...]
  tx_hashes    TEXT NOT NULL DEFAULT '[]', -- JSON string[]
  block_number INTEGER,
  refs         TEXT NOT NULL DEFAULT '',  -- space-separated lookup tokens: 'LOT-101 MIX-001 BALE-9023 RF-6'
  trace        TEXT NOT NULL              -- JSON DevTrace
);

CREATE TABLE IF NOT EXISTS tamper_log (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  kind       TEXT NOT NULL,               -- 'record' | 'block'
  target     TEXT NOT NULL,               -- JSON
  before     TEXT NOT NULL,               -- JSON (original column value(s))
  after      TEXT NOT NULL,               -- JSON
  restored   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ledger_blocks (
  number      INTEGER PRIMARY KEY,
  timestamp   TEXT NOT NULL,
  prev_hash   TEXT NOT NULL,
  merkle_root TEXT NOT NULL,
  hash        TEXT NOT NULL UNIQUE,
  tx_count    INTEGER NOT NULL,
  proposer    TEXT NOT NULL,
  approvals   TEXT NOT NULL               -- JSON ValidatorApproval[]
);

CREATE TABLE IF NOT EXISTS ledger_txs (
  tx_hash      TEXT PRIMARY KEY,
  block_number INTEGER NOT NULL REFERENCES ledger_blocks(number),
  idx          INTEGER NOT NULL,
  timestamp    TEXT NOT NULL,
  contract     TEXT NOT NULL,
  fn           TEXT NOT NULL,
  payload      TEXT NOT NULL,             -- JSON
  actor_id     TEXT NOT NULL,
  actor_role   TEXT NOT NULL,
  status       TEXT NOT NULL,             -- 'VALID' | 'INVALID'
  reason       TEXT,
  entity_refs  TEXT NOT NULL,             -- JSON EntityRef[]
  nonce        TEXT NOT NULL,
  field_digests TEXT NOT NULL DEFAULT '{}', -- JSON { 'payload.lots': sha256, 'contract': sha256, ... } — pinpoints the edited field on TX_HASH_MISMATCH
  UNIQUE (block_number, idx)
);

CREATE TABLE IF NOT EXISTS entity_anchors (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  version      INTEGER NOT NULL,
  record_hash  TEXT NOT NULL,
  tx_hash      TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (entity_type, entity_id, version)
);

-- ====================================================================== v2 domain
CREATE TABLE IF NOT EXISTS counts (
  id          TEXT PRIMARY KEY,           -- '40CH'
  label       TEXT NOT NULL,              -- '40s Carded Hosiery'
  display     TEXT NOT NULL,              -- '40s CH'
  ne          REAL NOT NULL,
  uses_comber INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS customers (
  id           TEXT PRIMARY KEY,          -- 'CUST-PDT'
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  city         TEXT NOT NULL,
  contact_name TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  phone        TEXT NOT NULL DEFAULT '',
  address      TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id          TEXT PRIMARY KEY,           -- 'ORD-2026-014'
  order_no    TEXT NOT NULL UNIQUE,
  po_no       TEXT NOT NULL DEFAULT '',
  customer_id TEXT NOT NULL REFERENCES customers(id),
  count_id    TEXT NOT NULL REFERENCES counts(id),
  qty_kg      REAL NOT NULL,
  ordered_at  TEXT NOT NULL,
  due_date    TEXT NOT NULL,
  status      TEXT NOT NULL               -- 'OPEN' | 'PARTIAL' | 'COMPLETE'
);

CREATE TABLE IF NOT EXISTS machines (
  id          TEXT PRIMARY KEY,           -- 'RF-6'
  department  TEXT NOT NULL,              -- Stage code
  machine_no  INTEGER NOT NULL,
  label       TEXT NOT NULL,              -- 'RF 6'
  line        TEXT,
  make        TEXT NOT NULL DEFAULT '',
  model       TEXT NOT NULL DEFAULT '',
  spindles    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (department, machine_no)
);

CREATE TABLE IF NOT EXISTS bales (
  id           TEXT PRIMARY KEY,          -- 'BALE-9023'
  bale_no      TEXT NOT NULL UNIQUE,      -- '9023'
  supplier     TEXT NOT NULL,
  station      TEXT NOT NULL,
  variety      TEXT NOT NULL,
  gin_lot      TEXT NOT NULL,
  weight_kg    REAL NOT NULL,
  remaining_kg REAL NOT NULL,
  received_at  TEXT NOT NULL,
  bay          TEXT NOT NULL,             -- 'Bay B'
  bin          TEXT NOT NULL,             -- 'B-14'
  status       TEXT NOT NULL,             -- 'IN_STORE' | 'ISSUED'
  issued_at    TEXT,
  mix_id       TEXT,                      -- reserved (IN_STORE) or consumed (ISSUED) mix
  fibre        TEXT NOT NULL,             -- JSON { MIC, UHML, UI, STR, SFI, TRASH, MOIST, RD, PLUS_B }
  created_at   TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS mixes (
  id                TEXT PRIMARY KEY,     -- 'MIX-001'
  mix_no            TEXT NOT NULL UNIQUE, -- 'M-001'
  count_id          TEXT NOT NULL REFERENCES counts(id),
  status            TEXT NOT NULL,        -- 'PLANNED' | 'ISSUED'
  planned_at        TEXT NOT NULL,
  issued_at         TEXT,
  total_kg          REAL NOT NULL,
  recipe            TEXT NOT NULL,        -- JSON actual components [{ key, label, source, pct, kg }]
  fibre             TEXT NOT NULL,        -- JSON weighted HVI of the bale part
  master_version_id TEXT,                 -- Count & Mix master version the recipe was checked against
  blow_room_line    TEXT,
  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS mix_bales (
  id      TEXT PRIMARY KEY,               -- 'MB-MIX-001-BALE-9023'
  mix_id  TEXT NOT NULL REFERENCES mixes(id),
  bale_id TEXT NOT NULL REFERENCES bales(id),
  kg_used REAL NOT NULL,
  pct     REAL NOT NULL,                  -- % of the whole mix
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (mix_id, bale_id)
);

CREATE TABLE IF NOT EXISTS lots (
  id             TEXT PRIMARY KEY,        -- 'LOT-101'
  lot_no         TEXT NOT NULL UNIQUE,    -- '101'
  lot_code       TEXT NOT NULL UNIQUE,    -- '40CH-101'
  seq            INTEGER NOT NULL,
  year           INTEGER NOT NULL,
  count_id       TEXT NOT NULL REFERENCES counts(id),
  mix_id         TEXT NOT NULL REFERENCES mixes(id),
  line           TEXT NOT NULL,
  status         TEXT NOT NULL,           -- 'IN_PRODUCTION' | 'PACKED' | 'DISPATCHED' | 'DELIVERED' | 'ON_HOLD'
  planned_kg     REAL NOT NULL,           -- cotton input planned for the lot
  start_date     TEXT NOT NULL,
  end_date       TEXT,
  qa_release_at  TEXT,
  qa_release_by  TEXT,
  created_at     TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_lots_count ON lots(count_id);
CREATE INDEX IF NOT EXISTS idx_lots_mix ON lots(mix_id);

CREATE TABLE IF NOT EXISTS stage_runs (
  id           TEXT PRIMARY KEY,          -- 'SR-000123'
  lot_id       TEXT NOT NULL REFERENCES lots(id),
  stage        TEXT NOT NULL,
  machine_id   TEXT REFERENCES machines(id),
  location     TEXT,                      -- bay / gate for non-machine stages
  shift        TEXT,
  operator_id  TEXT,
  in_at        TEXT NOT NULL,
  out_at       TEXT,
  input_kg     REAL NOT NULL,
  output_kg    REAL NOT NULL,
  waste_kg     REAL NOT NULL,
  waste_type   TEXT,
  batch_ref    TEXT,                      -- 'CS-M001-C07' sliver / roving batch produced
  input_refs   TEXT NOT NULL DEFAULT '[]',-- JSON batch refs consumed
  params       TEXT NOT NULL,             -- JSON actual production parameters
  accessories  TEXT NOT NULL DEFAULT '{}',-- JSON accessory ages at run start { TRAVELLER_AGE_DAYS: 29, ... , specs: {...} }
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_sr_lot ON stage_runs(lot_id, stage);
CREATE INDEX IF NOT EXISTS idx_sr_machine ON stage_runs(machine_id, in_at);

CREATE TABLE IF NOT EXISTS test_results (
  id          TEXT PRIMARY KEY,           -- 'TR-000123'
  sample_id   TEXT NOT NULL,              -- 'S-101-RF6-A-03'
  lot_id      TEXT NOT NULL REFERENCES lots(id),
  stage       TEXT NOT NULL,
  machine_id  TEXT REFERENCES machines(id),
  sample_type TEXT NOT NULL,              -- 'LOT' | 'MACHINE'
  pos         TEXT,                       -- side / doff / drum / can
  test_date   TEXT NOT NULL,
  tested_at   TEXT NOT NULL,
  shift       TEXT,
  values_json TEXT NOT NULL,
  instrument  TEXT NOT NULL DEFAULT '',
  tested_by   TEXT NOT NULL,
  remarks     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_tr_lot ON test_results(lot_id, stage);
CREATE INDEX IF NOT EXISTS idx_tr_machine ON test_results(machine_id, test_date);
CREATE INDEX IF NOT EXISTS idx_tr_date ON test_results(test_date);

CREATE TABLE IF NOT EXISTS master_versions (
  id             TEXT PRIMARY KEY,        -- 'MV-40CH-QUALITY-2'
  master_type    TEXT NOT NULL,           -- COUNT_MIX | QUALITY | PRODUCTION | ACCESSORIES | COLOR
  count_id       TEXT NOT NULL REFERENCES counts(id),
  version_no     INTEGER NOT NULL,
  status         TEXT NOT NULL,           -- DRAFT | QA_APPROVED | ACTIVE | SUPERSEDED | REJECTED
  effective_from TEXT,                    -- YYYY-MM-DD (null until activated)
  effective_to   TEXT,
  meta           TEXT NOT NULL DEFAULT '{}', -- JSON: recipe/route/targets | packing spec | colour
  note           TEXT NOT NULL DEFAULT '',
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  approved_by    TEXT,
  approved_at    TEXT,
  activated_by   TEXT,
  activated_at   TEXT,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (master_type, count_id, version_no)
);
CREATE INDEX IF NOT EXISTS idx_mv_lookup ON master_versions(count_id, master_type, status);

CREATE TABLE IF NOT EXISTS master_items (
  id          TEXT PRIMARY KEY,           -- 'MI-<version>-<scope>-<param>'
  version_id  TEXT NOT NULL REFERENCES master_versions(id),
  master_type TEXT NOT NULL,
  count_id    TEXT NOT NULL,
  scope       TEXT NOT NULL,              -- Stage code or 'MIX'
  parameter   TEXT NOT NULL,
  std         REAL NOT NULL,
  lower_limit REAL,
  upper_limit REAL,
  unit        TEXT NOT NULL DEFAULT '',
  frequency   TEXT NOT NULL DEFAULT '',
  instrument  TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (version_id, scope, parameter)
);
CREATE INDEX IF NOT EXISTS idx_mi_version ON master_items(version_id);

CREATE TABLE IF NOT EXISTS complaint_lens (
  id             TEXT PRIMARY KEY,        -- 'LENS-HAIRINESS'
  complaint_type TEXT NOT NULL UNIQUE,
  items          TEXT NOT NULL,           -- JSON [{ stage, key, weight, why }]
  updated_by     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS accessory_changes (
  id         TEXT PRIMARY KEY,            -- 'AC-000045'
  machine_id TEXT NOT NULL REFERENCES machines(id),
  kind       TEXT NOT NULL,               -- TRAVELLER | COT | COT_BUFF | APRON | SPACER | CARD_WIRE | FLAT_GRIND
  spec       TEXT NOT NULL DEFAULT '',    -- 'C1 EL 4/0' | '2.50 mm'
  value      REAL,                        -- numeric spec (spacer mm)
  changed_at TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_ac_machine ON accessory_changes(machine_id, kind, changed_at);

CREATE TABLE IF NOT EXISTS packing (
  id            TEXT PRIMARY KEY,         -- 'PK-000012'
  lot_id        TEXT NOT NULL REFERENCES lots(id),
  packed_at     TEXT NOT NULL,
  packer_id     TEXT NOT NULL,
  package_type  TEXT NOT NULL,            -- 'CONE' | 'CHEESE'
  cones_packed  INTEGER NOT NULL,
  partial_cones INTEGER NOT NULL DEFAULT 0, -- cones in the last, partly filled carton (0 = all cartons full)
  cartons       INTEGER NOT NULL,       -- full cartons + the part carton
  net_kg        REAL NOT NULL,
  tare_kg       REAL NOT NULL,
  gross_kg      REAL NOT NULL,
  avg_cone_kg   REAL NOT NULL,
  color_actual  TEXT NOT NULL,
  color_master  TEXT NOT NULL,
  color_ok      INTEGER NOT NULL,
  slip_no       TEXT NOT NULL,
  carton_from   TEXT NOT NULL,            -- 'C-101-001'
  carton_to     TEXT NOT NULL,
  label_template TEXT NOT NULL DEFAULT '',
  pallets       INTEGER NOT NULL DEFAULT 0,
  fg_location   TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS qa_overrides (
  id          TEXT PRIMARY KEY,           -- 'OVR-0003'
  lot_id      TEXT NOT NULL REFERENCES lots(id),
  reason      TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS dispatches (
  id             TEXT PRIMARY KEY,        -- 'DSP-2026-0112'
  dispatch_no    TEXT NOT NULL UNIQUE,
  customer_id    TEXT NOT NULL REFERENCES customers(id),
  order_id       TEXT,
  count_id       TEXT NOT NULL REFERENCES counts(id),
  quantity_kg    REAL NOT NULL,
  dispatch_date  TEXT NOT NULL,
  dispatched_at  TEXT NOT NULL,
  invoice_no     TEXT NOT NULL,
  invoice_date   TEXT NOT NULL,
  vehicle_no     TEXT NOT NULL,
  driver_name    TEXT NOT NULL,
  driver_phone   TEXT NOT NULL DEFAULT '',
  transporter    TEXT NOT NULL,
  lr_no          TEXT NOT NULL,
  destination    TEXT NOT NULL,
  cartons        INTEGER NOT NULL,
  cones_count    INTEGER NOT NULL,
  net_kg         REAL NOT NULL,
  gross_kg       REAL NOT NULL,
  delivered_at   TEXT,
  gate           TEXT NOT NULL,           -- JSON GateResult at dispatch time
  override_ids   TEXT NOT NULL DEFAULT '[]',
  qa_released    INTEGER NOT NULL DEFAULT 1,
  passport_code  TEXT NOT NULL,
  status         TEXT NOT NULL,           -- 'DISPATCHED' | 'DELIVERED'
  remarks        TEXT NOT NULL DEFAULT '',
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_dsp_customer ON dispatches(customer_id);

CREATE TABLE IF NOT EXISTS dispatch_lots (
  id          TEXT PRIMARY KEY,           -- 'DL-<dispatch>-<lot>'
  dispatch_id TEXT NOT NULL REFERENCES dispatches(id),
  lot_id      TEXT NOT NULL REFERENCES lots(id),
  quantity_kg REAL NOT NULL,
  cartons     INTEGER NOT NULL DEFAULT 0,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_dl_lot ON dispatch_lots(lot_id);

CREATE TABLE IF NOT EXISTS passports (
  code        TEXT PRIMARY KEY,           -- 'PP-7F3A9C21'
  dispatch_id TEXT NOT NULL REFERENCES dispatches(id),
  issued_at   TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS documents (
  id           TEXT PRIMARY KEY,          -- 'DOC-0007'
  sha256       TEXT NOT NULL,
  filename     TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  storage_path TEXT NOT NULL,             -- relative to server/data/uploads
  ref_type     TEXT NOT NULL DEFAULT '',  -- 'complaint'
  ref_id       TEXT NOT NULL DEFAULT '',
  uploaded_by  TEXT NOT NULL,
  uploaded_at  TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS complaints (
  id               TEXT PRIMARY KEY,      -- 'CMP-22-2026'
  complaint_no     TEXT NOT NULL UNIQUE,  -- '22/2026'
  seq              INTEGER NOT NULL,
  year             INTEGER NOT NULL,
  complainant_name TEXT NOT NULL,
  type             TEXT NOT NULL,         -- ComplaintType
  source           TEXT NOT NULL,         -- 'PORTAL' | 'MILL'
  customer_id      TEXT NOT NULL REFERENCES customers(id),
  lot_id           TEXT NOT NULL REFERENCES lots(id),
  dispatch_id      TEXT REFERENCES dispatches(id),
  description      TEXT NOT NULL,
  document_id      TEXT REFERENCES documents(id),
  status           TEXT NOT NULL,         -- 'OPEN' | 'UNDER_ANALYSIS' | 'RESOLVED'
  received_date    TEXT NOT NULL,
  created_by       TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (seq, year)
);
CREATE INDEX IF NOT EXISTS idx_cmp_lot ON complaints(lot_id);
CREATE INDEX IF NOT EXISTS idx_cmp_customer ON complaints(customer_id);

CREATE TABLE IF NOT EXISTS complaint_events (
  id           TEXT PRIMARY KEY,          -- 'CE-000031'
  complaint_id TEXT NOT NULL REFERENCES complaints(id),
  from_status  TEXT,
  to_status    TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  by_user_id   TEXT NOT NULL,
  at           TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS analyses (
  id                 TEXT PRIMARY KEY,    -- 'AN-0001-101'
  complaint_id       TEXT REFERENCES complaints(id),
  lot_id             TEXT NOT NULL REFERENCES lots(id),
  run_no             INTEGER NOT NULL,
  context            TEXT NOT NULL,       -- JSON
  comparison_lot_ids TEXT NOT NULL,       -- JSON string[]
  result             TEXT NOT NULL,       -- JSON AnalysisResult
  input_hash         TEXT NOT NULL,
  output_hash        TEXT NOT NULL,
  llm                TEXT NOT NULL,       -- JSON LlmMeta
  created_by         TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1
);
-- analyses are immutable: each re-run inserts a new row with run_no + 1.

CREATE TABLE IF NOT EXISTS conclusions (
  id                TEXT PRIMARY KEY,     -- 'CON-0003'
  complaint_id      TEXT NOT NULL UNIQUE REFERENCES complaints(id),
  analysis_id       TEXT REFERENCES analyses(id),
  conclusion_html   TEXT NOT NULL,
  root_cause        TEXT NOT NULL,
  corrective_action TEXT NOT NULL,
  preventive_action TEXT NOT NULL,
  customer_reply    TEXT NOT NULL DEFAULT '',
  concluded_by      TEXT NOT NULL,
  concluded_at      TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_tx_contract ON ledger_txs(contract, fn);
CREATE INDEX IF NOT EXISTS idx_anchor_entity ON entity_anchors(entity_type, entity_id);


-- PDF Import staging: extracted content is reviewed before mapping to mill records.
CREATE TABLE IF NOT EXISTS pdf_import_jobs (
  id             TEXT PRIMARY KEY,
  file_name      TEXT NOT NULL,
  source_sha256  TEXT NOT NULL,
  page_count     INTEGER NOT NULL DEFAULT 0,
  file_size      INTEGER NOT NULL DEFAULT 0,
  extracted_text TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'PREVIEW',
  uploaded_by    TEXT NOT NULL,
  uploaded_at    TEXT NOT NULL,
  reviewed_by    TEXT,
  reviewed_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_pdf_import_uploaded_at
  ON pdf_import_jobs(uploaded_at);
