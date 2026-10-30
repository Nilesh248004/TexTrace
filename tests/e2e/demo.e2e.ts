// End-to-end demo: "Lot 101, dispatched yesterday, customer says high hairiness" — run in a real browser, screenshots to docs/screenshots.
//   npm run dev   (API :4000 + web :5173)   then   npm run e2e
// The script resets the demo data first and again at the end, so it leaves the pristine seed behind.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';

const base = process.env.TEXTRACE_BASE_URL ?? 'http://localhost:5173';
const shots = path.resolve('docs/screenshots');
fs.mkdirSync(shots, { recursive: true });
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function api(method: string, p: string, token?: string, body?: unknown) {
  const r = await fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return (await r.json()) as { ok: boolean; data?: any; error?: { message: string } };
}
async function resetDemo() { const t = (await api('POST', '/api/auth/login', undefined, { username: 'dev' })).data.token; assert.ok((await api('POST', '/api/dev/reset', t)).ok, 'demo reset failed'); }

const browser = await chromium.launch({ headless: true, ...(fs.existsSync(chrome) ? { executablePath: chrome } : {}) });
const errors: string[] = [];
try {
  await resetDemo();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const shot = async (name: string, full = false) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: full }); console.log(`  📸 ${name}.png`); };
  const signIn = async (user: string) => { await page.goto(base); await page.evaluate(() => localStorage.removeItem('textrace.session')); await page.goto(base); await page.getByTestId(`login-user-${user}`).click(); await page.getByTestId('login-submit').click(); await page.waitForTimeout(800); };

  console.log('1. QA head types 101 → Lot Passport');
  await signIn('qa');
  await shot('00-login-done');
  await page.getByTestId('global-search').fill('101');
  await page.waitForSelector('[data-testid=search-results]');
  await page.getByTestId('global-search').press('Enter');
  await page.waitForURL(/\/lots\/LOT-101/);
  const header = page.getByTestId('passport-header');
  await header.waitFor();
  const text = await page.locator('main, .page').first().innerText();
  for (const needle of ['TN-39-AB-4521', 'INV/26-27/0412', 'PD Textiles', 'M-001']) assert.ok(text.includes(needle), `passport should show ${needle}`);
  await shot('01-lot-101-passport', true);
  await page.getByTestId('tab-production').click(); await shot('02-lot-101-production', true);
  await page.getByTestId('tab-accessories').click(); await shot('03-lot-101-accessories', true);
  await page.getByTestId('tab-quality').click(); await shot('04-lot-101-quality', true);

  console.log('2. Customer (PD Textiles) reports the problem in the portal');
  await signIn('pdt');
  await page.waitForURL(/\/portal/);
  await shot('05-portal-home');
  await page.goto(`${base}/portal/lots/LOT-101`); await page.getByTestId('portal-lot-passport').waitFor(); await shot('06-portal-lot-passport', true);
  await page.goto(`${base}/portal/report?lot=101`);
  await page.getByTestId('report-lot').waitFor();
  await page.getByTestId('report-type-HAIRINESS').click();
  await page.getByTestId('report-description').fill('The lot 101 I bought yesterday has more hairiness than usual — the knitted fabric looks fuzzy.');
  await shot('07-portal-report');
  await page.getByTestId('report-submit').click();
  await page.getByText(/22\/2026/).first().waitFor();
  await shot('08-portal-reported');

  console.log('3. QA opens the investigation workspace and runs the AI analysis');
  await signIn('qa');
  await page.goto(`${base}/complaints`);
  await page.getByText('22/2026').first().click();
  await page.waitForURL(/\/complaints\/CMP-22-2026/);
  await shot('09-complaint-workspace', true);
  await page.getByTestId('run-analysis').click();
  await page.getByText(/RF 6/).first().waitFor({ timeout: 20000 });
  const ws = await page.locator('.page').first().innerText();
  assert.ok(/RF 6/.test(ws) && /spindle speed/i.test(ws) && /traveller/i.test(ws), 'analysis should name RF 6, spindle speed and traveller');
  assert.ok(/Sri Venkateswara/.test(ws) || /M-001/.test(ws), 'analysis should name the mix / supplier as contributory');
  await shot('10-ai-analysis', true);

  console.log('4. QA head writes the conclusion and closes the complaint');
  await page.getByLabel(/root cause/i).first().fill('RF-6 ran above the spindle-speed master (19,800 vs 18,200 rpm) with a 30-day-old traveller until 21 Oct; mix M-001 had a high short-fibre index (9.4%).');
  await page.getByLabel(/corrective/i).first().fill('Spindle speed reset and traveller replaced on 21 Oct; unshipped stock of lots 102, 110-112 held and customers contacted; replacement cartons offered to PD Textiles.');
  await page.getByLabel(/preventive/i).first().fill('Traveller-age alert at 80% of life, spindle speed in the shift-start checklist, pre-mix HVI check on short-fibre index.');
  await page.getByLabel(/conclusion/i).first().fill('Hairiness traced to RF-6 settings and accessory wear, contributed to by the high short-fibre mix. Corrected; verified on later lots.');
  await page.getByLabel(/customer reply/i).first().fill('Dear PD Textiles, thank you for reporting this. We found the cause on one ring frame and in the cotton blend, corrected it, and are replacing the affected cartons at no cost.');
  await page.getByTestId('complaint-conclude').click();
  await page.getByText(/Closed/).first().waitFor({ timeout: 15000 });
  await shot('11-complaint-closed', true);

  console.log('5. Customer sees the closed complaint and the reply');
  await signIn('pdt');
  await page.goto(`${base}/portal/complaints`);
  await page.getByText(/Closed/).first().waitFor();
  await shot('12-portal-complaints');

  console.log('6. Developer console: ledger proof, validate chain, tamper detection');
  await signIn('dev');
  await page.goto(`${base}/developer?lot=101`);
  await page.getByTestId('dev-actions').waitFor();
  await shot('13-developer-actions');
  await page.getByRole('tab', { name: /integrity/i }).click();
  await page.getByTestId('validate-chain').click();
  await page.getByText(/valid/i).first().waitFor();
  await page.getByTestId('tamper-preset-1').click();
  await page.getByTestId('tamper-run').click();
  await page.waitForTimeout(600);
  await page.getByTestId('validate-chain').click();
  await page.getByText(/RECORD_HASH_MISMATCH/).first().waitFor({ timeout: 15000 });
  await shot('14-tamper-detected', true);

  console.log('7. Owner dashboard');
  await signIn('admin');
  await page.getByTestId('owner-dashboard').waitFor();
  await shot('15-owner-dashboard', true);
  assert.equal(errors.length, 0, `Browser errors:\n${errors.join('\n')}`);
  console.log('TexTrace e2e passed — the Lot 101 hairiness scenario ran end to end.');
} finally {
  await browser.close();
  await resetDemo();
}
