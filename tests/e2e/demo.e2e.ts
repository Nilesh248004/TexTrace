import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const baseUrl = process.env.TEXTRACE_BASE_URL ?? 'http://localhost:5173';
const systemChrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, ...(fs.existsSync(systemChrome) ? { executablePath: systemChrome } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('login-user-qa').click();
  await page.getByTestId('kpi-ledger').waitFor({ state: 'visible', timeout: 15000 });
  await page.goto(`${baseUrl}/analysis/ai?lotId=LOT-182-2026&complaintId=CMP-22-2026&department=RF&machineId=RF-3&dayIndex=2&parameter=U&source=heatmap`);
  const previousBlock = await page.locator('.block-chip').innerText();
  await page.getByTestId('run-analysis').click();
  await page.getByTestId('root-cause-RF_BREAK_DRAFT').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction((previous) => document.querySelector('.block-chip')?.textContent !== previous, previousBlock, { timeout: 10000 });
  const evidence = await page.locator('.analysis-result').innerText();
  assert.match(evidence, /RF-3/);
  assert.match(evidence, /D2/);
  await page.goto(`${baseUrl}/dispatch/new?customerId=CUST-PDT&countId=30CH&lotIds=LOT-182-2026&qty=2000&date=2026-10-09&packWeight=50&cones=1200&vehicle=TN%2039%20AB%204521&lr=LR%2F26%2F7781`);
  await page.getByTestId('dispatch-form').waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await page.getByTestId('field-qty').inputValue(), '2000');
  assert.equal(await page.getByTestId('field-vehicle').inputValue(), 'TN 39 AB 4521');
  assert.equal(pageErrors.length, 0, `Browser errors: ${pageErrors.join('; ')}`);
  console.log(`TexTrace browser smoke passed at ${baseUrl}: QA sign-in, RF-3/D2 analysis, dispatch prefill.`);
} finally {
  await browser.close();
}