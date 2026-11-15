import { describe, expect, it } from 'vitest';

import { curveStats, drawdowns, monthlyReturns, tradeStats } from './metrics';
import { axisValues, optimize } from './optimizer';
import { strategyById } from './strategies';
import type { Candle, Trade } from './types';

const DAY = 86_400;

describe('metrics', () => {
  it('drawdown is the distance below the running high', () => {
    expect(drawdowns([100, 120, 90, 130], 100)).toEqual([0, 0, -0.25, 0]);
    const dd = drawdowns([90, 95], 100);
    expect(dd[0]).toBeCloseTo(-0.1, 12);
    expect(dd[1]).toBeCloseTo(-0.05, 12);
  });

  it('max drawdown, its length and the total return', () => {
    const times = [0, 1, 2, 3, 4].map((d) => d * DAY);
    const s = curveStats([110, 88, 99, 121, 120], times, DAY, 100);
    expect(s.returnPct).toBeCloseTo(0.2, 12);
    expect(s.maxDrawdown).toBeCloseTo(-0.2, 12);
    expect(s.maxDrawdownDays).toBe(2); // high set at day 1's close, recovered at day 4's close
    expect(s.cagr).toBeNull(); // five days is too short to annualise
  });

  it('CAGR over whole years, and Sharpe from daily returns', () => {
    const days = 730;
    const equity = Array.from({ length: days }, (_, i) => 100 * 1.21 ** ((i + 1) / days));
    const times = equity.map((_, i) => i * DAY);
    const s = curveStats(equity, times, DAY, 100);
    expect(s.cagr).toBeCloseTo(1.21 ** (365.25 / 730) - 1, 6);
    expect(curveStats([100, 100, 100], [0, DAY, 2 * DAY], DAY, 100).sharpe).toBe(0); // no trades, no volatility
    const noisy = curveStats(
      [101, 99, 102, 100, 103],
      [0, 1, 2, 3, 4].map((d) => d * DAY),
      DAY,
      100,
    );
    expect(noisy.sharpe).toBeGreaterThan(0);
    expect(noisy.sortino).toBeGreaterThan(noisy.sharpe);
  });

  it('win rate, profit factor and averages', () => {
    const t = (pnl: number, pnlPct: number) => ({ pnl, pnlPct, bars: 2 }) as Trade;
    const s = tradeStats([t(300, 0.3), t(-100, -0.1), t(100, 0.1), t(-50, -0.05)]);
    expect(s.winRate).toBe(0.5);
    expect(s.profitFactor).toBeCloseTo(400 / 150, 12);
    expect(s.avgWin).toBeCloseTo(0.2, 12);
    expect(s.avgLoss).toBeCloseTo(-0.075, 12);
    expect(s.expectancy).toBe(62.5);
    expect(tradeStats([t(10, 0.01)]).profitFactor).toBe(Infinity);
  });

  it('monthly returns chain month to month', () => {
    const times = [Date.UTC(2024, 0, 15), Date.UTC(2024, 0, 31), Date.UTC(2024, 1, 10), Date.UTC(2024, 1, 29), Date.UTC(2025, 0, 2)].map(
      (t) => t / 1000,
    );
    const rows = monthlyReturns([105, 110, 99, 121, 133.1], times, 100);
    expect(rows.map((r) => r.year)).toEqual([2024, 2025]);
    expect(rows[0].months[0]).toBeCloseTo(0.1, 12);
    expect(rows[0].months[1]).toBeCloseTo(0.1, 12);
    expect(rows[0].months[2]).toBeNull();
    expect(rows[0].total).toBeCloseTo(0.21, 12);
    expect(rows[1].months[0]).toBeCloseTo(0.1, 12);
    expect(rows[1].total).toBeCloseTo(0.1, 12);
  });
});

describe('optimizer', () => {
  it('spreads each axis over the full range', () => {
    const v = axisValues({ key: 'fast', label: '', min: 5, max: 100, step: 5, value: 20 });
    expect(v[0]).toBe(5);
    expect(v.at(-1)).toBe(100);
    expect(v.length).toBeLessThanOrEqual(15);
    expect(axisValues({ key: 'w', label: '', min: 1, max: 3.5, step: 0.25, value: 2 })).toEqual([
      1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5,
    ]);
    // the current value is always on the grid, so it can be compared
    expect(axisValues({ key: 'slow', label: '', min: 20, max: 200, step: 10, value: 50 }, 14, 50)).toContain(50);
  });

  it('tests every pair, marks impossible ones and scores a held-out period', () => {
    const candles: Candle[] = Array.from({ length: 400 }, (_, i) => {
      const p = 100 + Math.sin(i / 9) * 15 + i * 0.05;
      return { time: i * DAY, open: p, high: p * 1.01, low: p * 0.99, close: p * 1.002, volume: 1 };
    });
    const grid = optimize({
      candles,
      strategyId: 'sma-cross',
      params: { fast: 20, slow: 100 },
      xKey: 'fast',
      yKey: 'slow',
      settings: {
        capital: 1000,
        sizePct: 100,
        feePct: 0.1,
        slippagePct: 0,
        stopPct: 0,
        takeProfitPct: 0,
        trailPct: 0,
        direction: 'long',
        trendFilter: 0,
      },
      start: 0,
      end: 399,
      granularity: DAY,
      holdout: 0.3,
    });
    expect(grid.cells).toHaveLength(grid.xs.length * grid.ys.length);
    expect(grid.cells.find((c) => c.x >= c.y)?.valid).toBe(false);
    const ok = grid.cells.filter((c) => c.valid);
    expect(ok.length).toBeGreaterThan(50);
    expect(ok.every((c) => c.test !== null)).toBe(true);
    expect(grid.splitIndex).toBe(279);
    expect(ok.some((c) => c.train.trades > 0)).toBe(true);
    expect(strategyById('sma-cross').check!({ fast: 50, slow: 50 })).not.toBeNull();
  });
});
