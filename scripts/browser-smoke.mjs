import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://127.0.0.1:4189/';
const OUT = '.selftest/shots';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1560,1000', '--use-gl=swiftshader'],
  defaultViewport: { width: 1560, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console.error: ' + m.text());
});

try {
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('.preset', { timeout: 15000 });
  await sleep(800);
  await page.screenshot({ path: `${OUT}/1-import.png` });
  console.log('import ok, presets=', await page.$$eval('.preset', (e) => e.length));

  const genBtn = await page.evaluateHandle(() =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('生成该样例')),
  );
  await genBtn.asElement().click();
  await page.waitForFunction(() => location.hash.includes('gcp'), { timeout: 60000 });
  await page.waitForSelector('.viewer svg g', { timeout: 60000 });
  await sleep(1200);
  await page.screenshot({ path: `${OUT}/2-gcp.png` });
  console.log('gcp markers=', await page.$$eval('.viewer svg g', (e) => e.length));

  const corr = await page.evaluateHandle(() =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('解算单应')),
  );
  await corr.asElement().click();
  await page.waitForSelector('button.success', { timeout: 60000 });
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/2-gcp-ortho.png` });

  await page.click('button.success'); // 进入识别
  await sleep(500);
  const run = await page.evaluateHandle(() =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('开始识别')),
  );
  if (run.asElement()) await run.asElement().click();
  await page.waitForSelector('.det-row', { timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('.det-row').length >= 35, { timeout: 60000 });
  await sleep(1500);
  const kpi = await page.$$eval('.kpi .v', (e) => e.slice(0, 3).map((x) => x.textContent));
  console.log('detect kpi=', JSON.stringify(kpi), 'rows=', await page.$$eval('.det-row', (e) => e.length));
  await page.screenshot({ path: `${OUT}/3-detect.png` });

  const toResult = await page.evaluateHandle(() =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('核对成绩')),
  );
  await toResult.asElement().click();
  await page.waitForSelector('.rank-table tbody tr', { timeout: 30000 });
  await sleep(1200);
  const rankRows = await page.$$eval('.rank-table tbody tr', (e) => e.length);
  const acc = await page.$eval('.accuracy-card', (e) => e.innerText.replace(/\n/g, ' | ')).catch(() => 'n/a');
  console.log('rank rows=', rankRows);
  console.log('accuracy=', acc.slice(0, 220));
  await page.screenshot({ path: `${OUT}/4-results.png`, fullPage: false });

  // 发布
  const pub = await page.evaluateHandle(() =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('锁定并发布')),
  );
  if (pub.asElement()) await pub.asElement().click();
  await sleep(400);
} catch (e) {
  console.error('SMOKE FAIL', e);
  await page.screenshot({ path: `${OUT}/error.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  console.log('JS errors:', errors.length ? '\n' + errors.slice(0, 12).join('\n') : 'none');
  await browser.close();
}
