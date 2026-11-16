import { describe, expect, it } from 'vitest';

import { describe as describeStrategy, parseEnglish, parseOperand } from './english';
import { toPine } from './pine';
import { ENGLISH_EXAMPLES, PRESETS } from './presets';
import type { Rule } from './rules';

const first = (r: ReturnType<typeof parseEnglish>, k: 'longEntry' | 'longExit' | 'shortEntry' | 'shortExit' | 'filter' = 'longEntry') => r.strategy[k].items[0] as Rule;

describe('operands', () => {
  it.each([
    ['rsi', 'rsi', [14]],
    ['rsi 2', 'rsi', [2]],
    ['rsi(7)', 'rsi', [7]],
    ['200 ema', 'ema', [200]],
    ['the 200-day moving average', 'sma', [200]],
    ['ema 9', 'ema', [9]],
    ['macd(8, 21, 5)', 'macd', [8, 21, 5]],
    ['20 day high', 'donchian', [20]],
    ['upper band', 'bb', [20, 2]],
    ['adx', 'adx', [14]],
  ])('reads %s', (text, id, p) => {
    const o = parseOperand(text);
    expect(o?.kind).toBe('ind');
    if (o?.kind === 'ind') {
      expect(o.id).toBe(id);
      expect(o.p).toEqual(p);
    }
  });

  it('reads numbers and "bars ago"', () => {
    expect(parseOperand('30')).toEqual({ kind: 'num', v: 30 });
    const o = parseOperand('close 2 bars ago');
    expect(o?.kind === 'ind' && o.ago).toBe(2);
    const y = parseOperand("yesterday's high");
    expect(y?.kind === 'ind' && y.src === 'high' && y.ago === 1).toBe(true);
  });
});

describe('sentences', () => {
  it('reads entries, exits and risk', () => {
    const r = parseEnglish('Buy when RSI is under 30 and close is above the 200 EMA. Sell when RSI crosses above 60. Stop loss 2 ATR, take profit 8%, exit after 15 bars.');
    expect(r.unknown).toEqual([]);
    expect(r.strategy.longEntry.items).toHaveLength(2);
    expect(first(r).cmp).toBe('lt');
    expect(first(r, 'longExit').cmp).toBe('xup');
    expect(r.strategy.exits.stop).toMatchObject({ on: true, unit: 'atr', value: 2 });
    expect(r.strategy.exits.targets.levels[0]).toMatchObject({ unit: 'pct', value: 8, size: 100 });
    expect(r.strategy.exits.time).toEqual({ on: true, bars: 15 });
  });

  it('reads shorts, OR groups and ladders', () => {
    const r = parseEnglish('Go long when the 20 EMA crosses above the 50 EMA or RSI is oversold. Short when the 20 EMA crosses below the 50 EMA. Take half at 2R and the rest at 5R, stop 1.5 ATR, risk 1% per trade.');
    expect(r.unknown).toEqual([]);
    expect(r.strategy.side).toBe('both');
    expect(r.strategy.longEntry.mode).toBe('any');
    expect(r.strategy.exits.targets.levels).toEqual([
      { unit: 'r', value: 2, size: 50 },
      { unit: 'r', value: 5, size: 50 },
    ]);
    expect(r.strategy.sizing).toMatchObject({ mode: 'risk', value: 1 });
  });

  it('reads named setups', () => {
    const r = parseEnglish('buy on a golden cross, sell on a death cross');
    expect(first(r).cmp).toBe('xup');
    expect(first(r, 'longExit').cmp).toBe('xdn');
    const b = parseEnglish('buy when price breaks above the 55 day high and relative volume is above 1.5');
    expect(b.unknown).toEqual([]);
    expect(first(b).b).toMatchObject({ id: 'donchian', p: [55] });
  });

  it('reports what it could not read', () => {
    const r = parseEnglish('buy when the moon is full and rsi below 30');
    expect(r.unknown.join(' ')).toContain('moon');
    expect(r.strategy.longEntry.items).toHaveLength(1);
  });

  it.each(ENGLISH_EXAMPLES)('reads the example: %s', (text) => {
    const r = parseEnglish(text);
    expect(r.unknown).toEqual([]);
    expect(r.strategy.longEntry.items.length).toBeGreaterThan(0);
  });
});

describe('round trips', () => {
  it.each(PRESETS.map((p) => [p.name, p] as const))('%s: words → rules → same rules', (_name, p) => {
    const text = describeStrategy(p.strategy);
    const back = parseEnglish(text);
    expect(back.unknown).toEqual([]);
    for (const k of ['longEntry', 'longExit', 'shortEntry', 'shortExit'] as const) {
      if (p.strategy.side === 'long' && k.startsWith('short')) continue;
      if (p.strategy.side === 'short' && k.startsWith('long')) continue;
      expect(back.strategy[k].items.length).toBe(p.strategy[k].items.length);
    }
    expect(back.strategy.exits.stop.on).toBe(p.strategy.exits.stop.on);
    expect(back.strategy.exits.targets.on).toBe(p.strategy.exits.targets.on);
  });

  it.each(PRESETS.map((p) => [p.name, p] as const))('%s exports to Pine', (_name, p) => {
    const pine = toPine(p.strategy);
    expect(pine).toContain('//@version=6');
    expect(pine).toContain('strategy(');
    expect(pine).not.toMatch(/undefined|NaN/);
  });
});
