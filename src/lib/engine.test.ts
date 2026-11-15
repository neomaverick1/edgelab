import { describe, expect, it } from 'vitest';

import { buyAndHold, runBacktest } from './engine';
import { strategyById, type Signals } from './strategies';
import type { Candle, Settings } from './types';

const DAY = 86_400;
const bars = (rows: [number, number, number, number][]): Candle[] =>
  rows.map(([open, high, low, close], i) => ({ time: i * DAY, open, high, low, close, volume: 1 }));

function signals(n: number, at: Partial<Record<'long' | 'exitLong' | 'short' | 'exitShort', number[]>>): Signals {
  const mark = (idx: number[] = []) => Array.from({ length: n }, (_, i) => idx.includes(i));
  return { long: mark(at.long), exitLong: mark(at.exitLong), short: mark(at.short), exitShort: mark(at.exitShort), overlays: [] };
}

const free: Settings = {
  capital: 1000,
  sizePct: 100,
  feePct: 0,
  slippagePct: 0,
  stopPct: 0,
  takeProfitPct: 0,
  trailPct: 0,
  direction: 'long',
  trendFilter: 0,
};

describe('backtest engine', () => {
  const c = bars([
    [100, 101, 99, 100],
    [100, 105, 99, 104], // buy signal at this close
    [105, 110, 104, 108], // filled at this open: 105
    [108, 112, 107, 110], // sell signal at this close
    [111, 113, 109, 112], // filled at this open: 111
  ]);

  it('fills signals at the next open, never at the signal bar', () => {
    const bt = runBacktest(c, signals(5, { long: [1], exitLong: [3] }), free, 0, 4);
    expect(bt.trades).toHaveLength(1);
    const t = bt.trades[0];
    expect([t.entryIndex, t.entryPrice, t.exitIndex, t.exitPrice, t.reason, t.bars]).toEqual([2, 105, 4, 111, 'signal', 2]);
    expect(t.pnl).toBeCloseTo((6 * 1000) / 105, 9);
    expect(bt.equity[2]).toBeCloseTo((1000 / 105) * 108, 9);
    expect(bt.equity[4]).toBeCloseTo(1000 + t.pnl, 9);
    expect(bt.position).toEqual([0, 0, 1, 1, 0]);
  });

  it('charges fees and slippage on both sides, and trade P&L matches the account', () => {
    const s = { ...free, feePct: 0.1, slippagePct: 0.1 };
    const bt = runBacktest(c, signals(5, { long: [1], exitLong: [3] }), s, 0, 4);
    const t = bt.trades[0];
    expect(t.entryPrice).toBeCloseTo(105 * 1.001, 9);
    expect(t.exitPrice).toBeCloseTo(111 * 0.999, 9);
    expect(bt.equity[4] - 1000).toBeCloseTo(t.pnl, 9);
    expect(bt.fees).toBeCloseTo(t.fees, 9);
    expect(bt.slippage).toBeCloseTo(t.qty * (105 * 0.001 + 111 * 0.001), 9);
    expect(t.pnl).toBeLessThan((6 * 1000) / 105);
  });

  const stopBars = (second: [number, number, number, number]) =>
    bars([
      [100, 100, 100, 100], // buy signal
      [100, 101, 96, 97], // filled at 100; stop at 95 not touched
      second,
    ]);

  it('stops out inside the bar at the stop price', () => {
    const bt = runBacktest(stopBars([97, 98, 94, 95]), signals(3, { long: [0] }), { ...free, stopPct: 5 }, 0, 2);
    expect(bt.trades[0]).toMatchObject({ exitIndex: 2, exitPrice: 95, reason: 'stop', bars: 2 });
  });

  it('fills at the open when price gaps through the stop', () => {
    const bt = runBacktest(stopBars([90, 92, 88, 91]), signals(3, { long: [0] }), { ...free, stopPct: 5 }, 0, 2);
    expect(bt.trades[0]).toMatchObject({ exitPrice: 90, reason: 'stop' });
  });

  it('takes profit at the target without slippage (a limit order)', () => {
    const s = { ...free, takeProfitPct: 10, slippagePct: 0.1 };
    const bt = runBacktest(stopBars([102, 112, 101, 111]), signals(3, { long: [0] }), s, 0, 2);
    expect(bt.trades[0].reason).toBe('take-profit');
    expect(bt.trades[0].exitPrice).toBeCloseTo(100 * 1.001 * 1.1, 9);
  });

  it('assumes the stop came first when a bar touches both levels', () => {
    const s = { ...free, stopPct: 5, takeProfitPct: 10 };
    const bt = runBacktest(stopBars([100, 115, 90, 100]), signals(3, { long: [0] }), s, 0, 2);
    expect(bt.trades[0]).toMatchObject({ exitPrice: 95, reason: 'stop' });
  });

  it('trails the stop below the highest high since entry', () => {
    const c2 = bars([
      [100, 100, 100, 100],
      [100, 120, 99, 118], // high 120 lifts the stop to 108
      [115, 116, 107, 109],
    ]);
    const bt = runBacktest(c2, signals(3, { long: [0] }), { ...free, trailPct: 10 }, 0, 2);
    expect(bt.trades[0]).toMatchObject({ exitPrice: 108, reason: 'trailing-stop' });
  });

  const falling = bars([
    [100, 100, 100, 100], // short signal
    [100, 101, 90, 92], // short at 100
    [92, 93, 84, 85], // cover signal
    [80, 82, 78, 79], // covered at 80
  ]);

  it('trades shorts in long & short mode', () => {
    const s: Settings = { ...free, direction: 'both' };
    const bt = runBacktest(falling, signals(4, { short: [0], exitShort: [2] }), s, 0, 3);
    expect(bt.trades[0]).toMatchObject({ side: 'short', entryPrice: 100, exitPrice: 80 });
    expect(bt.trades[0].pnl).toBeCloseTo(200, 9);
    expect(bt.equity[2]).toBeCloseTo(2000 - 10 * 85, 9);
    expect(bt.position).toEqual([0, -1, -1, 0]);
  });

  it('liquidates a short before the account goes below zero', () => {
    const rising = bars([
      [100, 100, 100, 100], // short signal
      [100, 150, 99, 140], // short at 100
      [140, 260, 139, 250], // the account would be gone at 200
      [250, 255, 245, 250],
    ]);
    const s: Settings = { ...free, direction: 'both' };
    const bt = runBacktest(rising, signals(4, { short: [0], long: [2] }), s, 0, 3);
    expect(bt.trades).toHaveLength(1);
    expect(bt.trades[0]).toMatchObject({ side: 'short', exitPrice: 200, reason: 'liquidated' });
    expect(bt.equity.slice(2)).toEqual([0, 0]);
  });

  it('ignores short signals in long-only mode', () => {
    const bt = runBacktest(falling, signals(4, { short: [0], exitShort: [2] }), free, 0, 3);
    expect(bt.trades).toHaveLength(0);
    expect(bt.equity.every((v) => v === 1000)).toBe(true);
  });

  it('reverses from long to short on an opposite signal', () => {
    const s: Settings = { ...free, direction: 'both' };
    const bt = runBacktest(c, signals(5, { long: [0], short: [2], exitLong: [2] }), s, 0, 4);
    expect(bt.trades.map((t) => [t.side, t.entryIndex, t.exitIndex, t.reason])).toEqual([
      ['long', 1, 3, 'signal'],
      ['short', 3, 4, 'end'],
    ]);
  });

  it('skips entries against the trend filter', () => {
    const down = bars([
      [10, 10, 10, 10],
      [9, 9, 9, 9],
      [8, 8, 8, 8], // close 8 is below the 3-bar SMA (9)
      [8, 8, 8, 8],
    ]);
    const bt = runBacktest(down, signals(4, { long: [2] }), { ...free, trendFilter: 3 }, 0, 3);
    expect(bt.trades).toHaveLength(0);
  });

  it('closes a position that is still open on the last bar', () => {
    const bt = runBacktest(c, signals(5, { long: [1] }), free, 0, 4);
    expect(bt.trades[0]).toMatchObject({ exitIndex: 4, exitPrice: 112, reason: 'end' });
  });

  it('never looks ahead: changing later bars does not change earlier results', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
    const rows: [number, number, number, number][] = [];
    let p = 100;
    for (let i = 0; i < 300; i++) {
      const o = p;
      p = Math.max(1, p * (1 + rand() * 0.06));
      rows.push([o, Math.max(o, p) * 1.01, Math.min(o, p) * 0.99, p]);
    }
    const a = bars(rows);
    const b = a.map((x, i) => (i >= 250 ? { ...x, open: x.open * 2, high: x.high * 2, low: x.low * 2, close: x.close * 2 } : x));
    const strategy = strategyById('sma-cross');
    const s = { ...free, feePct: 0.1, stopPct: 8 };
    const ra = runBacktest(a, strategy.signals(a, { fast: 5, slow: 20 }), s, 0, 299);
    const rb = runBacktest(b, strategy.signals(b, { fast: 5, slow: 20 }), s, 0, 299);
    expect(ra.trades.length).toBeGreaterThan(3);
    expect(rb.equity.slice(0, 250)).toEqual(ra.equity.slice(0, 250));
  });

  it('buy & hold buys at the first open and sells at the last close', () => {
    expect(buyAndHold(c, free, 0, 4).at(-1)).toBeCloseTo((1000 * 112) / 100, 9);
  });
});
