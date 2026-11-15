import type { Candle } from './types';

export type Timeframe = '1d' | '6h' | '1h';

export const TIMEFRAMES: { id: Timeframe; label: string; seconds: number }[] = [
  { id: '1d', label: '1D', seconds: 86_400 },
  { id: '6h', label: '6H', seconds: 21_600 },
  { id: '1h', label: '1H', seconds: 3_600 },
];

export const seconds = (tf: Timeframe) => TIMEFRAMES.find((t) => t.id === tf)!.seconds;

/** Markets bundled in public/data (see scripts/fetch-data.mjs). */
export const MARKETS = [
  { id: 'BTC-USD', name: 'Bitcoin', short: 'BTC' },
  { id: 'ETH-USD', name: 'Ethereum', short: 'ETH' },
  { id: 'SOL-USD', name: 'Solana', short: 'SOL' },
  { id: 'DOGE-USD', name: 'Dogecoin', short: 'DOGE' },
];

export interface Series {
  market: string;
  tf: Timeframe;
  candles: Candle[];
  live: boolean; // topped up from Coinbase in this browser
  checkedAt: number; // when the data was last refreshed (ms)
}

const API = 'https://api.exchange.coinbase.com';
const PER_REQUEST = 300;
const KEEP_INTRADAY = 2000; // hourly and 6-hour series keep their most recent bars

type Row = [number, number, number, number, number, number];
const toCandle = ([time, open, high, low, close, volume]: Row): Candle => ({ time, open, high, low, close, volume });

async function snapshot(market: string, tf: Timeframe): Promise<Candle[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${market}-${tf}.json`);
  if (!res.ok) throw new Error(`Couldn't load ${market} ${tf} data (${res.status}).`);
  const body = (await res.json()) as { candles: Row[] };
  return body.candles.map(toCandle);
}

/**
 * Candles that closed after `after` (at least the latest one), straight from Coinbase's public API, which allows
 * browser requests. The candle that is still forming is left out, so signals never repaint.
 */
export async function fetchSince(market: string, granularity: number, after: number, now = Date.now() / 1000): Promise<Candle[]> {
  const lastClosed = Math.floor(now / granularity) * granularity - granularity;
  // Already up to date: still ask for the last candle, so "live" always means Coinbase answered.
  const from = Math.max(Math.min(after + granularity, lastClosed), lastClosed - (KEEP_INTRADAY - 1) * granularity);
  const rows = new Map<number, Candle>();
  for (let start = from; start <= lastClosed; start += PER_REQUEST * granularity) {
    const end = Math.min(start + (PER_REQUEST - 1) * granularity, lastClosed);
    const url = `${API}/products/${market}/candles?granularity=${granularity}&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Coinbase answered ${res.status}`);
    // Coinbase rows are [time, low, high, open, close, volume], newest first.
    for (const [t, low, high, open, close, volume] of (await res.json()) as Row[]) {
      if (t >= from && t <= lastClosed) rows.set(t, { time: t, open, high, low, close, volume });
    }
  }
  return [...rows.values()].sort((a, b) => a.time - b.time);
}

/** Merges new candles onto a series (newer wins) and trims intraday series to their most recent bars. */
export function merge(base: readonly Candle[], fresh: readonly Candle[], tf: Timeframe): Candle[] {
  if (!fresh.length) return [...base];
  const first = fresh[0].time;
  const out = base.filter((c) => c.time < first).concat(fresh);
  return tf === '1d' ? out : out.slice(-KEEP_INTRADAY);
}

const cache = new Map<string, Series>();

/** The bundled snapshot, topped up with the latest closed candles from Coinbase when the browser can reach it. */
export async function loadSeries(market: string, tf: Timeframe, opts: { refresh?: boolean } = {}): Promise<Series> {
  const key = `${market}-${tf}`;
  const cached = cache.get(key);
  if (cached && !opts.refresh) return cached;
  let candles = cached?.candles ?? (await snapshot(market, tf));
  let live = false;
  try {
    const fresh = await fetchSince(market, seconds(tf), candles[candles.length - 1].time);
    candles = merge(candles, fresh, tf);
    live = true;
  } catch {
    // Offline or rate-limited: the snapshot still works.
  }
  const series: Series = { market, tf, candles, live: live || !!cached?.live, checkedAt: Date.now() };
  cache.set(key, series);
  return series;
}
