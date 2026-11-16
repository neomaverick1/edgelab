// Where prices come from: Coinbase and Binance (live, any pair), Yahoo Finance (live in the Android app, a daily
// snapshot of popular markets on the web) and your own CSV files.
import UNIVERSE from '../../data/universe.json';
import type { Candle } from '../types';
import { closedOnly, DataError, getJson, isNative, pool, resample, seconds, tidy, type Timeframe } from './core';

export type AssetKind = 'crypto' | 'stock' | 'etf' | 'index' | 'forex' | 'future' | 'custom';
export type SourceId = 'coinbase' | 'binance' | 'yahoo' | 'csv';

export interface Asset {
  id: string; // "coinbase:BTC-USD", "binance:BTCUSDT", "yahoo:AAPL", "csv:<name>"
  source: SourceId;
  symbol: string; // what the source calls it
  name: string;
  kind: AssetKind;
  display: string; // short ticker for the UI, e.g. "BTC/USD", "AAPL", "EUR/USD"
}

export interface Series {
  asset: Asset;
  tf: Timeframe;
  candles: Candle[];
  granularity: number;
  live: boolean; // straight from the source just now
  note?: string; // e.g. "Daily snapshot from GitHub, updated 2026-11-15"
  loadedAt: number;
}

export const SOURCE_LABEL: Record<SourceId, string> = { coinbase: 'Coinbase', binance: 'Binance', yahoo: 'Yahoo Finance', csv: 'Your file' };

/** Which timeframes each source can serve here. */
export function timeframesFor(a: Asset): Timeframe[] {
  if (a.source === 'csv') return [];
  if (a.source === 'yahoo' && !isNative()) return ['1h', '4h', '1d', '1w'];
  return ['5m', '15m', '1h', '4h', '1d', '1w'];
}

// ---------------------------------------------------------------------------------------------------------------
// Coinbase

const CB = 'https://api.exchange.coinbase.com';
const CB_NATIVE: Partial<Record<Timeframe, number>> = { '5m': 300, '15m': 900, '1h': 3600, '1d': 86400 };
type CbRow = [number, number, number, number, number, number];

async function coinbase(symbol: string, tf: Timeframe): Promise<Candle[]> {
  const base: Timeframe = tf === '4h' ? '1h' : tf === '1w' ? '1d' : tf;
  const g = CB_NATIVE[base]!;
  const now = Math.floor(Date.now() / 1000);
  const last = Math.floor(now / g) * g - g;
  const bars = { '5m': 4000, '15m': 4000, '1h': 8_760, '1d': 4_200 }[base as '5m' | '15m' | '1h' | '1d'];
  const from = last - (bars - 1) * g;
  const chunks: [number, number][] = [];
  for (let s = from; s <= last; s += 300 * g) chunks.push([s, Math.min(s + 299 * g, last)]);
  const rows = await pool(chunks.reverse(), 4, async ([s, e]) => {
    const url = `${CB}/products/${symbol}/candles?granularity=${g}&start=${new Date(s * 1000).toISOString()}&end=${new Date(e * 1000).toISOString()}`;
    for (let attempt = 0; ; attempt++) {
      try {
        return await getJson<CbRow[]>(url);
      } catch (err) {
        if (attempt >= 2) throw err;
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
  });
  // Coinbase rows are [time, low, high, open, close, volume].
  const candles = tidy(rows.flat().map(([t, low, high, open, close, volume]) => ({ time: t, open, high, low, close, volume })));
  if (!candles.length) throw new DataError(`Coinbase has no ${tf} data for ${symbol}.`);
  return base === tf ? candles : resample(candles, seconds(tf), g);
}

export async function coinbaseAssets(): Promise<Asset[]> {
  type P = { id: string; base_currency: string; quote_currency: string; status: string; trading_disabled?: boolean };
  const list = await getJson<P[]>(`${CB}/products`);
  return list
    .filter((p) => p.status === 'online' && !p.trading_disabled)
    .map((p) => ({ id: `coinbase:${p.id}`, source: 'coinbase' as const, symbol: p.id, name: `${p.base_currency} / ${p.quote_currency}`, kind: 'crypto' as const, display: `${p.base_currency}/${p.quote_currency}` }));
}

// ---------------------------------------------------------------------------------------------------------------
// Binance (the public market-data mirror, which allows browser requests worldwide)

const BN = 'https://data-api.binance.vision/api/v3';
type BnRow = [number, string, string, string, string, string, number, ...unknown[]];
const BN_BARS: Record<Timeframe, number> = { '5m': 5000, '15m': 5000, '1h': 8760, '4h': 6000, '1d': 4000, '1w': 1000 };

async function binance(symbol: string, tf: Timeframe): Promise<Candle[]> {
  const g = seconds(tf);
  const now = Date.now();
  const startMs = now - BN_BARS[tf] * g * 1000;
  const starts: number[] = [];
  for (let s = startMs; s < now; s += 1000 * g * 1000) starts.push(s);
  const rows = await pool(starts, 4, (s) => getJson<BnRow[]>(`${BN}/klines?symbol=${symbol}&interval=${tf}&startTime=${Math.floor(s)}&limit=1000`));
  const candles = tidy(
    rows
      .flat()
      .filter((r) => r[6] < now)
      .map((r) => ({ time: Math.floor(r[0] / 1000), open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] })),
  );
  if (!candles.length) throw new DataError(`Binance has no ${tf} data for ${symbol}.`);
  return candles;
}

const QUOTES = ['USDT', 'FDUSD', 'USDC', 'TUSD', 'BTC', 'ETH', 'BNB', 'EUR', 'TRY', 'BRL', 'JPY', 'GBP', 'AUD', 'DAI'];
export async function binanceAssets(): Promise<Asset[]> {
  const list = await getJson<{ symbol: string; price: string }[]>(`${BN}/ticker/price`);
  const out: Asset[] = [];
  for (const { symbol, price } of list) {
    if (!(+price > 0)) continue;
    const q = QUOTES.find((x) => symbol.endsWith(x) && symbol.length > x.length);
    if (!q) continue;
    const base = symbol.slice(0, -q.length);
    out.push({ id: `binance:${symbol}`, source: 'binance', symbol, name: `${base} / ${q}`, kind: 'crypto', display: `${base}/${q}` });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Yahoo Finance

const YH = 'https://query1.finance.yahoo.com';
interface YChart {
  chart: {
    result: {
      meta: { symbol: string; longName?: string; shortName?: string; instrumentType?: string; currency?: string; gmtoffset?: number };
      timestamp?: number[];
      indicators: { quote: { open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] }[]; adjclose?: { adjclose: number[] }[] };
    }[];
    error: { description: string } | null;
  };
}

async function yahooLive(symbol: string, tf: Timeframe): Promise<Candle[]> {
  const native: Record<Timeframe, [string, string]> = {
    '5m': ['5m', '60d'],
    '15m': ['15m', '60d'],
    '1h': ['60m', '730d'],
    '4h': ['60m', '730d'],
    '1d': ['1d', 'max'],
    '1w': ['1wk', 'max'],
  };
  const [interval, range] = native[tf];
  const body = await getJson<YChart>(`${YH}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false&events=div%2Csplits`);
  const r = body.chart.result?.[0];
  if (!r?.timestamp?.length) throw new DataError(body.chart.error?.description ?? `Yahoo Finance has no data for ${symbol}.`);
  const q = r.indicators.quote[0];
  const adj = r.indicators.adjclose?.[0]?.adjclose;
  const raw = r.timestamp.map((t, i) => {
    const k = adj && q.close[i] ? adj[i] / q.close[i] : 1;
    return { time: t, open: q.open[i] * k, high: q.high[i] * k, low: q.low[i] * k, close: q.close[i] * k, volume: q.volume[i] ?? 0 };
  });
  let candles = tidy(raw);
  if (tf === '4h') candles = resample(candles, 14_400, 3600);
  return closedOnly(candles, Math.min(seconds(tf), 86_400));
}

type SnapRow = [number, number, number, number, number, number];
async function yahooSnapshot(symbol: string, tf: Timeframe): Promise<{ candles: Candle[]; updated: string }> {
  const file = tf === '1h' || tf === '4h' ? '1h' : '1d';
  const safe = symbol.replace(/[^A-Za-z0-9.=-]/g, '_');
  const body = await getJson<{ updated: string; rows: SnapRow[] }>(`${import.meta.env.BASE_URL}data/markets/${safe}-${file}.json`);
  let candles = body.rows.map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }));
  if (tf === '4h') candles = resample(candles, 14_400, 3600);
  if (tf === '1w') candles = resample(candles, 604_800, 86_400);
  return { candles, updated: body.updated };
}

export interface YahooHit {
  symbol: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
  exchDisp?: string;
}
export async function yahooSearch(q: string): Promise<Asset[]> {
  const body = await getJson<{ quotes: YahooHit[] }>(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0&listsCount=0`);
  return (body.quotes ?? [])
    .filter((h) => h.symbol && h.quoteType !== 'OPTION')
    .map((h) => yahooAsset(h.symbol, h.longname ?? h.shortname ?? h.symbol, kindOf(h.quoteType, h.symbol)));
}

const kindOf = (t: string | undefined, symbol: string): AssetKind => {
  if (symbol.endsWith('=X')) return 'forex';
  if (symbol.endsWith('=F')) return 'future';
  if (symbol.startsWith('^')) return 'index';
  return t === 'ETF' || t === 'MUTUALFUND' ? 'etf' : t === 'CRYPTOCURRENCY' ? 'crypto' : t === 'INDEX' ? 'index' : t === 'FUTURE' ? 'future' : t === 'CURRENCY' ? 'forex' : 'stock';
};

export function yahooAsset(symbol: string, name: string, kind: AssetKind): Asset {
  const display = kind === 'forex' ? symbol.replace('=X', '').replace(/^(\w{3})(\w{3})$/, '$1/$2') : symbol.replace(/^\^/, '');
  return { id: `yahoo:${symbol}`, source: 'yahoo', symbol, name, kind, display };
}

/** Markets bundled for the web version (and always suggested). */
export const YAHOO_UNIVERSE: Asset[] = (UNIVERSE as { s: string; n: string; k: AssetKind }[]).map((u) => yahooAsset(u.s, u.n, u.k));

// ---------------------------------------------------------------------------------------------------------------
// Your own files

const customs = new Map<string, { candles: Candle[]; granularity: number }>();
export function registerCsv(name: string, candles: Candle[], granularity: number): Asset {
  const id = `csv:${name}`;
  customs.set(id, { candles, granularity });
  return { id, source: 'csv', symbol: name, name, kind: 'custom', display: name.replace(/\.(csv|txt)$/i, '').slice(0, 18) };
}
export const csvData = (id: string) => customs.get(id);

// ---------------------------------------------------------------------------------------------------------------

const cache = new Map<string, Series>();

export async function loadSeries(asset: Asset, tf: Timeframe, opts: { refresh?: boolean } = {}): Promise<Series> {
  const key = `${asset.id}|${tf}`;
  const hit = cache.get(key);
  if (hit && !opts.refresh && Date.now() - hit.loadedAt < 5 * 60_000) return hit;
  let series: Series;
  if (asset.source === 'csv') {
    const d = customs.get(asset.id);
    if (!d) throw new DataError('That file is no longer loaded. Add it again.');
    series = { asset, tf, candles: d.candles, granularity: d.granularity, live: false, note: 'Your file', loadedAt: Date.now() };
  } else if (asset.source === 'coinbase') {
    try {
      series = { asset, tf, candles: await coinbase(asset.symbol, tf), granularity: seconds(tf), live: true, loadedAt: Date.now() };
    } catch (err) {
      // Coinbase unreachable: fall back to the bundled copy of the main pairs.
      const { candles, updated } = await yahooSnapshot(`coinbase-${asset.symbol}`, tf).catch(() => {
        throw err;
      });
      series = { asset, tf, candles, granularity: seconds(tf), live: false, note: `Coinbase unreachable; snapshot from ${updated.slice(0, 10)}`, loadedAt: Date.now() };
    }
  } else if (asset.source === 'binance') {
    series = { asset, tf, candles: await binance(asset.symbol, tf), granularity: seconds(tf), live: true, loadedAt: Date.now() };
  } else if (isNative()) {
    series = { asset, tf, candles: await yahooLive(asset.symbol, tf), granularity: seconds(tf), live: true, loadedAt: Date.now() };
  } else {
    if (!timeframesFor(asset).includes(tf)) throw new DataError(`On the web, ${asset.display} has hourly, 4-hour, daily and weekly bars. The Android app has every timeframe live.`);
    try {
      const { candles, updated } = await yahooSnapshot(asset.symbol, tf);
      series = { asset, tf, candles, granularity: seconds(tf), live: false, note: `Snapshot updated ${updated.slice(0, 10)}`, loadedAt: Date.now() };
    } catch {
      throw new DataError(`${asset.display} isn’t in the web snapshot. The Android app loads any ticker live, or you can upload a CSV.`);
    }
  }
  if (series.candles.length < 30) throw new DataError(`Only ${series.candles.length} bars of ${asset.display} came back; pick a longer timeframe.`);
  cache.set(key, series);
  return series;
}
