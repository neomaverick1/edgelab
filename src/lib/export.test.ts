import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchSince, merge } from './data';
import { pineScript } from './pine';
import { DEFAULT_STATE, decodeState, encodeState } from './share';
import { STRATEGIES, defaultParams, strategyById } from './strategies';
import type { Candle } from './types';

const HOUR = 3600;

describe('Pine Script export', () => {
  const s = DEFAULT_STATE.settings;

  it('writes a v6 strategy with the same rules and costs', () => {
    const strategy = strategyById('sma-cross');
    const code = pineScript(strategy, { fast: 20, slow: 100 }, s, { market: 'BTC-USD', from: '2020-01-01', to: null });
    expect(code.startsWith('//@version=6\nstrategy("Edgelab: SMA crossover"')).toBe(true);
    expect(code).toContain('commission_value = 0.1');
    expect(code).toContain('fastLen = input.int(20, "Fast SMA", minval = 1)');
    expect(code).toContain('longSignal = ta.crossover(fast, slow)');
    expect(code).toContain('strategy.entry("Long", strategy.long)');
    expect(code).not.toContain('strategy.short');
    expect(code).not.toContain('strategy.exit');
  });

  it('adds shorts, the trend filter, an end date and combined stops when they are on', () => {
    const settings = { ...s, direction: 'both' as const, stopPct: 5, trailPct: 8, takeProfitPct: 20, trendFilter: 200 };
    const code = pineScript(strategyById('donchian'), { entry: 20, exit: 10 }, settings, {
      market: 'ETH-USD',
      from: '2021-01-01',
      to: '2024-12-31',
    });
    expect(code).toContain('strategy.entry("Short", strategy.short)');
    expect(code).toContain('shortOk = close < trendSma');
    expect(code).toContain('inWindow = time >= startTime and time <= endTime');
    expect(code).toContain('strategy.close_all()');
    expect(code).toContain('entryHigh = ta.highest(high, entryLen)[1]');
    expect(code).toContain(
      'strategy.exit("Long exit", "Long", stop = math.max(longBase * (1 - stopPct), nz(peak, longBase) * (1 - trailPct)), limit = longBase * (1 + targetPct))',
    );
    expect(code).toContain(
      'strategy.exit("Short exit", "Short", stop = math.min(shortBase * (1 + stopPct), nz(trough, shortBase) * (1 + trailPct))',
    );
  });

  it('every strategy exports, and Pine blocks are indented by four spaces', () => {
    for (const strategy of STRATEGIES) {
      const code = pineScript(
        strategy,
        defaultParams(strategy),
        { ...s, direction: 'both' },
        { market: 'BTC-USD', from: '2020-01-01', to: null },
      );
      expect(code).toContain('longSignal = ta.cross');
      for (const line of code.split('\n')) expect(line.match(/^ */)![0].length % 4).toBe(0);
    }
  });
});

describe('share links', () => {
  it('round-trips the whole setup', () => {
    const state = {
      ...DEFAULT_STATE,
      market: 'SOL-USD',
      tf: '6h' as const,
      from: '2025-08-01',
      to: '2026-01-31',
      strategy: 'rsi',
      params: { period: 7, oversold: 25, overbought: 80 },
      settings: { ...DEFAULT_STATE.settings, stopPct: 4, direction: 'both' as const, trendFilter: 100 },
    };
    expect(decodeState(`#${encodeState(state)}`, ['BTC-USD', 'SOL-USD'])).toEqual(state);
  });

  it('falls back to safe values for anything unknown or out of range', () => {
    const s = decodeState('#m=XYZ&tf=5m&s=nope&p=fast:9999&size=500&dir=sideways&from=yesterday', ['BTC-USD']);
    expect(s.market).toBe('BTC-USD');
    expect(s.tf).toBe('1d');
    expect(s.strategy).toBe(DEFAULT_STATE.strategy);
    expect(s.params.fast).toBe(60); // clamped to the EMA crossover's range
    expect(s.settings.sizePct).toBe(100);
    expect(s.settings.direction).toBe('long');
    expect(s.from).toBe(DEFAULT_STATE.from);
  });
});

describe('market data', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads Coinbase's [time, low, high, open, close, volume] rows and skips the forming candle", async () => {
    const now = 100 * HOUR + 1800; // halfway through the hour that opened at 100h
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [
        [100 * HOUR, 1, 9, 2, 3, 50], // still forming
        [99 * HOUR, 10, 20, 12, 18, 7],
        [98 * HOUR, 11, 21, 13, 19, 8],
      ],
    }));
    vi.stubGlobal('fetch', fetch);
    const rows = await fetchSince('BTC-USD', HOUR, 97 * HOUR, now);
    expect(rows).toEqual([
      { time: 98 * HOUR, open: 13, high: 21, low: 11, close: 19, volume: 8 },
      { time: 99 * HOUR, open: 12, high: 20, low: 10, close: 18, volume: 7 },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    // already up to date: it still checks the latest closed candle
    expect(await fetchSince('BTC-USD', HOUR, 99 * HOUR, now)).toEqual([
      { time: 99 * HOUR, open: 12, high: 20, low: 10, close: 18, volume: 7 },
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('merges fresh candles over the snapshot and keeps 2,000 intraday bars', () => {
    const bar = (t: number, close: number): Candle => ({ time: t, open: close, high: close, low: close, close, volume: 0 });
    const base = Array.from({ length: 2000 }, (_, i) => bar(i * HOUR, 1));
    const merged = merge(base, [bar(1999 * HOUR, 2), bar(2000 * HOUR, 3)], '1h');
    expect(merged).toHaveLength(2000);
    expect(merged[0].time).toBe(HOUR);
    expect(merged.slice(-2).map((c) => c.close)).toEqual([2, 3]);
  });
});
