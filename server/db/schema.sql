-- TexTrace SQLite schema (off-chain world state + simulated permissioned ledger).
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

CREATE TABLE IF NOT EXISTS counts (
  id      TEXT PRIMARY KEY,               -- '30CH'
  label   TEXT NOT NULL,                  -- '30s Carded Hosiery'
  display TEXT NOT NULL,                  -- '30 CH'
  ne      REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id           TEXT PRIMARY KEY,          -- 'CUST-PDT'
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  city         TEXT NOT NULL,
  contact_name TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS machines (
  id          TEXT PRIMARY KEY,           -- 'RF-3'
  department  TEXT NOT NULL,
  machine_no  INTEGER NOT NULL,
  label       TEXT NOT NULL,              -- 'RF M/c 3'
  line        TEXT,                       -- 'A' | 'B' | NULL
  make        TEXT NOT NULL DEFAULT '',
  model       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (department, machine_no)
);

CREATE TABLE IF NOT EXISTS bales (
  id           TEXT PRIMARY KEY,          -- 'BALE-0412'
  bale_no      TEXT NOT NULL UNIQUE,      -- 'B26-0412'
  supplier     TEXT NOT NULL,
  station      TEXT NOT NULL,
  variety      TEXT NOT NULL,
  gin_lot      TEXT NOT NULL,
  weight_kg    REAL NOT NULL,
  remaining_kg REAL NOT NULL,
  arrival_date TEXT NOT NULL,
  fibre        TEXT NOT NULL,             -- JSON { MIC, UHML, UI, STR, SFI, TRASH, MOIST }
  created_at   TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lots (
  id           TEXT PRIMARY KEY,          -- 'LOT-182-2026'
  lot_no       TEXT NOT NULL UNIQUE,      -- '182/2026'
  lot_code     TEXT NOT NULL UNIQUE,      -- '30CH 182 X/26 001'
  seq          INTEGER NOT NULL,
  year         INTEGER NOT NULL,
  count_id     TEXT NOT NULL REFERENCES counts(id),
  line         TEXT NOT NULL,             -- 'A' | 'B' (production line / machine group)
  status       TEXT NOT NULL,             -- LotStatus
  planned_kg   REAL NOT NULL,
  start_date   TEXT NOT NULL,
  end_date     TEXT,
  created_at   TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1
);
-- NOTE: produced_kg / packed_kg / dispatched_kg / current_stage are DERIVED in services from events/packing/dispatch_lots.

CREATE TABLE IF NOT EXISTS lot_bales (
  id       TEXT PRIMARY KEY,              -- 'LB-<lot>-<bale>'
  lot_id   TEXT NOT NULL REFERENCES lots(id),
  bale_id  TEXT NOT NULL REFERENCES bales(id),
  kg_used  REAL NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (lot_id, bale_id)
);

CREATE TABLE IF NOT EXISTS production_events (
  id          TEXT PRIMARY KEY,           -- 'PE-000123'
  lot_id      TEXT NOT NULL REFERENCES lots(id),
  department  TEXT NOT NULL,
  machine_id  TEXT REFERENCES machines(id),
  event_date  TEXT NOT NULL,
  day_index   INTEGER NOT NULL,
  shift       TEXT,
  input_kg    REAL NOT NULL,
  output_kg   REAL NOT NULL,
  waste_kg    REAL NOT NULL,
  params      TEXT NOT NULL,              -- JSON { CYL_RPM: 450, ... }
  notes       TEXT NOT NULL DEFAULT '',
  operator_id TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_pe_lot ON production_events(lot_id, department);
CREATE INDEX IF NOT EXISTS idx_pe_machine ON production_events(machine_id, event_date);

CREATE TABLE IF NOT EXISTS test_results (
  id          TEXT PRIMARY KEY,           -- 'TR-000123'
  lot_id      TEXT NOT NULL REFERENCES lots(id),
  department  TEXT NOT NULL,
  machine_id  TEXT REFERENCES machines(id),
  sample_type TEXT NOT NULL,              -- 'LOT' | 'MACHINE'
  test_date   TEXT NOT NULL,
  day_index   INTEGER,
  shift       TEXT,
  values_json TEXT NOT NULL,              -- JSON { U: 10.52, CV: 13.3, ... }
  instrument  TEXT NOT NULL DEFAULT '',
  tested_by   TEXT NOT NULL,
  remarks     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_tr_lot ON test_results(lot_id, department, sample_type);
CREATE INDEX IF NOT EXISTS idx_tr_date ON test_results(test_date);

CREATE TABLE IF NOT EXISTS standards (
  id          TEXT PRIMARY KEY,           -- 'STD-30CH-RF-U'
  count_id    TEXT NOT NULL REFERENCES counts(id),
  department  TEXT NOT NULL,
  parameter   TEXT NOT NULL,
  category    TEXT NOT NULL,              -- 'FIBRE' | 'PROCESS' | 'QUALITY'
  std         REAL NOT NULL,
  lower_limit REAL,
  upper_limit REAL,
  unit        TEXT NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1,
  updated_by  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (count_id, department, parameter)
);

CREATE TABLE IF NOT EXISTS standards_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  standard_id  TEXT NOT NULL REFERENCES standards(id),
  version      INTEGER NOT NULL,
  change_type  TEXT NOT NULL,             -- 'CREATE' | 'UPDATE' | 'DELETE'
  std          REAL NOT NULL,
  lower_limit  REAL,
  upper_limit  REAL,
  reason       TEXT NOT NULL DEFAULT '',
  changed_by   TEXT NOT NULL,
  changed_at   TEXT NOT NULL,
  tx_hash      TEXT,
  block_number INTEGER
);

CREATE TABLE IF NOT EXISTS packing (
  id             TEXT PRIMARY KEY,        -- 'PK-000123'
  lot_id         TEXT NOT NULL REFERENCES lots(id),
  pack_date      TEXT NOT NULL,
  pack_weight_kg REAL NOT NULL,
  packs_count    INTEGER NOT NULL,
  cones_per_pack INTEGER NOT NULL,
  total_kg       REAL NOT NULL,
  pack_from      TEXT NOT NULL,           -- 'P182-0001'
  pack_to        TEXT NOT NULL,
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL,
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
  dispatch_no    TEXT NOT NULL UNIQUE,    -- 'DSP/2026/0112'
  customer_id    TEXT NOT NULL REFERENCES customers(id),
  count_id       TEXT NOT NULL REFERENCES counts(id),
  quantity_kg    REAL NOT NULL,
  dispatch_date  TEXT NOT NULL,
  pack_weight_kg REAL NOT NULL,
  packs_count    INTEGER NOT NULL,
  cones_count    INTEGER NOT NULL,
  vehicle_no     TEXT NOT NULL,
  lr_no          TEXT NOT NULL,
  invoice_no     TEXT NOT NULL DEFAULT '',
  gate           TEXT NOT NULL,           -- JSON GateResult at dispatch time
  override_ids   TEXT NOT NULL DEFAULT '[]', -- JSON string[]
  passport_code  TEXT NOT NULL,
  status         TEXT NOT NULL,           -- 'DISPATCHED' | 'DELIVERED'
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS dispatch_lots (
  id          TEXT PRIMARY KEY,           -- 'DL-<dispatch>-<lot>'
  dispatch_id TEXT NOT NULL REFERENCES dispatches(id),
  lot_id      TEXT NOT NULL REFERENCES lots(id),
  quantity_kg REAL NOT NULL,
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
  id                 TEXT PRIMARY KEY,    -- 'AN-0005'
  complaint_id       TEXT REFERENCES complaints(id),
  lot_id             TEXT NOT NULL REFERENCES lots(id),
  run_no             INTEGER NOT NULL,    -- run version 1,2,3... per complaint (or per lot when no complaint)
  context            TEXT NOT NULL,       -- JSON AnalysisContext
  comparison_lot_ids TEXT NOT NULL,       -- JSON string[]
  result             TEXT NOT NULL,       -- JSON AnalysisResult
  input_hash         TEXT NOT NULL,       -- sha256(canonical(engine input dataset digest))
  output_hash        TEXT NOT NULL,       -- sha256(canonical(result))
  llm                TEXT NOT NULL,       -- JSON LlmMeta
  created_by         TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1
);
-- analyses are immutable: each re-run inserts a new row with run_no + 1 (AnalysisRun.version = run_no).

CREATE TABLE IF NOT EXISTS conclusions (
  id                TEXT PRIMARY KEY,     -- 'CON-0003'
  complaint_id      TEXT NOT NULL UNIQUE REFERENCES complaints(id),
  analysis_id       TEXT REFERENCES analyses(id),
  conclusion_html   TEXT NOT NULL,
  root_cause        TEXT NOT NULL,
  corrective_action TEXT NOT NULL,
  preventive_action TEXT NOT NULL,
  concluded_by      TEXT NOT NULL,
  concluded_at      TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, record_hash TEXT, version INTEGER NOT NULL DEFAULT 1
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
  trace        TEXT NOT NULL              -- JSON DevTrace
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(timestamp);

CREATE TABLE IF NOT EXISTS tamper_log (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  kind       TEXT NOT NULL,               -- 'record' | 'block'
  target     TEXT NOT NULL,               -- JSON
  before     TEXT NOT NULL,               -- JSON (original column value(s))
  after      TEXT NOT NULL,               -- JSON
  restored   INTEGER NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------------ ledger (simulated permissioned chain)
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
CREATE INDEX IF NOT EXISTS idx_tx_contract ON ledger_txs(contract, fn);

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
CREATE INDEX IF NOT EXISTS idx_anchor_entity ON entity_anchors(entity_type, entity_id);
