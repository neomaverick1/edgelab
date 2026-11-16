// Reads price files exported from TradingView, Yahoo, MetaTrader, brokers and spreadsheets.
import type { Candle } from '../types';
import { tidy } from './core';

export interface CsvResult {
  candles: Candle[];
  granularity: number;
  columns: string;
}

const pick = (header: string[], ...names: RegExp[]) => header.findIndex((h) => names.some((n) => n.test(h)));

function parseDate(raw: string, dayFirst: boolean): number {
  const s = raw.trim().replace(/^"|"$/g, '');
  if (/^\d{9,13}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return n > 1e11 ? Math.floor(n / 1000) : Math.floor(n);
  }
  // 2024-03-01, 2024-03-01 13:00, 2024-03-01T13:00:00Z, 2024.03.01 13:00
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (m) {
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) / 1000;
    if (m[7] && m[7].toUpperCase() !== 'Z') {
      const sign = m[7][0] === '-' ? -1 : 1;
      const [hh, mm] = m[7].slice(1).replace(':', '').match(/(\d{2})(\d{2})/)!.slice(1).map(Number);
      return t - sign * (hh * 3600 + mm * 60);
    }
    return t;
  }
  // 03/01/2024 or 01.03.2024 (day first when the file says so)
  m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const year = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    const [d, mo] = dayFirst ? [+m[1], +m[2]] : [+m[2], +m[1]];
    return Date.UTC(year, mo - 1, d, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) / 1000;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? NaN : Math.floor(t / 1000);
}

const num = (s: string | undefined) => (s === undefined ? NaN : Number(s.trim().replace(/^"|"$/g, '').replace(/,(?=\d{3}\b)/g, '')));

export function parseCsv(text: string): CsvResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 3) throw new Error('The file needs a header row and at least two rows of prices.');
  const delim = [',', ';', '\t', '|'].map((d) => ({ d, n: lines[0].split(d).length })).sort((a, b) => b.n - a.n)[0].d;
  const split = (l: string) => l.split(delim).map((x) => x.trim());
  let header = split(lines[0]).map((h) => h.toLowerCase().replace(/[<>"]/g, '').trim());
  let body = lines.slice(1);
  const hasHeader = header.some((h) => /open|close|date|time/.test(h));
  if (!hasHeader) {
    header = ['date', 'open', 'high', 'low', 'close', 'volume'].slice(0, split(lines[0]).length);
    body = lines;
  }
  const iDate = pick(header, /^(date|datetime|timestamp|time|day|open time|opentime|date\/time|gmt time|local time)$/, /date/, /^time$/);
  const iTime = pick(header, /^time$/);
  const iOpen = pick(header, /^open$/, /^o$/, /open price/);
  const iHigh = pick(header, /^high$/, /^h$/, /high price/);
  const iLow = pick(header, /^low$/, /^l$/, /low price/);
  const iClose = pick(header, /^close$/, /^c$/, /^last$/, /close price|^price$/);
  const iAdj = pick(header, /adj\.? ?close/);
  const iVol = pick(header, /^vol(ume)?$/, /tickvol|volume/);
  if (iDate < 0 || iClose < 0) throw new Error('Couldn’t find a date column and a close column. Expected headers like Date, Open, High, Low, Close, Volume.');

  const rows = body.map(split);
  const firstFields = rows.slice(0, 200).map((r) => r[iDate]?.match(/^(\d{1,2})[-./](\d{1,2})[-./]\d{2,4}/));
  const dayFirst = firstFields.some((m) => m && +m[1] > 12);

  const candles: Candle[] = [];
  for (const r of rows) {
    const dateText = iTime >= 0 && iTime !== iDate ? `${r[iDate]} ${r[iTime]}` : r[iDate];
    const time = parseDate(dateText ?? '', dayFirst);
    const close = num(r[iClose]);
    if (!Number.isFinite(time) || !Number.isFinite(close)) continue;
    let open = iOpen >= 0 ? num(r[iOpen]) : close;
    let high = iHigh >= 0 ? num(r[iHigh]) : Math.max(open, close);
    let low = iLow >= 0 ? num(r[iLow]) : Math.min(open, close);
    let c = close;
    const adj = iAdj >= 0 ? num(r[iAdj]) : NaN;
    if (Number.isFinite(adj) && close > 0) {
      const k = adj / close;
      open *= k;
      high *= k;
      low *= k;
      c = adj;
    }
    candles.push({ time, open, high, low, close: c, volume: iVol >= 0 ? num(r[iVol]) || 0 : 0 });
  }
  const out = tidy(candles);
  if (out.length < 30) throw new Error(`Only ${out.length} usable rows were found; a backtest needs at least 30.`);
  const gaps = out.slice(1).map((c, i) => c.time - out[i].time).sort((a, b) => a - b);
  const granularity = gaps[Math.floor(gaps.length / 2)];
  return { candles: out, granularity, columns: header.join(', ') };
}

export function granularityLabel(sec: number): string {
  if (sec % 604_800 === 0) return `${sec / 604_800}W`;
  if (sec % 86_400 === 0) return `${sec / 86_400}D`;
  if (sec % 3_600 === 0) return `${sec / 3_600}H`;
  return `${Math.round(sec / 60)}m`;
}
