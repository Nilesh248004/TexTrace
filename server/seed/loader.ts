import type { DB } from '../db';
import type { LedgerService, PendingTx } from '../ledger/types';
import { entityDef, recordHashOf, snapshotOf } from '../db/entities';

const USERS = [
  ['U-ADMIN', 'admin', 'R. Senthil Kumar', 'ADMIN', 'MillOrg', 'Mill Admin', null],
  ['U-DEV', 'dev', 'A. Karthik', 'DEVELOPER', 'MillOrg', 'Blockchain Developer', null],
  ['U-OPERATOR', 'operator', 'M. Ravi', 'PRODUCTION', 'MillOrg', 'Spinning Supervisor', null],
  ['U-QA', 'qa', 'S. Priya', 'QA', 'QualityOrg', 'QA Engineer', null],
  ['U-DISPATCH', 'dispatch', 'K. Murugan', 'DISPATCH', 'MillOrg', 'Dispatch & Packing In-charge', null],
  ['U-CS', 'cs', 'J. Anitha', 'CUSTOMER_SERVICE', 'MillOrg', 'Customer Service Executive', null],
  ['U-AUDITOR', 'auditor', 'V. Ramesh', 'AUDITOR', 'AuditOrg', 'Internal Auditor', null],
  ['U-BUYER', 'buyer', 'PD Textiles - Purchase', 'BUYER', 'BuyerOrg', 'Buyer', 'CUST-PDT'],
] as const;

export function seedDatabase(db: DB, ledger: LedgerService, profile: 'full' | 'pre-demo' = 'full'): void {
  const txs: PendingTx[] = [];
  const insertEntity = (type: string, row: Record<string, unknown>, contract: PendingTx['contract'], fn: string) => {
    const def = entityDef(type);
    const columns = Object.keys(row);
    db.prepare(`INSERT INTO ${def.table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map((key) => row[key]));
    const stored = db.prepare(`SELECT * FROM ${def.table} WHERE ${def.idColumn}=?`).get(row[def.idColumn]) as Record<string, unknown>;
    const ref = { type, id: String(stored[def.idColumn]), version: Number(stored.version), recordHash: recordHashOf(type, stored), snapshot: snapshotOf(type, stored) };
    txs.push({ contract, fn, payload: { id: ref.id, seeded: true }, actorId: 'system', actorRole: 'SYSTEM', status: 'VALID', reason: null, entityRefs: [ref] });
  };
  const plain = (sql: string, ...params: unknown[]) => db.prepare(sql).run(...params);

  const seed = db.transaction(() => {
    for (const user of USERS) plain('INSERT INTO users(id,username,name,role,org,title,customer_id) VALUES(?,?,?,?,?,?,?)', ...user);
    for (const count of [['30CH', '30s Carded Hosiery', '30 CH', 30], ['40CH', '40s Carded Hosiery', '40 CH', 40], ['20CH', '20s Carded Hosiery', '20 CH', 20]]) plain('INSERT INTO counts(id,label,display,ne) VALUES(?,?,?,?)', ...count);
    for (const c of [
      { id: 'CUST-PDT', code: 'PDT', name: 'PD Textiles', city: 'Tiruppur', contact_name: 'D. Prakash', email: 'qa@pdtextiles.example' },
      { id: 'CUST-VKF', code: 'VKF', name: 'Velan Knit Fabrics', city: 'Tiruppur', contact_name: 'S. Velan', email: 'quality@velanknit.example' },
      { id: 'CUST-SLH', code: 'SLH', name: 'Sri Lakshmi Hosiery', city: 'Coimbatore', contact_name: 'L. Lakshmi', email: 'lab@srihosiery.example' },
      { id: 'CUST-KVW', code: 'KVW', name: 'Kaveri Weaves', city: 'Erode', contact_name: 'K. Murali', email: 'qa@kaveriweaves.example' },
    ]) insertEntity('customer', { ...c, created_at: '2026-09-01T08:00:00.000Z' }, 'AssetID', 'registerCustomer');

    for (const [department, machineNo, line] of [['RF', 3, 'A'], ['RF', 5, 'B'], ['AW', 1, 'A'], ['FF', 1, 'A'], ['CARD', 1, 'A']] as const) {
      const id = `${department}-${machineNo}`;
      insertEntity('machine', { id, department, machine_no: machineNo, label: `${department} M/c ${machineNo}`, line, make: 'LMW', model: 'Demo series', created_at: '2026-09-01T08:00:00.000Z' }, 'AssetID', 'registerMachine');
    }

    const standardRows = [
      ['RM','MIC','FIBRE',4.2,3.8,4.6,'µg/in'], ['RM','UHML','FIBRE',28.8,28,29.6,'mm'], ['RF','U','QUALITY',10.5,10.3,10.8,'%'],
      ['RF','CV','QUALITY',13.3,13,13.7,'%'], ['RF','THIN','QUALITY',2,null,5,'/km'], ['RF','THICK','QUALITY',60,null,90,'/km'],
      ['RF','NEPS','QUALITY',90,null,130,'/km'], ['RF','IPI','QUALITY',152,null,220,'/km'], ['RF','H','QUALITY',5.8,5.4,6.3,''],
      ['RF','BREAK_DRAFT','PROCESS',1.18,1.14,1.24,''], ['AW','U','QUALITY',10.7,10.4,11,'%'], ['FF','U','QUALITY',4.5,4.1,4.9,'%'],
    ] as const;
    standardRows.forEach(([department, parameter, category, std, lower, upper, unit]) => {
      const id = `STD-30CH-${department}-${parameter}`;
      insertEntity('standard', { id, count_id: '30CH', department, parameter, category, std, lower_limit: lower, upper_limit: upper, unit, active: 1, updated_by: 'U-QA', updated_at: '2026-09-01T08:00:00.000Z' }, 'Quality', 'upsertStandard');
    });

    insertEntity('bale', { id: 'BALE-0412', bale_no: 'B26-0412', supplier: 'Saurashtra Ginning Co.', station: 'Rajkot', variety: 'Shankar-6', gin_lot: 'GJ-26-19', weight_kg: 172, remaining_kg: 0, arrival_date: '2026-09-25', fibre: JSON.stringify({ MIC: 4.2, UHML: 28.9, UI: 82.1, STR: 29.7, SFI: 8.4, TRASH: 2.4, MOIST: 7.4 }), created_at: '2026-09-25T08:00:00.000Z' }, 'AssetID', 'registerBale');

    const lots = [
      { id: 'LOT-182-2026', lot_no: '182/2026', lot_code: '30CH 182 X/26 001', seq: 182, status: 'DISPATCHED', start_date: '2026-09-29' },
      { id: 'LOT-183-2026', lot_no: '183/2026', lot_code: '30CH 183 X/26 001', seq: 183, status: 'PACKED', start_date: '2026-10-01' },
      { id: 'LOT-185-2026', lot_no: '185/2026', lot_code: '30CH 185 X/26 001', seq: 185, status: 'ON_HOLD', start_date: '2026-10-05' },
    ];
    for (const l of lots) insertEntity('lot', { ...l, year: 2026, count_id: '30CH', line: l.seq % 2 === 0 ? 'A' : 'B', planned_kg: 4500, end_date: null, created_at: `${l.start_date}T06:00:00.000Z` }, 'AssetID', 'registerLot');
    insertEntity('lot_bale', { id: 'LB-182-BALE-0412', lot_id: 'LOT-182-2026', bale_id: 'BALE-0412', kg_used: 172 }, 'AssetID', 'registerLot');

    insertEntity('production_event', { id: 'PE-000182', lot_id: 'LOT-182-2026', department: 'RF', machine_id: 'RF-3', event_date: '2026-10-01', day_index: 2, shift: 'B', input_kg: 1000, output_kg: 960, waste_kg: 40, params: JSON.stringify({ BREAK_DRAFT: 1.34, TOP_ARM_KG: 13.6, SPINDLE_RPM: 17500 }), notes: 'Preventive maintenance: top roller cots changed; break-draft change gear replaced', operator_id: 'U-OPERATOR', created_at: '2026-10-01T13:00:00.000Z' }, 'ProcessEvent', 'logStageEvent');
    for (const [id, date, shift, values, machine] of [
      ['TR-000182','2026-10-01','A',{ U: 12.48, CV: 15.7, THIN: 9, THICK: 118, NEPS: 96, IPI: 223 },'RF-3'],
      ['TR-000183','2026-10-01','B',{ U: 12.71, CV: 16.1, THIN: 11, THICK: 126, NEPS: 101, IPI: 238 },'RF-3'],
      ['TR-000184','2026-10-01','C',{ U: 12.63, CV: 15.9, THIN: 10, THICK: 121, NEPS: 98, IPI: 229 },'RF-3'],
      ['TR-000185','2026-10-03',null,{ U: 10.74, CV: 13.62, THIN: 4.6, THICK: 72, NEPS: 96, IPI: 172, H: 5.8 },null],
      ['TR-000186','2026-10-08',null,{ U: 10.51, CV: 13.4, COUNT_CV: 2.31 },null],
      ['TR-000187','2026-10-15','A',{ H: 6.45 },'RF-5'],
      ['TR-000188','2026-10-15','A',{ U: 4.95 },'FF-1'],
    ] as const) {
      const lotId = id === 'TR-000186' ? 'LOT-185-2026' : id === 'TR-000188' ? 'LOT-183-2026' : 'LOT-182-2026';
      insertEntity('test_result', { id, lot_id: lotId, department: 'RF', machine_id: machine, sample_type: machine ? 'MACHINE' : 'LOT', test_date: date, day_index: machine ? 2 : null, shift, values_json: JSON.stringify(values), instrument: 'Uster Tester 6', tested_by: 'U-QA', remarks: '', created_at: `${date}T15:00:00.000Z` }, 'Quality', 'recordTestResult');
    }

    insertEntity('packing', { id: 'PK-000182', lot_id: 'LOT-182-2026', pack_date: '2026-10-08', pack_weight_kg: 50, packs_count: 88, cones_per_pack: 30, total_kg: 4400, pack_from: 'P182-0001', pack_to: 'P182-0088', created_by: 'U-DISPATCH', created_at: '2026-10-08T16:00:00.000Z' }, 'ProcessEvent', 'recordPacking');
    if (profile === 'full') {
      const gate = JSON.stringify({ passed: true, overridden: false, checkedAt: '2026-10-09T08:00:00.000Z', lots: [], message: 'Quality gate passed; machine-level warnings noted.' });
      insertEntity('dispatch', { id: 'DSP-2026-0109', dispatch_no: 'DSP/2026/0109', customer_id: 'CUST-PDT', count_id: '30CH', quantity_kg: 2000, dispatch_date: '2026-10-09', pack_weight_kg: 50, packs_count: 40, cones_count: 1200, vehicle_no: 'TN 39 AB 4521', lr_no: 'LR/26/7781', invoice_no: 'INV/26/1982', gate, override_ids: '[]', passport_code: 'PP-182DEMO', status: 'DISPATCHED', created_by: 'U-DISPATCH', created_at: '2026-10-09T08:00:00.000Z' }, 'Transfer', 'createDispatch');
      insertEntity('dispatch_lot', { id: 'DL-DSP-2026-0109-LOT-182-2026', dispatch_id: 'DSP-2026-0109', lot_id: 'LOT-182-2026', quantity_kg: 2000 }, 'Transfer', 'createDispatch');
      insertEntity('passport', { code: 'PP-182DEMO', dispatch_id: 'DSP-2026-0109', issued_at: '2026-10-09T08:00:00.000Z' }, 'AssetID', 'issuePassport');
      insertEntity('complaint', { id: 'CMP-22-2026', complaint_no: '22/2026', seq: 22, year: 2026, complainant_name: 'Mr. D. Prakash (QA Manager, PD Textiles)', type: 'EVENNESS', customer_id: 'CUST-PDT', lot_id: 'LOT-182-2026', dispatch_id: 'DSP-2026-0109', description: 'Barré / streaks observed in single jersey fabric knitted from cones of lot 30CH 182 X/26 001. Approx. 6 rolls affected. Request investigation and credit.', document_id: null, status: 'OPEN', received_date: '2026-10-14', created_by: 'U-CS', created_at: '2026-10-14T09:00:00.000Z', updated_at: '2026-10-14T09:00:00.000Z' }, 'Quality', 'registerComplaint');
      insertEntity('complaint_event', { id: 'CE-000022', complaint_id: 'CMP-22-2026', from_status: null, to_status: 'OPEN', note: 'Complaint registered on ledger', by_user_id: 'U-CS', at: '2026-10-14T09:00:00.000Z' }, 'Quality', 'registerComplaint');
    }
    for (const [key, value] of Object.entries({ millName: 'Model Spinning Mill - Unit 1', lotNoFormat: '{seq}/{year}', lotCodeFormat: '{count} {seq} {mark}/{yearShort} {batch}', lotMark: 'X', warnFraction: 0.2, businessDate: '2026-10-16', qualityColumns: ['U','CV','THIN','THICK','NEPS','IPI','H'] })) plain('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', key, JSON.stringify(value));
    for (const [name, value] of [['complaint:2026', profile === 'full' ? 22 : 21], ['lot:2026', 185], ['dispatch:2026', profile === 'full' ? 109 : 108], ['id:CE', profile === 'full' ? 22 : 21], ['id:TR', 188], ['id:PE', 182], ['id:PK', 182], ['id:CON', 0]] as const) {
      plain('INSERT INTO sequences(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value', name, value);
    }
    if (txs.length) {
      const commit = ledger.commit(txs, { timestamp: '2026-10-16T08:00:00.000Z' });
      const anchor = db.prepare('INSERT INTO entity_anchors(entity_type,entity_id,version,record_hash,tx_hash,block_number,created_at) VALUES(?,?,?,?,?,?,?)');
      for (const tx of commit.txs) for (const ref of tx.entityRefs) {
        const def = entityDef(ref.type);
        db.prepare(`UPDATE ${def.table} SET tx_hash=?,block_number=?,record_hash=? WHERE ${def.idColumn}=?`).run(tx.txHash, commit.block.number, ref.recordHash, ref.id);
        anchor.run(ref.type, ref.id, ref.version, ref.recordHash, tx.txHash, commit.block.number, commit.block.timestamp);
      }
    }
  });
  seed();
}