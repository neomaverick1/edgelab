import { describe, expect, it } from 'vitest';

import { inputsOf } from './catalog';
import { runBacktest } from './engine';
import { computeStats } from './metrics';
import { blankStrategy, evaluate, group, ind, num, rule, type Signals, type Strategy } from './rules';
import type { Candle } from './types';

const DAY = 86_400;
const bars = (rows: [number, number, number, number][]): Candle[] => rows.map(([o, h, l, c], i) => ({ time: i * DAY, open: o, high: h, low: l, close: c, volume: 1000 }));
const flat = (n: number, p = 100): [number, number, number, number][] => Array.from({ length: n }, () => [p, p, p, p]);

/** Signals from explicit bar indices instead of indicators. */
function signals(n: number, s: Partial<Record<'longEntry' | 'longExit' | 'shortEntry' | 'shortExit', number[]>>, atrValue = 2): Signals {
  const arr = (idx: number[] = []) => {
    const a = new Uint8Array(n);
    idx.forEach((i) => (a[i] = 1));
    return a;
  };
  return {
    longEntry: arr(s.longEntry),
    longExit: arr(s.longExit),
    shortEntry: arr(s.shortEntry),
    shortExit: arr(s.shortExit),
    filter: new Uint8Array(n).fill(1),
    atr: new Array(n).fill(atrValue),
    plots: [],
    warmup: 0,
  };
}

function strat(edit: (s: Strategy) => void = () => {}): Strategy {
  const s = blankStrategy();
  s.costs = { capital: 10_000, feePct: 0, slippagePct: 0 };
  edit(s);
  return s;
}

describe('engine basics', () => {
  it('fills a signal at the next open and closes on the exit signal', () => {
    const c = bars([...flat(2), [100, 101, 99, 100], [110, 111, 109, 110], [120, 121, 119, 120], [130, 131, 129, 130]]);
    const bt = runBacktest(c, signals(c.length, { longEntry: [1], longExit: [3] }), strat(), { start: 0, end: c.length - 1 });
    expect(bt.trades).toHaveLength(1);
    const t = bt.trades[0];
    expect(t.entryIndex).toBe(2);
    expect(t.entryPrice).toBe(100);
    expect(t.exitIndex).toBe(4);
    expect(t.exitPrice).toBe(120);
    expect(t.pnl).toBeCloseTo(2000);
    expect(t.reason).toBe('signal');
    expect(bt.equity[bt.equity.length - 1]).toBeCloseTo(12_000);
  });

  it('charges fees and slippage on both sides', () => {
    const c = bars([...flat(2), [100, 100, 100, 100], [100, 100, 100, 100], [100, 100, 100, 100]]);
    const s = strat((x) => (x.costs = { capital: 10_000, feePct: 0.1, slippagePct: 0.1 }));
    const bt = runBacktest(c, signals(c.length, { longEntry: [1], longExit: [2] }), s, { start: 0, end: c.length - 1 });
    expect(bt.trades[0].pnl).toBeLessThan(0);
    expect(bt.fees).toBeGreaterThan(19);
    expect(bt.slippage).toBeGreaterThan(19);
  });
});

describe('stops and targets', () => {
  it('exits at the stop price inside the bar', () => {
    const c = bars([...flat(2), [100, 101, 99, 100], [100, 100, 90, 92], [92, 93, 91, 92]]);
    const s = strat((x) => (x.exits.stop = { on: true, unit: 'pct', value: 5 }));
    const bt = runBacktest(c, signals(c.length, { longEntry: [1] }), s, { start: 0, end: c.length - 1 });
    expect(bt.trades[0].reason).toBe('stop');
    expect(bt.trades[0].exitPrice).toBeCloseTo(95);
    expect(bt.trades[0].pnl).toBeCloseTo(-500);
    expect(bt.trades[0].r).toBeCloseTo(-1);
  });

  it('fills at the open when the market gaps through the stop', () => {
    const c = bars([...flat(2), [100, 101, 99, 100], [80, 82, 79, 81], [81, 81, 81, 81]]);
    const s = strat((x) => (x.exits.stop = { on: true, unit: 'pct', value: 5 }));
    const bt = runBacktest(c, signals(c.length, { longEntry: [1] }), s, { start: 0, end: c.length - 1 });
    expect(bt.trades[0].exitPrice).toBe(80);
  });

  it('uses ATR stops measured at entry', () => {
    const c = bars([...flat(2), [100, 101, 99, 100], [100, 100, 95, 96], [96, 96, 96, 96]]);
    const s = strat((x) => (x.exits.stop = { on: true, unit: 'atr', value: 2 }));
    const bt = runBacktest(c, signals(c.length, { longEntry: [1] }, 2), s, { start: 0, end: c.length - 1 });
    expect(bt.trades[0].exitPrice).toBeCloseTo(96);
  });

  it('scales out at each take-profit level', () => {
    const c = bars([...flat(2), [100, 101, 99, 100], [100, 106, 99, 105], [105, 111, 104, 110], [110, 110, 110, 110]]);
    const s = strat((x) => {
      x.exits.targets = {
        on: true,
        levels: [
          { unit: 'pct', value: 5, size: 50 },
          { unit: 'pct', value: 10, size: 50 },
        ],
      };
    });
    const bt = runBacktest(c, signals(c.length, { longEntry: [1] }), s, { start: 0, end: c.length - 1 });
    const t = bt.trades[0];
    expect(t.fills).toHaveLength(2);
    expect(t.fills[0].price).toBeCloseTo(105);
    expect(t.fills[0].qty).toBeCloseTo(50);
    expect(t.fills[1].price).toBeCloseTo(110);
    expect(t.pnl).toBeCloseTo(50 * 5 + 50 * 10);
    expect(t.reason).toBe('take-profit');
  });

  it('assumes the stop came first when a bar touches both', () => {
    const c = bars([...flat(2), [100, 101, 99, 100], [100, 111, 89, 100], [100, 100, 100, 100]]);
    const s = strat((x) => {
      x.exits.stop = { on: true, unit: 'pct', value: 10 };
      x.exits.targets = { on: true, levels: [{ unit: 'pct', value: 10, size: 100 }] };
    });
    const bt = runBacktest(c, signals(c.length, { longEntry: [1] }), s, { start: 0, end: c.length - 1 });
    expect(bt.trades[0].reason).toBe('stop');
  });

  it('trails the highest high since entry', () => {
    const c = bars([...flat(2), [100, 100, 100, 100], [100, 120, 100, 119], [119, 119, 107, 108], [108, 108, 108, 108]]);
    const s = strat((x) => (x.exits.trail = { on: true, unit: 'pct', value: 10, activate: 0 }));
    const bt = runBacktest(c, signals(c.length, { longEntry: [1] }), s, { start: 0, end: c.length - 1 });
    expect(bt.trades[0].reason).toBe('trailing-stop');
    expect(bt.trades[0].exitPrice).toBeCloseTo(108);
  });

  it('moves the stop to breakeven after the trigger', () => {
    const c = bars([...flat(2), [100, 100, 100, 100], [100, 106, 100, 104], [104, 104, 99, 99], [99, 99, 99, 99]]);
    const s = strat((x) => {
      x.exits.stop = { on: true, unit: 'pct', value: 10 };
      x.exits.breakeven = { on: true, unit: 'pct', value: 5 };
    });
    const bt = runBacktest(c, signals(c.length, { longEntry: [1] }), s, { start: 0, end: c.length - 1 });
    expect(bt.trades[0].reason).toBe('breakeven');
    expect(bt.trades[0].exitPrice).toBeCloseTo(100);
  });

  it('closes after the time limit', () => {
    const c = bars(flat(10));
    const s = strat((x) => (x.exits.time = { on: true, bars: 3 }));
    const bt = runBacktest(c, signals(c.length, { longEntry: [1] }), s, { start: 0, end: c.length - 1 });
    expect(bt.trades[0].reason).toBe('time');
    expect(bt.trades[0].entryIndex).toBe(2);
    expect(bt.trades[0].exitIndex).toBe(5);
  });
});

describe('direction, sizing and leverage', () => {
  it('shorts and reverses on the opposite signal', () => {
    const c = bars([...flat(2), [100, 100, 100, 100], [90, 90, 90, 90], [80, 80, 80, 80], [90, 90, 90, 90], [100, 100, 100, 100]]);
    const s = strat((x) => (x.side = 'both'));
    const bt = runBacktest(c, signals(c.length, { shortEntry: [1], longEntry: [3] }), s, { start: 0, end: c.length - 1 });
    expect(bt.trades[0].side).toBe('short');
    expect(bt.trades[0].reason).toBe('reverse');
    expect(bt.trades[0].pnl).toBeCloseTo(10_000 * 0.2);
    expect(bt.trades[1].side).toBe('long');
  });

  it('sizes by risk when a stop is set', () => {
    const c = bars([...flat(2), [100, 100, 100, 100], [100, 100, 100, 100]]);
    const s = strat((x) => {
      x.sizing = { ...x.sizing, mode: 'risk', value: 1, leverage: 10 };
      x.exits.stop = { on: true, unit: 'pct', value: 2 };
    });
    const bt = runBacktest(c, signals(c.length, { longEntry: [1] }), s, { start: 0, end: c.length - 1 });
    // risk $100 with a $2 stop distance → 50 units → $5,000 notional
    expect(bt.trades[0].qty).toBeCloseTo(50);
  });

  it('caps size at the leverage limit', () => {
    const c = bars([...flat(2), [100, 100, 100, 100], [100, 100, 100, 100]]);
    const s = strat((x) => (x.sizing = { ...x.sizing, mode: 'equity', value: 500, leverage: 2 }));
    const bt = runBacktest(c, signals(c.length, { longEntry: [1] }), s, { start: 0, end: c.length - 1 });
    expect(bt.trades[0].qty).toBeCloseTo(200);
  });

  it('liquidates a leveraged long that loses the whole account', () => {
    const c = bars([...flat(2), [100, 100, 100, 100], [100, 100, 40, 45], [45, 45, 45, 45]]);
    const s = strat((x) => (x.sizing = { ...x.sizing, mode: 'equity', value: 300, leverage: 3 }));
    const bt = runBacktest(c, signals(c.length, { longEntry: [1] }), s, { start: 0, end: c.length - 1 });
    expect(bt.trades[0].reason).toBe('liquidated');
    expect(bt.equity[bt.equity.length - 1]).toBeCloseTo(0, 6);
  });

  it('scales into a winner', () => {
    const c = bars([...flat(2), [100, 100, 100, 100], [105, 105, 105, 105], [110, 110, 110, 110], [120, 120, 120, 120]]);
    const s = strat((x) => {
      x.sizing = { ...x.sizing, mode: 'equity', value: 50, leverage: 2, scaleIn: { on: true, max: 1, size: 100, onlyInProfit: true } };
    });
    const bt = runBacktest(c, signals(c.length, { longEntry: [1, 3] }), s, { start: 0, end: c.length - 1 });
    expect(bt.trades[0].adds).toBe(1);
    expect(bt.trades[0].entryPrice).toBeGreaterThan(100);
  });

  it('keeps a live position open when asked', () => {
    const c = bars(flat(6));
    const bt = runBacktest(c, signals(c.length, { longEntry: [1] }), strat(), { start: 0, end: c.length - 1, keepOpen: true });
    expect(bt.trades).toHaveLength(0);
    expect(bt.open?.side).toBe('long');
  });
});

describe('rules and stats end to end', () => {
  it('evaluates crosses, groups and the filter', () => {
    const closes = [10, 10, 10, 10, 10, 12, 14, 16, 12, 8, 6, 6, 6, 9, 12, 15];
    const c = bars(closes.map((x) => [x, x, x, x]));
    const s = strat((x) => {
      x.longEntry = group('all', [rule(ind('price'), 'xup', ind('sma', [3]))]);
      x.longExit = group('any', [rule(ind('price'), 'xdn', ind('sma', [3])), rule(ind('price'), 'lt', num(5))]);
    });
    const sig = evaluate(s, inputsOf(c));
    expect([...sig.longEntry].map((v, i) => (v ? i : -1)).filter((i) => i >= 0)).toEqual([5, 13]);
    const bt = runBacktest(c, sig, s, { start: sig.warmup, end: c.length - 1 });
    const st = computeStats(bt, c, DAY, 10_000);
    expect(st.trades).toBe(2);
    expect(Number.isFinite(st.sharpe)).toBe(true);
  });

  it('holds a condition for N bars with "within"', () => {
    const closes = [1, 1, 1, 2, 2, 2, 2, 2];
    const c = bars(closes.map((x) => [x, x, x, x]));
    const s = strat((x) => (x.longEntry = group('all', [rule(ind('price'), 'xup', num(1.5), { within: 3 })])));
    const sig = evaluate(s, inputsOf(c));
    expect([...sig.longEntry]).toEqual([0, 0, 0, 1, 1, 1, 0, 0]);
  });
});
