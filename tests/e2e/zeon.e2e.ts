// Zeon in a real browser: the icon, the panel, roles, confirmations, voice, dragging and the phone layout.
//   npm run dev   (API :4000 + web :5173)   then   npm run e2e:zeon
// The server's reply is scripted (page.route), so this needs no API key; the server side is covered by tests/unit/zeon.test.ts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, type BrowserContext, type Page } from 'playwright';

const base = process.env.TEXTRACE_BASE_URL ?? 'http://localhost:5173';
const api = process.env.TEXTRACE_API_URL ?? 'http://localhost:4000';
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, ...(fs.existsSync(chrome) ? { executablePath: chrome } : {}) });
const step = (s: string) => console.log(s);

type Reply = { reply: string; actions?: unknown[]; configured?: boolean };
const login = async (u: string) => (await (await fetch(`${api}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u }) })).json()).data as { token: string; user: unknown };

/** A signed-in page whose /api/zeon/chat answers come from `answer` (and every request body is recorded). */
async function open(user: string, route: string, answer: (body: { messages: { role: string; content: string }[]; context: Record<string, unknown> }) => Reply | { status: number; error: string } = () => ({ reply: 'ok' }), opts: { width?: number; height?: number; init?: string } = {}) {
  const a = await login(user);
  const ctx: BrowserContext = await browser.newContext({ viewport: { width: opts.width ?? 1440, height: opts.height ?? 900 } });
  await ctx.addInitScript(([t, u]) => localStorage.setItem('textrace.session', JSON.stringify({ state: { token: t, user: u }, version: 0 })), [a.token, a.user] as const);
  if (opts.init) await ctx.addInitScript(opts.init);
  const page = await ctx.newPage();
  const requests: { messages: { role: string; content: string }[]; context: Record<string, unknown> }[] = [];
  await page.route('**/api/zeon/chat', async (r) => {
    const body = r.request().postDataJSON(); requests.push(body);
    const out = answer(body);
    if ('status' in out) await r.fulfill({ status: out.status, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'RATE_LIMITED', message: out.error } }) });
    else await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { actions: [], configured: true, ...out } }) });
  });
  await page.goto(base + route, { waitUntil: 'networkidle' });
  return { ctx, page, requests };
}
const panel = (p: Page) => p.getByRole('dialog', { name: 'Zeon assistant' });
const ask = async (p: Page, text: string) => { await p.getByTestId('zeon-input').fill(text); await p.getByTestId('zeon-send').click(); };

try {
  step('1. Staff: the icon, a role-aware panel, starter questions, formatted answers and a page button');
  {
    const { ctx, page, requests } = await open('qa', '/', () => ({ reply: 'Lot **101** is dispatched.\n\n- Left the mill on 27 Oct\n- Vehicle TN-39-AB-4521', actions: [{ type: 'navigate', path: '/lots/101', label: 'Open lot 101' }] }));
    await page.getByTestId('zeon-fab').waitFor();
    assert.equal(await panel(page).count(), 0, 'the panel starts closed');
    await page.getByTestId('zeon-fab').click();
    await panel(page).waitFor();
    assert.match(await panel(page).innerText(), /Answering as Quality \(QA Head\)/);
    assert.match(await panel(page).innerText(), /Hi S\./);
    const chips = await panel(page).locator('.zeon-chips button').allInnerTexts();
    assert.equal(chips.length, 3); assert.ok(chips.includes('What needs attention today?'), `starter questions: ${chips}`);
    await panel(page).getByRole('button', { name: 'What needs attention today?' }).click();
    await page.getByTestId('zeon-bot-msg').first().waitFor();
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].messages, [{ role: 'user', content: 'What needs attention today?' }]);
    assert.equal(requests[0].context.route, '/'); assert.equal(requests[0].context.lastError, null);
    const bot = page.getByTestId('zeon-bot-msg').first();
    assert.equal(await bot.locator('strong').innerText(), '101'); assert.equal(await bot.locator('li').count(), 2);
    assert.equal(await panel(page).locator('.zeon-chips').count(), 0, 'starter questions go once a conversation starts');
    await ask(page, 'And the vehicle?');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="zeon-bot-msg"]').length === 2);
    assert.equal(requests[1].messages.length, 3, 'earlier turns are sent so Zeon remembers the conversation');
    await bot.getByTestId('zeon-navigate').click();
    await page.waitForURL(/\/lots\/101$/);
    assert.equal(await panel(page).count(), 1, 'the panel stays open while you look at the page');
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    assert.equal(await panel(page).count(), 0, 'Escape closes the panel');
    await ctx.close();
  }

  step('2. The complaint form is only prepared after a confirmation, and only fills the form (nothing is sent)');
  {
    const { ctx, page } = await open('cs', '/', () => ({ reply: 'I can prepare that.', actions: [{ type: 'open_form', form: 'complaint', path: '/complaints/new?lot=101&type=HAIRINESS&desc=More+fuzz+than+usual', label: 'Open the complaint form for lot 101', summary: 'hairiness on lot 101: “More fuzz than usual”' }] }));
    await page.getByTestId('zeon-fab').click(); await ask(page, 'Raise a hairiness complaint for lot 101');
    const card = page.getByTestId('zeon-confirm'); await card.waitFor();
    assert.match(await card.innerText(), /Prepare the complaint form\?/); assert.match(await card.innerText(), /send it yourself/);
    assert.equal(new URL(page.url()).pathname, '/', 'nothing happens until the person confirms');
    await page.getByTestId('zeon-open-form').click();
    await page.waitForURL(/\/complaints\/new\?lot=101&type=HAIRINESS/);
    await page.waitForFunction(() => (document.querySelector('[data-testid="complaint-new"] textarea') as HTMLTextAreaElement | null)?.value === 'More fuzz than usual');
    const selects = page.locator('[data-testid="complaint-new"] select');
    await page.waitForFunction(() => (document.querySelectorAll('[data-testid="complaint-new"] select')[0] as HTMLSelectElement | undefined)?.selectedOptions[0]?.textContent?.includes('101'));
    assert.equal(await selects.nth(1).inputValue(), 'HAIRINESS', 'the complaint type is filled in');
    assert.equal(await page.locator('[data-testid="complaint-new"] button.primary').count() > 0, true);
    assert.match(await card.innerText(), /Opened/);
    await ctx.close();
    // "Not now" leaves everything as it was
    const again = await open('cs', '/', () => ({ reply: 'x', actions: [{ type: 'open_form', form: 'complaint', path: '/complaints/new?lot=101&type=HAIRINESS', label: 'l', summary: 's' }] }));
    await again.page.getByTestId('zeon-fab').click(); await ask(again.page, 'go');
    await again.page.getByTestId('zeon-confirm').getByRole('button', { name: 'Not now' }).click();
    assert.match(await again.page.getByTestId('zeon-confirm').innerText(), /Not now/); assert.equal(new URL(again.page.url()).pathname, '/');
    await again.ctx.close();
  }

  step('3. A customer gets the customer wording and the portal form');
  {
    const { ctx, page } = await open('pdt', '/portal', () => ({ reply: 'Sure.', actions: [{ type: 'open_form', form: 'complaint', path: '/portal/report?lot=101&type=HAIRINESS&desc=Fuzzy+yarn', label: 'Open the complaint form for lot 101', summary: 'hairiness on lot 101' }] }));
    await page.getByTestId('zeon-fab').click();
    assert.match(await panel(page).innerText(), /Answering as Customer \(portal\)/);
    const chips = await panel(page).locator('.zeon-chips button').allInnerTexts();
    assert.ok(chips.includes('I want to report a problem with a lot') && chips.every((c) => !/attention today/i.test(c)), `customer starters: ${chips}`);
    await ask(page, 'I want to report a problem with lot 101');
    await page.getByTestId('zeon-open-form').click();
    await page.waitForURL(/\/portal\/report\?lot=101&type=HAIRINESS/);
    await page.waitForFunction(() => document.body.innerText.includes('Fuzzy yarn') || [...document.querySelectorAll('textarea')].some((t) => (t as HTMLTextAreaElement).value === 'Fuzzy yarn'));
    await ctx.close();
  }

  step('4. A refused action: Zeon notices, offers to explain, and sends what happened');
  {
    const { ctx, page, requests } = await open('dev', '/complaints/CMP-19-2026', () => ({ reply: 'That was refused because your role cannot run an analysis.' }));
    await page.getByTestId('devmode-toggle').check();           // Developer mode keeps the button enabled so the refusal can happen
    await page.getByTestId('run-analysis').click();
    const nudge = page.getByTestId('zeon-nudge'); await nudge.waitFor({ timeout: 15000 });
    assert.match(await nudge.innerText(), /refused/i);
    await nudge.click();
    await page.getByTestId('zeon-bot-msg').first().waitFor();
    const last = requests[requests.length - 1];
    assert.match(String(last.messages[0].content), /refused/i);
    const err = last.context.lastError as { label: string; reason: string };
    assert.ok(err && /Analy[sz]e lot/.test(err.label) && /DEVELOPER/.test(err.reason) && /anchorAnalysis/.test(err.reason), `lastError: ${JSON.stringify(err)}`);
    // the ledger confirmation and the open panel must not sit on top of each other
    const toast = page.getByTestId('trace-card').first();
    if (await toast.count()) { const a = await toast.boundingBox(); const b = await panel(page).boundingBox(); assert.ok(a && b && (a.x + a.width <= b.x + 1 || a.y + a.height <= b.y + 1 || a.y >= b.y + b.height - 1), 'the toast steps aside for the panel'); }
    await ctx.close();
  }

  step('5. Errors are friendly: a busy server and a failed request');
  {
    let n = 0;
    const { ctx, page } = await open('qa', '/', () => (++n === 1 ? { status: 429, error: 'You are asking Zeon a lot of questions very quickly. Please wait a moment.' } : { reply: 'back' }));
    await page.getByTestId('zeon-fab').click(); await ask(page, 'one');
    await page.locator('.zeon-msg.err').waitFor(); assert.match(await page.locator('.zeon-msg.err').innerText(), /wait a moment/);
    await ask(page, 'two'); await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="zeon-bot-msg"]')].some((e) => e.textContent === 'back'));
    await ctx.close();
    const down = await open('qa', '/'); await down.page.unroute('**/api/zeon/chat'); await down.page.route('**/api/zeon/chat', (r) => r.abort());
    await down.page.getByTestId('zeon-fab').click(); await ask(down.page, 'hello');
    await down.page.locator('.zeon-msg.err').waitFor(); assert.match(await down.page.locator('.zeon-msg.err').innerText(), /could not reach the server/i);
    await down.ctx.close();
  }

  step('6. Voice: speaking a question sends it, and answers can be read aloud');
  {
    const fakeVoice = `
      window.__spoken = [];
      class FakeRecognition { start() { setTimeout(() => { this.onresult && this.onresult({ results: [Object.assign([{ transcript: 'where is lot 101' }], { isFinal: true })] }); this.onend && this.onend(); }, 60); } stop() {} abort() {} }
      window.SpeechRecognition = FakeRecognition; window.webkitSpeechRecognition = FakeRecognition;
      const speak = (u) => window.__spoken.push({ text: u.text, lang: u.lang });
      Object.defineProperty(window, 'speechSynthesis', { value: { speak, cancel() {}, getVoices() { return []; } }, configurable: true });
      window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };`;
    const { ctx, page, requests } = await open('qa', '/', () => ({ reply: 'Lot **101** is with the customer.\n\n- Left on 27 Oct' }), { init: fakeVoice });
    await page.getByTestId('zeon-fab').click();
    await page.getByTestId('zeon-speak').click();
    assert.equal(await page.getByTestId('zeon-speak').getAttribute('aria-pressed'), 'true');
    await page.getByTestId('zeon-mic').click();
    await page.getByTestId('zeon-bot-msg').first().waitFor();
    assert.equal(requests[0].messages[0].content, 'where is lot 101', 'the spoken words are sent as the question');
    assert.equal(await page.getByTestId('zeon-user-msg').first().innerText(), 'where is lot 101');
    const spoken = await page.evaluate(() => (window as unknown as { __spoken: { text: string; lang: string }[] }).__spoken);
    assert.equal(spoken.length, 1); assert.equal(spoken[0].lang, 'en-IN');
    assert.ok(!/\*\*|^- /.test(spoken[0].text) && /Lot 101 is with the customer/.test(spoken[0].text), `read aloud without markdown: ${spoken[0].text}`);
    await ctx.close();
    const noVoice = await open('qa', '/', undefined, { init: 'delete window.SpeechRecognition; delete window.webkitSpeechRecognition;' });
    await noVoice.page.getByTestId('zeon-fab').click();
    assert.equal(await noVoice.page.getByTestId('zeon-mic').count(), 0, 'no microphone button when the browser cannot listen');
    assert.match(await noVoice.page.getByRole('dialog').innerText(), /Voice input works in Chrome and Edge/);
    await noVoice.ctx.close();
  }

  step('7. The icon stays fixed in the bottom-right corner (dragging does not move it) and a click opens the panel');
  {
    const { ctx, page } = await open('qa', '/');
    const fab = page.getByTestId('zeon-fab'); const before = (await fab.boundingBox())!;
    assert.ok(Math.abs(before.x + before.width - (1440 - 36)) < 3 && Math.abs(before.y + before.height - (900 - 36)) < 3, `icon sits near the bottom-right corner, at ${before.x},${before.y}`);
    await page.mouse.move(before.x + 32, before.y + 32); await page.mouse.down(); await page.mouse.move(before.x - 150, before.y - 120, { steps: 8 }); await page.mouse.up();
    const after = (await fab.boundingBox())!; assert.ok(Math.abs(after.x - before.x) < 2 && Math.abs(after.y - before.y) < 2, 'the icon does not move');
    assert.equal(await panel(page).count(), 0, 'dragging does not open the panel');
    await fab.click(); await panel(page).waitFor();
    const box = (await panel(page).boundingBox())!; assert.ok(box.y >= 0 && box.x >= 0 && box.x + box.width <= 1440, 'the panel stays on screen');
    await ctx.close();
  }

  step('8. Phone: the panel fits the screen and the page does not scroll sideways');
  {
    const { ctx, page } = await open('qa', '/', () => ({ reply: 'hello' }), { width: 390, height: 844 });
    await page.getByTestId('zeon-fab').click(); await panel(page).waitFor();
    const m = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth, p: document.querySelector('.zeon-panel')!.getBoundingClientRect().toJSON() }));
    assert.equal(m.over, 0, 'no horizontal scroll'); assert.ok(m.p.left >= 0 && m.p.right <= 390 && m.p.top >= 0 && m.p.bottom <= 844, `panel fits: ${JSON.stringify(m.p)}`);
    await ctx.close();
  }

  step('9. Zeon is not part of a printout or the sign-in page');
  {
    const { ctx, page } = await open('qa', '/lots/LOT-101');
    await page.emulateMedia({ media: 'print' }); assert.equal(await page.getByTestId('zeon').isVisible(), false);
    await ctx.close();
    const out = await browser.newContext(); const p = await out.newPage(); await p.goto(base, { waitUntil: 'networkidle' });
    assert.equal(await p.getByTestId('zeon').count(), 0, 'nothing for signed-out visitors'); await out.close();
  }
  console.log('\nZeon e2e passed.');
} finally {
  await browser.close();
}
