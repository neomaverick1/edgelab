// Builds the web version's market snapshot: daily and hourly bars for the ~200 stocks, ETFs, indexes, forex pairs
// and futures in src/data/universe.json (Yahoo Finance), plus a fallback copy of the main crypto pairs (Coinbase).
// Runs in CI before each deploy and every day on a schedule. The Android app loads markets live instead.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const OUT = new URL('../public/data/markets/', import.meta.url);
const universe = JSON.parse(await readFile(new URL('../src/data/universe.json', import.meta.url), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const updated = new Date().toISOString();
const round = (v) => (v == null || !Number.isFinite(v) ? null : +v.toPrecision(7));

async function get(url, tries = 5) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (edgelab-data)', Accept: 'application/json' } });
      if (res.ok) return res.json();
      if (res.status === 404) throw new Error('404');
      if (i >= tries) throw new Error(`${res.status} for ${url}`);
    } catch (e) {
      if (String(e.message) === '404' || i >= tries) throw e;
    }
    await sleep(1500 * i);
  }
}

async function yahoo(symbol, interval, query) {
  const body = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&${query}&includePrePost=false&events=div%2Csplits`);
  const r = body.chart?.result?.[0];
  if (!r?.timestamp?.length) throw new Error('no data');
  const q = r.indicators.quote[0];
  const adj = r.indicators.adjclose?.[0]?.adjclose;
  const now = Date.now() / 1000;
  const span = interval === '1d' ? 86400 : 3600;
  const rows = [];
  r.timestamp.forEach((t, i) => {
    const k = adj && q.close[i] ? adj[i] / q.close[i] : 1;
    const row = [t, round(q.open[i] * k), round(q.high[i] * k), round(q.low[i] * k), round(q.close[i] * k), Math.round(q.volume[i] ?? 0)];
    if (row.slice(1, 5).every((v) => v !== null && v > 0) && t + span <= now) rows.push(row);
  });
  return rows;
}

async function coinbase(product, granularity, bars) {
  const now = Math.floor(Date.now() / 1000);
  const last = Math.floor(now / granularity) * granularity - granularity;
  const from = last - (bars - 1) * granularity;
  const rows = new Map();
  for (let s = from; s <= last; s += 300 * granularity) {
    const e = Math.min(s + 299 * granularity, last);
    const data = await get(`https://api.exchange.coinbase.com/products/${product}/candles?granularity=${granularity}&start=${new Date(s * 1000).toISOString()}&end=${new Date(e * 1000).toISOString()}`);
    for (const [t, low, high, open, close, volume] of data) if (t >= from && t <= last) rows.set(t, [t, open, high, low, close, round(volume)]);
    await sleep(120);
  }
  return [...rows.values()].sort((a, b) => a[0] - b[0]);
}

const safe = (s) => s.replace(/[^A-Za-z0-9.=-]/g, '_');
await mkdir(OUT, { recursive: true });

let ok = 0;
const failed = [];
const queue = universe.slice();
const since2005 = Math.floor(Date.UTC(2005, 0, 1) / 1000);
async function worker() {
  while (queue.length) {
    const { s } = queue.shift();
    try {
      const daily = await yahoo(s, '1d', `period1=${since2005}&period2=${Math.floor(Date.now() / 1000)}`);
      await writeFile(new URL(`${safe(s)}-1d.json`, OUT), JSON.stringify({ symbol: s, updated, rows: daily }));
      try {
        const hourly = await yahoo(s, '60m', 'range=730d');
        await writeFile(new URL(`${safe(s)}-1h.json`, OUT), JSON.stringify({ symbol: s, updated, rows: hourly }));
      } catch (e) {
        console.warn(`${s} hourly: ${e.message}`);
      }
      ok++;
      console.log(`${s}: ${daily.length} daily bars`);
    } catch (e) {
      failed.push(s);
      console.warn(`${s}: ${e.message}`);
    }
    await sleep(250);
  }
}
await Promise.all([worker(), worker(), worker()]);

for (const p of ['BTC-USD', 'ETH-USD', 'SOL-USD', 'DOGE-USD']) {
  try {
    await writeFile(new URL(`coinbase-${p}-1d.json`, OUT), JSON.stringify({ symbol: p, updated, rows: await coinbase(p, 86400, 4200) }));
    await writeFile(new URL(`coinbase-${p}-1h.json`, OUT), JSON.stringify({ symbol: p, updated, rows: await coinbase(p, 3600, 4380) }));
    console.log(`${p}: crypto fallback saved`);
  } catch (e) {
    console.warn(`${p}: ${e.message}`);
  }
}

console.log(`\n${ok} of ${universe.length} markets saved${failed.length ? `; missing: ${failed.join(', ')}` : ''}`);
if (ok < universe.length * 0.5) {
  console.error('Fewer than half the markets came back; failing so the last good snapshot stays live.');
  process.exit(1);
}
