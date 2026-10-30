// Zeon: the role rules, the tool loop and the page/form suggestions, driven by a scripted stand-in for the model (no network, no API key).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { openDb, type DB } from '../../server/db';
import { SimulatedLedger } from '../../server/ledger/simulated';
import { seedDatabase } from '../../server/seed/loader';
import { createApp } from '../../server/app';
import { createRuntime } from '../../server/contracts/runtime';
import { initClock } from '../../server/lib/clock';
import { config } from '../../server/config';
import { resetZeonLimits } from '../../server/api/zeon';
import type { ModelReply, ModelRequest } from '../../server/zeon/model';
import { dynamicSystem, stableSystem } from '../../server/zeon/knowledge';
import { canNavigate, complaintFormPath, pagesFor } from '../../shared/zeon';

type Params = ModelRequest;
const say = (text: string): ModelReply => ({ text, toolCalls: [], outcome: 'answer' });
const call = (name: string, args: unknown, id = 'tu_1'): ModelReply => ({ text: '', toolCalls: [{ id, name, args: args as Record<string, unknown> }], outcome: 'tool_calls', raw: { sealed: id } });

describe('Zeon', () => {
  let db: DB; let app: Express; let ledger: SimulatedLedger;
  let script: ((p: Params) => ModelReply)[] = []; const seen: Params[] = [];
  const llm = async (p: Params): Promise<ModelReply> => { seen.push(p); const next = script.shift(); if (!next) throw new Error('script exhausted'); return next(p); };
  const tokens: Record<string, string> = {};
  const as = async (u: string) => (tokens[u] ??= (await request(app).post('/api/auth/login').send({ username: u }).expect(200)).body.data.token as string);
  const ask = async (u: string, question: string, route = '/', extra: Record<string, unknown> = {}) =>
    request(app).post('/api/zeon/chat').set('Authorization', `Bearer ${await as(u)}`).send({ messages: [{ role: 'user', content: question }], context: { route, ...extra } });
  /** The tool results the model was handed on the turn after its tool call. */
  const toolResults = (p: Params) => { const last = p.turns[p.turns.length - 1]; if (last.role !== 'tool') throw new Error('last turn is not a tool turn'); return last.results.map((r) => ({ id: r.id, content: r.output, isError: r.isError })); };

  beforeAll(async () => {
    db = openDb(':memory:'); ledger = new SimulatedLedger(db); await ledger.init(); await seedDatabase(db, ledger); await initClock(db);
    app = createApp(db, ledger, createRuntime(db, ledger), { zeonLlm: llm });
  }, 120_000);
  afterAll(async () => { await db?.close(); });
  beforeEach(() => { script = []; seen.length = 0; resetZeonLimits(); });

  describe('the request', () => {
    it('needs a sign-in, a question, and answers politely without a model key', async () => {
      await request(app).post('/api/zeon/chat').send({ messages: [{ role: 'user', content: 'hi' }] }).expect(401);
      expect((await ask('qa', '   ')).status).toBe(422);
      const noQuestion = await request(app).post('/api/zeon/chat').set('Authorization', `Bearer ${await as('qa')}`).send({ messages: [{ role: 'assistant', content: 'hello' }] });
      expect(noQuestion.status).toBe(422);
      if (!config.gemini.enabled) {
        const bare = createApp(db, ledger, createRuntime(db, ledger));
        const r = await request(bare).post('/api/zeon/chat').set('Authorization', `Bearer ${await as('qa')}`).send({ messages: [{ role: 'user', content: 'hi' }] }).expect(200);
        expect(r.body.data).toMatchObject({ configured: false, actions: [] });
        expect(r.body.data.reply).toMatch(/Gemini_API_KEY/);
      }
    });

    it('sends the model the right prompt, tools and settings', async () => {
      script = [() => say('Hello!')];
      const r = await ask('qa', 'Hello', '/quality', { title: 'Quality' }).then((x) => x.body.data);
      expect(r).toMatchObject({ reply: 'Hello!', configured: true, actions: [] });
      const p = seen[0];
      expect(p.system).toContain('S. Priya'); expect(p.system).toContain('/quality');
      expect(p.system).toContain(stableSystem('QA')); expect(stableSystem('QA')).not.toContain('S. Priya'); // nothing per-person inside the fixed part
      expect(p.turns).toEqual([{ role: 'user', text: 'Hello' }]);
      expect(p.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['get_lot', 'search', 'dashboard', 'navigate', 'prepare_complaint_form']));
    });

    it('passes the last refused action to the model so it can explain it', async () => {
      script = [() => say('That was refused because…')];
      await ask('dev', 'Why did that fail?', '/complaints/CMP-21-2026', { lastError: { label: 'Analyze lot 114', reason: 'access:permission: role DEVELOPER is not permitted to invoke Quality.anchorAnalysis', at: '2026-10-28T09:40:00Z' } });
      expect(seen[0].system).toContain('Analyze lot 114'); expect(seen[0].system).toContain('not permitted to invoke Quality.anchorAnalysis');
    });

    it('limits how fast one person can ask', async () => {
      const before = config.zeon.perMinute; config.zeon.perMinute = 2;
      try {
        script = [() => say('1'), () => say('2'), () => say('3')];
        expect((await ask('qa', 'a')).status).toBe(200); expect((await ask('qa', 'b')).status).toBe(200);
        const third = await ask('qa', 'c'); expect(third.status).toBe(429); expect(third.body.error.code).toBe('RATE_LIMITED');
        expect((await ask('admin', 'a')).status).toBe(200); // someone else is unaffected
      } finally { config.zeon.perMinute = before; }
    });
  });

  describe('the tool loop', () => {
    it('looks a lot up as the signed-in person and hands the facts back to the model', async () => {
      script = [() => call('get_lot', { lot: 'Lot 101' }), () => say('Lot 101 is dispatched.')];
      const r = (await ask('qa', 'Where is lot 101?')).body.data;
      expect(r.reply).toBe('Lot 101 is dispatched.');
      expect(seen).toHaveLength(2);
      const second = seen[1];
      expect(toolResults(second)).toHaveLength(1);
      const facts = JSON.parse(toolResults(second)[0].content);
      expect(facts.lot).toMatchObject({ lotNo: '101', countDisplay: '40s CH', status: 'DISPATCHED', dispatchNo: 'DSP/2026/0117' });
      expect(facts.journey.length).toBeGreaterThan(8); expect(facts.dispatch.vehicleNo).toBe('TN-39-AB-4521');
      expect(facts.readingsOutsideOrNearLimits.total).toBeGreaterThan(0);
      // the model's own turn comes back to it untouched
      const modelTurn = second.turns[second.turns.length - 2];
      expect(modelTurn).toMatchObject({ role: 'model', raw: { sealed: 'tu_1' } });
      expect(JSON.stringify(seen)).not.toContain(await as('qa')); // the person's token never reaches the model
    });

    it('answers every tool call of one turn together, and reports a failed lookup instead of hiding it', async () => {
      script = [() => ({ text: '', outcome: 'tool_calls', toolCalls: [{ id: 'a', name: 'get_lot', args: { lot: '999' } }, { id: 'b', name: 'alerts', args: {} }] }), () => say('done')];
      await ask('qa', 'check');
      const res = toolResults(seen[1]); expect(res.map((x) => x.id)).toEqual(['a', 'b']);
      expect(res[0].isError).toBe(true); expect(JSON.parse(res[0].content).error).toMatch(/Not found/);
      expect(res[1].isError).toBe(false);
    });

    it('keeps tool results small and stops runaway loops', async () => {
      script = [() => call('list_lots', {}), () => say('ok')];
      await ask('qa', 'list'); const list = JSON.parse(toolResults(seen[1])[0].content);
      expect(list.total).toBe(52); expect(list.shown).toHaveLength(15);
      const before = config.zeon.maxSteps; config.zeon.maxSteps = 3;
      try {
        script = [() => call('alerts', {}), () => call('alerts', {}), () => call('alerts', {})];
        const r = (await ask('qa', 'loop')).body.data; expect(r.reply).toMatch(/couldn't finish that lookup/); expect(script).toHaveLength(0);
      } finally { config.zeon.maxSteps = before; }
    });

    it('handles a refusal and an unfinished answer', async () => {
      script = [() => ({ text: '', toolCalls: [], outcome: 'blocked' })]; expect((await ask('qa', 'x')).body.data.reply).toMatch(/can't help with that one/);
      script = [() => ({ text: '', toolCalls: [], outcome: 'too_long' })]; expect((await ask('qa', 'x')).body.data.reply).toMatch(/too long/);
    });

    it('survives the model service failing, without leaking details', async () => {
      script = [() => { throw new Error('boom sk-ant-secret'); }];
      const r = (await ask('qa', 'x')).body.data; expect(r.reply).toMatch(/not available at the moment/); expect(JSON.stringify(r)).not.toContain('secret');
    });
  });

  describe('answers follow the role', () => {
    it('gives a customer only customer tools, and the portal API decides what they see', async () => {
      script = [() => say('hi')]; await ask('pdt', 'hello');
      const names = seen[0].tools.map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(['my_lots', 'get_my_lot', 'my_complaints', 'navigate', 'prepare_complaint_form']));
      for (const staffOnly of ['get_lot', 'search', 'dashboard', 'alerts', 'list_lots', 'list_dispatches', 'get_complaint']) expect(names).not.toContain(staffOnly);
      expect(seen[0].system).toContain('This is a customer account'); expect(seen[0].system).not.toContain('# Who may do what');
      expect(seen[0].system).toContain('PD Textiles');

      script = [() => call('get_lot', { lot: '110' }, 'x'), () => call('get_my_lot', { lot: '110' }, 'y'), () => call('my_lots', {}, 'z'), () => say('ok')];
      await ask('pdt', 'tell me about lot 110');
      // seen[1] is the first call of this second conversation; each later call carries the previous tool's result
      expect(JSON.parse(toolResults(seen[2])[0].content).error).toMatch(/not available for this login/); // a staff tool, even if the model invents the call
      expect(JSON.parse(toolResults(seen[3])[0].content).error).toMatch(/Not found/); // another customer's lot
      const mine = JSON.parse(toolResults(seen[4])[0].content) as { lotNo: string }[];
      const portal = (await request(app).get('/api/portal/lots').set('Authorization', `Bearer ${await as('pdt')}`)).body.data as unknown[];
      expect(mine).toHaveLength(portal.length);
      expect(JSON.stringify(mine)).not.toMatch(/Ganga|Velan|Kaveri/);
    });

    it('lets each staff role see what their login sees', async () => {
      script = [() => call('dashboard', {}), () => say('ok')]; await ask('admin', 'how is the mill');
      const d = JSON.parse(toolResults(seen[1])[0].content); expect(d.complaints).toMatchObject({ open: 3, inProgress: 2, closed: 10 }); expect(d.topAlerts.length).toBeGreaterThan(0);
      script = [() => call('get_complaint', { complaint: '18/2026' }), () => say('ok')]; await ask('qa', 'complaint 18');
      const w = JSON.parse(toolResults(seen[3])[0].content); expect(w.complaint.complaintNo).toBe('18/2026'); expect(w.analysis.likelyCauses.length).toBeGreaterThan(0);
    });

    it('builds the prompt from the role: customers never get the internal permission matrix', () => {
      expect(stableSystem('BUYER')).not.toContain('Who may do what');
      expect(stableSystem('QA')).toContain('Who may do what'); expect(stableSystem('QA')).toContain('Quality (QA Head)');
      expect(stableSystem('QA')).toContain('Micronaire'); // glossary comes from the app's own definitions
      expect(stableSystem('DEVELOPER')).toContain('/developer'); expect(stableSystem('QA')).not.toContain('- /developer');
      expect(dynamicSystem({ name: 'X', role: 'QA' }, { route: '/', lastError: null }, 'now')).not.toContain('last action');
    });
  });

  describe('suggestions are checked per role', () => {
    const navigate = async (u: string, path: string) => { script = [() => call('navigate', { path, label: 'Open' }), () => say('ok')]; const r = (await ask(u, 'take me there')).body.data; return { r, result: JSON.parse(toolResults(seen[seen.length - 1])[0].content) }; };

    it('only opens pages the role may use', async () => {
      const ok = await navigate('qa', '/masters'); expect(ok.r.actions).toEqual([{ type: 'navigate', path: '/masters', label: 'Open' }]);
      for (const bad of ['/developer', '/portal/orders', '//evil.com', 'https://evil.com', 'javascript:alert(1)', '/lots/<script>']) expect((await navigate('qa', bad)).r.actions, bad).toEqual([]);
      expect((await navigate('dev', '/developer')).r.actions).toHaveLength(1);
      expect((await navigate('pdt', '/portal/orders')).r.actions).toHaveLength(1);
      for (const bad of ['/lots', '/masters', '/production', '/developer']) expect((await navigate('pdt', bad)).r.actions, bad).toEqual([]);
      expect(canNavigate('QA', '/lots/101?x=1')).toBe(true); expect(pagesFor('BUYER').every((p) => p.path.startsWith('/portal'))).toBe(true);
    });

    const form = async (u: string, input: Record<string, unknown>) => { script = [() => call('prepare_complaint_form', input), () => say('ok')]; const r = (await ask(u, 'raise a complaint')).body.data; return { actions: r.actions, result: JSON.parse(toolResults(seen[seen.length - 1])[0].content) }; };

    it('prepares the complaint form only for roles that may register one, and only for real lots', async () => {
      const cs = await form('cs', { lot: '101', type: 'HAIRINESS', description: 'More fuzz than the last lot' });
      expect(cs.actions).toHaveLength(1); expect(cs.actions[0]).toMatchObject({ type: 'open_form', form: 'complaint' });
      expect(cs.actions[0].path).toBe('/complaints/new?lot=101&type=HAIRINESS&desc=More+fuzz+than+the+last+lot');
      expect((await form('dev', { lot: '101', type: 'HAIRINESS', description: 'x' })).actions).toEqual([]); // Developer role cannot register complaints
      expect((await form('qa', { lot: '101', type: 'HAIRINESS', description: 'x' })).actions).toEqual([]);
      expect((await form('cs', { lot: '999', type: 'HAIRINESS', description: 'x' })).result.error).toMatch(/not found/i);
      expect((await form('cs', { lot: '101', type: 'NOPE', description: 'x' })).actions).toEqual([]);
      const own = await form('pdt', { lot: '101', type: 'HAIRINESS', description: 'Fuzzy yarn' });
      expect(own.actions[0].path).toBe('/portal/report?lot=101&type=HAIRINESS&desc=Fuzzy+yarn');
      const theirs = await form('pdt', { lot: '110', type: 'HAIRINESS', description: 'x' });
      expect(theirs.actions).toEqual([]); expect(theirs.result.error).toMatch(/not one of this customer's lots/);
    });

    it('builds the form link from validated values only', () => {
      expect(complaintFormPath('BUYER', { lot: 'Lot 101', type: 'strength', description: '  a   b ' })).toMatchObject({ path: '/portal/report?lot=101&type=STRENGTH&desc=a+b' });
      expect(complaintFormPath('CUSTOMER_SERVICE', { lot: '1; DROP', type: 'STRENGTH' })).toBeNull();
      expect(complaintFormPath('QA', { lot: '101', type: 'STRENGTH' })).toBeNull();
    });
  });
});
