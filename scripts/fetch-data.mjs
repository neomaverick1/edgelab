// Downloads daily, 6-hour and 1-hour candles from Coinbase's public market data API (no key needed)
// into public/data, so the app always has a snapshot to fall back on. The app tops it up live in the browser.
import { mkdir, writeFile } from 'node:fs/promises';

const API = 'https://api.exchange.coinbase.com';
const OUT = new URL('../public/data/', import.meta.url);
const MARKETS = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'DOGE-USD']; // keep in step with MARKETS in src/lib/data.ts
const FRAMES = [
  { id: '1d', granularity: 86400, since: Date.UTC(2017, 0, 1) / 1000 },
  { id: '6h', granularity: 21600, bars: 2000 },
  { id: '1h', granularity: 3600, bars: 2000 },
];
const PER_REQUEST = 300; // Coinbase returns at most 300 candles per request
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 4) {
  for (let i = 1; ; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'edgelab-data-script' } });
    if (res.ok) return res.json();
    if (i >= tries) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    await sleep(1000 * i);
  }
}

async function candles(market, { granularity, since, bars }) {
  const now = Math.floor(Date.now() / 1000);
  const lastClosed = Math.floor(now / granularity) * granularity - granularity; // open time of the last finished candle
  const from = since ?? lastClosed - (bars - 1) * granularity;
  const rows = new Map();
  for (let start = from; start <= lastClosed; start += PER_REQUEST * granularity) {
    const end = Math.min(start + (PER_REQUEST - 1) * granularity, lastClosed);
    const url = `${API}/products/${market}/candles?granularity=${granularity}&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`;
    for (const [t, low, high, open, close, volume] of await get(url)) {
      if (t >= from && t <= lastClosed) rows.set(t, [t, open, high, low, close, Math.round(volume * 100) / 100]);
    }
    await sleep(150);
  }
  return [...rows.values()].sort((a, b) => a[0] - b[0]);
}

await mkdir(OUT, { recursive: true });
const updated = new Date().toISOString();
for (const market of MARKETS) {
  for (const f of FRAMES) {
    const rows = await candles(market, f);
    if (!rows.length) throw new Error(`No candles for ${market} ${f.id}`);
    await writeFile(new URL(`${market}-${f.id}.json`, OUT), JSON.stringify({ market, granularity: f.granularity, updated, candles: rows }));
    const day = (t) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ');
    console.log(`${market} ${f.id}: ${rows.length} candles, ${day(rows[0][0])} → ${day(rows.at(-1)[0])} UTC`);
  }
}
