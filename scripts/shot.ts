// Dev helper: sign in as a seeded user, open a page, collect console errors, save a screenshot.
//   npx tsx scripts/shot.ts --user qa --path /lots/LOT-101 --out /tmp/lot101.png [--full] [--dark] [--width 1440] [--height 900]
//        [--click "text=Quality"] (repeatable, clicked in order) [--wait 1200] [--base http://localhost:5173] [--scrollTo "css"]
// Prints JSON: { url, title, consoleErrors, pageErrors, failedRequests, screenshot }
import fs from 'node:fs';
import { chromium } from 'playwright';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const args = (n: string) => process.argv.flatMap((a, i) => (a === `--${n}` && process.argv[i + 1] ? [process.argv[i + 1]] : []));
const has = (n: string) => process.argv.includes(`--${n}`);
const base = (arg('base', 'http://localhost:5173') as string).replace(/\/$/, '');
const user = arg('user', 'admin') as string;
const out = arg('out', '/tmp/textrace-shot.png') as string;
const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user }) });
const json = (await res.json()) as { ok: boolean; data?: { token: string; user: unknown }; error?: unknown };
if (!json.ok || !json.data) { console.error('login failed', JSON.stringify(json.error)); process.exit(1); }
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, ...(fs.existsSync(chrome) ? { executablePath: chrome } : {}) });
try {
  const ctx = await browser.newContext({ viewport: { width: Number(arg('width', '1440')), height: Number(arg('height', '900')) }, colorScheme: has('dark') ? 'dark' : 'light' });
  const { token, user: u } = json.data;
  await ctx.addInitScript(([t, usr, dark, dev]) => {
    localStorage.setItem('textrace.session', JSON.stringify({ state: { token: t, user: usr }, version: 0 }));
    localStorage.setItem('textrace.ui', JSON.stringify({ state: { theme: dark ? 'dark' : 'light', dev, count: 'ALL', judge: 'asOf' }, version: 0 }));
  }, [token, u, has('dark'), has('dev')] as const);
  const page = await ctx.newPage();
  const consoleErrors: string[] = []; const pageErrors: string[] = []; const failed: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /React|key|act\(|deprecated/i.test(m.text()))) consoleErrors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) failed.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${base}${arg('path', '/')}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(Number(arg('wait', '1500')));
  for (const sel of args('click')) { await page.locator(sel).first().click(); await page.waitForTimeout(700); }
  if (arg('scrollTo')) await page.locator(arg('scrollTo') as string).first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: out, fullPage: has('full') });
  console.log(JSON.stringify({ url: page.url(), title: await page.title(), consoleErrors, pageErrors, failedRequests: failed, screenshot: out }, null, 2));
} finally { await browser.close(); }
