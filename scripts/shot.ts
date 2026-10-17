// Dev helper: sign in as a seeded user, open a page, collect console errors, save a screenshot.
//   npx tsx scripts/shot.ts --base http://localhost:5173 --user qa --path /complaints --out /tmp/complaints.png
// Options: --api <url> (default: same origin as --base, via Vite proxy) --wait <ms> (default 1500) --full (full page)
//          --width 1440 --height 900 --dark --dev (Developer Mode ON) --click <css> (repeatable, clicked in order)
//          --waitFor <css> (wait for selector before screenshot)
// Prints a JSON summary: { url, title, consoleErrors, pageErrors, failedRequests, screenshot }.
import { chromium } from 'playwright';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]);
  });
  return out;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const base = arg('base', 'http://localhost:5173')!.replace(/\/$/, '');
const api = (arg('api') ?? base).replace(/\/$/, '');
const user = arg('user', 'admin')!;
const pagePath = arg('path', '/')!;
const out = arg('out', '/tmp/textrace-shot.png')!;
const wait = Number(arg('wait', '1500'));
const width = Number(arg('width', '1440'));
const height = Number(arg('height', '900'));

const res = await fetch(`${api}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: user }),
});
const json = (await res.json()) as { ok: boolean; data?: { token: string; user: unknown }; error?: unknown };
if (!json.ok || !json.data) {
  console.error('login failed', JSON.stringify(json.error));
  process.exit(1);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width, height }, colorScheme: has('dark') ? 'dark' : 'light' });
const { token, user: u } = json.data;
await context.addInitScript(
  ([t, usr, dark, dev]) => {
    localStorage.setItem('textrace.session', JSON.stringify({ state: { token: t, user: usr }, version: 0 }));
    if (dark) localStorage.setItem('textrace.theme', JSON.stringify({ state: { theme: 'dark' }, version: 0 }));
    if (dev) localStorage.setItem('textrace.devMode', JSON.stringify({ state: { enabled: true }, version: 0 }));
  },
  [token, u, has('dark'), has('dev')] as const,
);
const page = await context.newPage();
const consoleErrors: string[] = [];
const pageErrors: string[] = [];
const failedRequests: string[] = [];
page.on('console', (m) => {
  if (m.type() === 'error' || (m.type() === 'warning' && /React|key|act\(|deprecated/i.test(m.text()))) consoleErrors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('response', (r) => {
  if (r.status() >= 400 && r.url().includes('/api/')) failedRequests.push(`${r.status()} ${r.request().method()} ${r.url()}`);
});

await page.goto(`${base}${pagePath}`, { waitUntil: 'networkidle' });
const waitFor = arg('waitFor');
if (waitFor) await page.waitForSelector(waitFor, { timeout: 15000 }).catch(() => pageErrors.push(`waitFor timeout: ${waitFor}`));
for (const sel of args('click')) {
  await page.click(sel, { timeout: 10000 }).catch((e) => pageErrors.push(`click failed ${sel}: ${String(e).slice(0, 200)}`));
  await page.waitForTimeout(400);
}
await page.waitForTimeout(wait);
await page.screenshot({ path: out, fullPage: has('full') });
console.log(JSON.stringify({ url: page.url(), title: await page.title(), consoleErrors, pageErrors, failedRequests, screenshot: out }, null, 2));
await browser.close();
