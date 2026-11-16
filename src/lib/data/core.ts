// Shared pieces of the data layer: timeframes, resampling and HTTP that also works inside the Android app.
import { Capacitor, CapacitorHttp } from '@capacitor/core';

import type { Candle } from '../types';

export type Timeframe = '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

export const TIMEFRAMES: { id: Timeframe; label: string; seconds: number }[] = [
  { id: '5m', label: '5m', seconds: 300 },
  { id: '15m', label: '15m', seconds: 900 },
  { id: '1h', label: '1H', seconds: 3_600 },
  { id: '4h', label: '4H', seconds: 14_400 },
  { id: '1d', label: '1D', seconds: 86_400 },
  { id: '1w', label: '1W', seconds: 604_800 },
];
export const seconds = (tf: Timeframe) => TIMEFRAMES.find((t) => t.id === tf)!.seconds;

/** True inside the Android app, where requests skip the browser's cross-site rules. */
export const isNative = () => Capacitor.isNativePlatform();

export class DataError extends Error {}

/** GET a JSON document. In the app it goes through the native HTTP stack, so sites without CORS work too. */
export async function getJson<T>(url: string, opts: { timeout?: number } = {}): Promise<T> {
  const timeout = opts.timeout ?? 20_000;
  if (isNative() && /^https?:/.test(url)) {
    const res = await CapacitorHttp.get({ url, connectTimeout: timeout, readTimeout: timeout, headers: { Accept: 'application/json' } });
    if (res.status < 200 || res.status >= 300) throw new DataError(`${new URL(url).host} answered ${res.status}`);
    return (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as T;
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new DataError(`${/^https?:/.test(url) ? new URL(url).host : 'Edgelab'} answered ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Runs async jobs with at most `limit` in flight. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const MONDAY = 4 * 86_400; // 1970-01-05 was a Monday

/**
 * Builds bigger bars from smaller ones (1h → 4h, 1d → 1w). Buckets are aligned to UTC, weeks start on Monday.
 * The last bucket is dropped when it isn't complete yet, so a resampled bar never changes after it appears.
 */
export function resample(candles: readonly Candle[], target: number, sourceSeconds: number, now = Date.now() / 1000): Candle[] {
  const offset = target === 604_800 ? MONDAY : 0;
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const c of candles) {
    const bucket = Math.floor((c.time - offset) / target) * target + offset;
    if (!cur || cur.time !== bucket) {
      if (cur) out.push(cur);
      cur = { time: bucket, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume += c.volume;
    }
  }
  if (cur) {
    const last = candles[candles.length - 1];
    const complete = last.time + sourceSeconds >= cur.time + target || now >= cur.time + target;
    if (complete) out.push(cur);
  }
  return out;
}

/** Sorts by time, drops duplicates and bars with missing prices. */
export function tidy(candles: Candle[]): Candle[] {
  const ok = candles.filter((c) => [c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v) && v > 0));
  ok.sort((a, b) => a.time - b.time);
  const out: Candle[] = [];
  for (const c of ok) {
    if (out.length && out[out.length - 1].time === c.time) out[out.length - 1] = c;
    else out.push({ ...c, volume: Number.isFinite(c.volume) ? c.volume : 0, high: Math.max(c.high, c.open, c.close), low: Math.min(c.low, c.open, c.close) });
  }
  return out;
}

/** Drops the bar that is still forming, so signals never repaint. */
export const closedOnly = (candles: Candle[], granularity: number, now = Date.now() / 1000) => candles.filter((c) => c.time + granularity <= now);
