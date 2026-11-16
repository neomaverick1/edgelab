// Run it with `node scripts/shots.mjs` after `npm run data && npm run build`.
// Takes the README screenshots from a production build with real market data (run by the Screenshots workflow).
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const OUT = 'docs/screenshots';
const URL = 'http://localhost:4173/';
await mkdir(OUT, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 4000));

const browser = await chromium.launch();
const wait = (p, ms) => p.waitForTimeout(ms);

async function open(viewport, scale = 2) {
  const p = await browser.newPage({ viewport, deviceScaleFactor: scale });
  p.on('pageerror', (e) => console.error('page error:', e.message));
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.clear());
  await p.goto(URL, { waitUntil: 'networkidle' });
  await wait(p, 2500);
  return p;
}

async function market(p, query, label) {
  await p.getByRole('button', { name: /^Market:/ }).click();
  await p.getByRole('textbox', { name: 'Search markets' }).fill(query);
  await wait(p, 1500);
  await p.getByRole('option').filter({ hasText: label }).first().click();
  await wait(p, 5000);
}
async function preset(p, name) {
  await p.getByRole('button', { name: 'Strategy library' }).click();
  await p.getByRole('button').filter({ hasText: name }).first().click();
  await wait(p, 1500);
}
async function period(p, label) {
  await p.getByRole('group', { name: 'Period' }).getByRole('button', { name: label }).click();
  await wait(p, 1200);
}
const shot = async (p, name, opts = {}) => {
  await p.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 88, ...opts });
  console.log('saved', name);
};

try {
  // 1. Backtest overview: Turtle breakout on Bitcoin
  let p = await open({ width: 1440, height: 900 });
  await preset(p, 'Turtle breakout');
  await period(p, '5Y');
  await shot(p, 'overview');

  // 2. Trades and chart
  await p.evaluate(() => document.querySelector('.main').scrollTo(0, 640));
  await wait(p, 800);
  await shot(p, 'chart');

  // 3. Plain English
  await p.evaluate(() => document.querySelector('.main').scrollTo(0, 0));
  await p.getByRole('textbox', { name: 'Strategy in plain English' }).fill('Buy when RSI 14 is below 35 and close is above the 200 EMA. Sell when RSI crosses above 65. Stop loss 2 ATR, take half at 1.5R and the rest at 4R, exit after 20 bars.');
  await p.getByRole('button', { name: 'Build rules' }).click();
  await wait(p, 2500);
  await shot(p, 'english');

  // 4. Robustness lab
  await preset(p, 'EMA cross + ATR trail');
  await p.getByRole('tab', { name: 'Robustness' }).click();
  await wait(p, 800);
  await p.getByRole('button', { name: 'Run every test' }).click();
  await wait(p, 25000);
  await shot(p, 'robustness');
  await p.evaluate(() => document.querySelector('.main').scrollTo(0, 560));
  await wait(p, 600);
  await shot(p, 'stability');
  await p.evaluate(() => document.querySelector('.main').scrollTo(0, 99999));
  await wait(p, 600);
  await shot(p, 'monte-carlo');

  // 5. Compare the classics on the S&P 500 ETF
  await p.getByRole('tab', { name: 'Backtest' }).click();
  await market(p, 'SPY', 'SPY');
  await period(p, '5Y');
  await p.getByRole('tab', { name: 'Compare' }).click();
  await wait(p, 800);
  await p.getByRole('button', { name: /All classics on/ }).click();
  await wait(p, 12000);
  await p.evaluate(() => document.querySelector('.main').scrollTo(0, 820));
  await wait(p, 800);
  await shot(p, 'compare');

  // 6. Stocks: RSI dip on Apple
  await p.getByRole('tab', { name: 'Backtest' }).click();
  await market(p, 'AAPL', 'AAPL');
  await preset(p, 'RSI dip in an uptrend');
  await period(p, '5Y');
  await shot(p, 'stocks');

  // 7. Pine Script
  await p.getByRole('tab', { name: 'Pine & share' }).click();
  await wait(p, 800);
  await shot(p, 'pine');

  // 8. Live paper trading on Bitcoin, from a month ago
  await market(p, 'BTC', 'BTC/USD');
  await preset(p, 'Supertrend flip');
  await p.getByRole('tab', { name: 'Live' }).click();
  await wait(p, 600);
  await p.getByRole('button', { name: 'From a month ago' }).click();
  await p.getByRole('button', { name: /^Start / }).click();
  await wait(p, 12000);
  await shot(p, 'live');
  await p.close();

  // 9. Phone
  p = await open({ width: 390, height: 844 }, 3);
  await preset(p, 'Turtle breakout');
  await period(p, '5Y');
  await shot(p, 'phone-results');
  await p.getByRole('tab', { name: 'Strategy' }).click();
  await wait(p, 800);
  await shot(p, 'phone-builder');
  await p.getByRole('tab', { name: 'Lab' }).click();
  await wait(p, 600);
  await p.getByRole('button', { name: 'Run every test' }).click();
  await wait(p, 20000);
  await shot(p, 'phone-lab');
  await p.close();
} finally {
  await browser.close();
  server.kill();
}
