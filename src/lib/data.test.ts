import { describe, expect, it } from 'vitest';

import { inputsOf } from './catalog';
import { resample } from './data/core';
import { parseCsv } from './data/csv';
import * as ta from './indicators';
import { INDICATORS } from './catalog';
import { blankStrategy, group, ind, num, rule, tunables } from './rules';
import { axisValues, grid, monteCarlo, walkForward } from './robustness';
import type { Candle } from './types';

const series = (n: number, seed = 1): Candle[] => {
  let p = 100;
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, (_, i) => {
    const o = p;
    p = Math.max(1, p * (1 + (rand() - 0.48) * 0.04));
    const h = Math.max(o, p) * (1 + rand() * 0.01);
    const l = Math.min(o, p) * (1 - rand() * 0.01);
    return { time: i * 86_400, open: o, high: h, low: l, close: p, volume: 1000 + rand() * 500 };
  });
};

describe('indicators', () => {
  it('match textbook values', () => {
    expect(ta.sma([1, 2, 3, 4, 5], 3).slice(2)).toEqual([2, 3, 4]);
    expect(ta.ema([1, 2, 3, 4, 5], 3)[2]).toBe(2);
    expect(ta.ema([1, 2, 3, 4, 5], 3)[3]).toBe(3);
    expect(ta.highest([1, 3, 2, 5, 4], 2)).toEqual([NaN, 3, 3, 5, 5]);
    expect(ta.lowest([5, 3, 4, 1, 2], 3)).toEqual([NaN, NaN, 3, 1, 1]);
    const r = ta.rsi(Array.from({ length: 30 }, (_, i) => i), 14);
    expect(r[29]).toBe(100);
  });

  it('every catalog indicator returns full-length series', () => {
    const c = series(300);
    const d = inputsOf(c);
    for (const def of INDICATORS) {
      const out = def.compute(d, def.params.map((p) => p.def), d.close);
      for (const o of def.outputs) {
        expect(out[o.key], `${def.id}.${o.key}`).toHaveLength(300);
        expect(out[o.key].slice(-50).every((v) => Number.isFinite(v)), `${def.id}.${o.key}`).toBe(true);
      }
    }
  });
});

describe('resample', () => {
  it('builds 4-hour bars and drops the unfinished one', () => {
    const hourly: Candle[] = Array.from({ length: 10 }, (_, i) => ({ time: i * 3600, open: i, high: i + 1, low: i - 1, close: i + 0.5, volume: 1 }));
    const four = resample(hourly, 14_400, 3600, 10 * 3600);
    expect(four).toHaveLength(2);
    expect(four[0]).toEqual({ time: 0, open: 0, high: 4, low: -1, close: 3.5, volume: 4 });
  });

  it('starts weeks on Monday', () => {
    const daily: Candle[] = Array.from({ length: 14 }, (_, i) => ({ time: (4 + i) * 86_400, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
    const weeks = resample(daily, 604_800, 86_400, 30 * 86_400);
    expect(new Date(weeks[0].time * 1000).getUTCDay()).toBe(1);
    expect(weeks).toHaveLength(2);
  });
});

describe('csv', () => {
  it('reads a Yahoo export with adjusted closes', () => {
    const day = (i: number) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
    const text = ['Date,Open,High,Low,Close,Adj Close,Volume', ...Array.from({ length: 40 }, (_, i) => `${day(i)},10,11,9,10,5,100`)].join('\n');
    const r = parseCsv(text);
    expect(r.candles[0].close).toBeCloseTo(5);
    expect(r.candles[0].high).toBeCloseTo(5.5);
  });

  it('reads day-first dates, semicolons and unix times', () => {
    const rows = Array.from({ length: 35 }, (_, i) => `${String(i + 1).padStart(2, '0')}.01.2024;1;2;0.5;1.5;10`);
    const r = parseCsv(['Date;Open;High;Low;Close;Volume', ...rows.slice(0, 31)].join('\n'));
    expect(new Date(r.candles[12].time * 1000).getUTCDate()).toBe(13);
    const unix = parseCsv(['time,open,high,low,close', ...Array.from({ length: 40 }, (_, i) => `${1700000000 + i * 3600},1,2,0.5,1.5`)].join('\n'));
    expect(unix.granularity).toBe(3600);
  });
});

describe('robustness', () => {
  const c = series(900, 3);
  const ctx = { candles: c, inputs: inputsOf(c), granularity: 86_400 };
  const s = blankStrategy();
  s.longEntry = group('all', [rule(ind('ema', [10]), 'xup', ind('ema', [30]))]);
  s.longExit = group('all', [rule(ind('ema', [10]), 'xdn', ind('ema', [30]))]);
  s.exits.stop = { on: true, unit: 'pct', value: 5 };
  const tun = tunables(s);

  it('finds the tunable numbers once per indicator', () => {
    expect(tun.map((t) => t.label)).toEqual(['EMA 10 length (long entry)', 'EMA 30 length (long entry)', 'Stop loss (%)']);
    expect(tun[0].paths).toHaveLength(2);
  });

  it('maps a grid with a held-back test', () => {
    const axes = [
      { tunable: tun[0], values: axisValues(5, 20, 4, 1) },
      { tunable: tun[1], values: axisValues(25, 60, 4, 1) },
    ];
    const g = grid(ctx, s, axes, 50, 899, 'returnOverDD', 30);
    expect(g.cells).toHaveLength(16);
    expect(g.best.holdout).toBeDefined();
    expect(g.stability).toBeGreaterThanOrEqual(0);
  });

  it('walks forward through unseen windows', () => {
    const axes = [{ tunable: tun[0], values: [5, 10, 15] }];
    const wf = walkForward(ctx, s, axes, 50, 899, 4, 0.7, false, 'returnOverDD');
    expect(wf.windows).toHaveLength(4);
    expect(wf.windows[0].oosStart).toBeGreaterThan(wf.windows[0].isEnd);
    expect(wf.equity.length).toBeGreaterThan(100);
  });

  it('runs a repeatable Monte Carlo', () => {
    const rets = [0.05, -0.02, 0.03, -0.04, 0.06, -0.01, 0.02];
    const a = monteCarlo(rets, 500, 'bootstrap', 1);
    const b = monteCarlo(rets, 500, 'bootstrap', 1);
    expect(a.finals).toEqual(b.finals);
    const sh = monteCarlo(rets, 200, 'shuffle', 2);
    // shuffling never changes the final result, only the path
    expect(sh.finals[0]).toBeCloseTo(sh.finals[sh.finals.length - 1]);
    expect(num(1).v).toBe(1);
  });
});
