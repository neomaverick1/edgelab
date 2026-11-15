import { describe, expect, it } from 'vitest';

import { bollinger, crossesAbove, crossesBelow, donchian, ema, macd, rsi, sma } from './indicators';

const round = (xs: number[], d = 6) => xs.map((x) => (Number.isNaN(x) ? NaN : Number(x.toFixed(d))));

describe('indicators', () => {
  it('SMA averages the last n values', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([NaN, NaN, 2, 3, 4]);
  });

  it('EMA is seeded with the SMA and then smooths', () => {
    // k = 2 / (3 + 1) = 0.5
    expect(ema([1, 2, 3, 4, 5, 6], 3)).toEqual([NaN, NaN, 2, 3, 4, 5]);
    // leading NaNs (like a MACD line before it starts) are skipped
    expect(ema([NaN, NaN, 2, 4, 6, 8], 2)).toEqual([NaN, NaN, NaN, 3, 5, 7]);
  });

  it("RSI uses Wilder's smoothing", () => {
    expect(round(rsi([1, 2, 1, 2, 1], 2))).toEqual([NaN, NaN, 50, 75, 37.5]);
    expect(rsi([1, 2, 3, 4, 5], 2).slice(2)).toEqual([100, 100, 100]);
    expect(rsi([3, 3, 3, 3], 2).slice(2)).toEqual([50, 50]);
  });

  it('Bollinger Bands collapse onto the average when prices do not move', () => {
    const b = bollinger([5, 5, 5, 5], 2, 2);
    expect(b.upper.slice(1)).toEqual([5, 5, 5]);
    expect(b.lower.slice(1)).toEqual([5, 5, 5]);
    // population standard deviation of [1, 3] is 1
    const w = bollinger([1, 3], 2, 2);
    expect(w.mid[1]).toBe(2);
    expect(w.upper[1]).toBe(4);
    expect(w.lower[1]).toBe(0);
  });

  it('Donchian channels look only at earlier bars', () => {
    const d = donchian([1, 3, 2, 5, 4], [0, 2, 1, 4, 3], 2);
    expect(d.upper).toEqual([NaN, NaN, 3, 3, 5]);
    expect(d.lower).toEqual([NaN, NaN, 0, 1, 1]);
  });

  it('MACD histogram is the line minus its signal', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 10 + i * 0.3);
    const m = macd(closes, 12, 26, 9);
    expect(Number.isNaN(m.line[24])).toBe(true);
    expect(Number.isNaN(m.line[25])).toBe(false);
    expect(Number.isNaN(m.signal[32])).toBe(true);
    expect(Number.isNaN(m.signal[33])).toBe(false);
    for (let i = 33; i < 80; i++) expect(m.hist[i]).toBeCloseTo(m.line[i] - m.signal[i], 10);
  });

  it('crosses fire only on the bar where the order flips', () => {
    expect(crossesAbove([1, 2, 3, 3], [2, 2, 2, 2])).toEqual([false, false, true, false]);
    expect(crossesBelow([3, 2, 1, 1], 2)).toEqual([false, false, true, false]);
    expect(crossesAbove([NaN, 1, 3], [2, 2, 2])).toEqual([false, false, true]);
  });
});
