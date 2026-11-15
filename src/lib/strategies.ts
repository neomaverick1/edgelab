import { bollinger, crossesAbove, crossesBelow, donchian, ema, macd, rsi, sma } from './indicators';
import type { Candle, Params } from './types';

export interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
}

export interface Line {
  name: string;
  color: string;
  values: number[];
  dashed?: boolean;
}

/** What a strategy wants to do at each bar's close. The backtester fills those orders at the next bar's open. */
export interface Signals {
  long: boolean[];
  exitLong: boolean[];
  short: boolean[];
  exitShort: boolean[];
  overlays: Line[]; // drawn over the price
  oscillator?: { name: string; lines: Line[]; levels?: number[]; histogram?: number[] }; // drawn in a panel below
}

export interface Strategy {
  id: string;
  name: string;
  summary: string;
  rules: string[];
  params: ParamDef[];
  check?: (p: Params) => string | null;
  signals: (candles: readonly Candle[], p: Params) => Signals;
}

export const COLORS = { fast: '#F5B84B', slow: '#5AA9FF', band: '#B392F0', mid: '#8B98A5', exit: '#E879A6' };

const closes = (c: readonly Candle[]) => c.map((x) => x.close);

function crossover(name: string, average: typeof sma): Strategy['signals'] {
  return (c, p) => {
    const close = closes(c);
    const fast = average(close, p.fast);
    const slow = average(close, p.slow);
    const up = crossesAbove(fast, slow);
    const down = crossesBelow(fast, slow);
    return {
      long: up,
      exitLong: down,
      short: down,
      exitShort: up,
      overlays: [
        { name: `${name} ${p.fast}`, color: COLORS.fast, values: fast },
        { name: `${name} ${p.slow}`, color: COLORS.slow, values: slow },
      ],
    };
  };
}

const fastBelowSlow = (p: Params) => (p.fast >= p.slow ? 'The fast average should be shorter than the slow one.' : null);

export const STRATEGIES: Strategy[] = [
  {
    id: 'sma-cross',
    name: 'SMA crossover',
    summary: 'Trend following with two simple moving averages.',
    rules: ['Buy when the fast SMA crosses above the slow SMA.', 'Sell when it crosses back below.'],
    params: [
      { key: 'fast', label: 'Fast SMA', min: 5, max: 100, step: 5, value: 20 },
      { key: 'slow', label: 'Slow SMA', min: 20, max: 300, step: 10, value: 100 },
    ],
    check: fastBelowSlow,
    signals: crossover('SMA', sma),
  },
  {
    id: 'ema-cross',
    name: 'EMA crossover',
    summary: 'Faster-reacting trend following with exponential averages.',
    rules: ['Buy when the fast EMA crosses above the slow EMA.', 'Sell when it crosses back below.'],
    params: [
      { key: 'fast', label: 'Fast EMA', min: 5, max: 60, step: 5, value: 20 },
      { key: 'slow', label: 'Slow EMA', min: 20, max: 200, step: 10, value: 50 },
    ],
    check: fastBelowSlow,
    signals: crossover('EMA', ema),
  },
  {
    id: 'rsi',
    name: 'RSI reversion',
    summary: 'Buys oversold dips and sells into strength.',
    rules: ['Buy when RSI climbs back above the oversold level.', 'Sell when RSI rises above the overbought level.'],
    params: [
      { key: 'period', label: 'RSI length', min: 2, max: 30, step: 1, value: 14 },
      { key: 'oversold', label: 'Oversold', min: 10, max: 45, step: 5, value: 30 },
      { key: 'overbought', label: 'Overbought', min: 55, max: 90, step: 5, value: 70 },
    ],
    check: (p) => (p.oversold >= p.overbought ? 'Oversold should be below overbought.' : null),
    signals: (c, p) => {
      const r = rsi(closes(c), p.period);
      return {
        long: crossesAbove(r, p.oversold),
        exitLong: crossesAbove(r, p.overbought),
        short: crossesBelow(r, p.overbought),
        exitShort: crossesBelow(r, p.oversold),
        overlays: [],
        oscillator: {
          name: `RSI ${p.period}`,
          lines: [{ name: 'RSI', color: COLORS.band, values: r }],
          levels: [p.oversold, p.overbought],
        },
      };
    },
  },
  {
    id: 'bollinger',
    name: 'Bollinger reversion',
    summary: 'Fades moves outside the bands back to the average.',
    rules: ['Buy when price closes back inside the lower band.', 'Sell when price reaches the middle band.'],
    params: [
      { key: 'period', label: 'Length', min: 10, max: 60, step: 5, value: 20 },
      { key: 'width', label: 'Band width (σ)', min: 1, max: 3.5, step: 0.25, value: 2 },
    ],
    signals: (c, p) => {
      const close = closes(c);
      const b = bollinger(close, p.period, p.width);
      return {
        long: crossesAbove(close, b.lower),
        exitLong: crossesAbove(close, b.mid),
        short: crossesBelow(close, b.upper),
        exitShort: crossesBelow(close, b.mid),
        overlays: [
          { name: 'Upper band', color: COLORS.band, values: b.upper },
          { name: `SMA ${p.period}`, color: COLORS.mid, values: b.mid, dashed: true },
          { name: 'Lower band', color: COLORS.band, values: b.lower },
        ],
      };
    },
  },
  {
    id: 'donchian',
    name: 'Donchian breakout',
    summary: 'Turtle-style breakouts to new highs and lows.',
    rules: [
      'Buy when price closes above the highest high of the entry window.',
      'Sell when it closes below the lowest low of the exit window.',
    ],
    params: [
      { key: 'entry', label: 'Entry window', min: 10, max: 100, step: 5, value: 20 },
      { key: 'exit', label: 'Exit window', min: 5, max: 60, step: 5, value: 10 },
    ],
    signals: (c, p) => {
      const close = closes(c);
      const highs = c.map((x) => x.high);
      const lows = c.map((x) => x.low);
      const enter = donchian(highs, lows, p.entry);
      const leave = donchian(highs, lows, p.exit);
      return {
        long: crossesAbove(close, enter.upper),
        exitLong: crossesBelow(close, leave.lower),
        short: crossesBelow(close, enter.lower),
        exitShort: crossesAbove(close, leave.upper),
        overlays: [
          { name: `${p.entry}-bar high`, color: COLORS.slow, values: enter.upper },
          { name: `${p.exit}-bar low`, color: COLORS.exit, values: leave.lower, dashed: true },
        ],
      };
    },
  },
  {
    id: 'macd',
    name: 'MACD crossover',
    summary: 'Momentum shifts from the MACD and its signal line.',
    rules: ['Buy when the MACD line crosses above its signal line.', 'Sell when it crosses back below.'],
    params: [
      { key: 'fast', label: 'Fast EMA', min: 4, max: 30, step: 2, value: 12 },
      { key: 'slow', label: 'Slow EMA', min: 10, max: 60, step: 2, value: 26 },
      { key: 'signal', label: 'Signal', min: 3, max: 20, step: 1, value: 9 },
    ],
    check: fastBelowSlow,
    signals: (c, p) => {
      const m = macd(closes(c), p.fast, p.slow, p.signal);
      const up = crossesAbove(m.line, m.signal);
      const down = crossesBelow(m.line, m.signal);
      return {
        long: up,
        exitLong: down,
        short: down,
        exitShort: up,
        overlays: [],
        oscillator: {
          name: `MACD ${p.fast}/${p.slow}/${p.signal}`,
          lines: [
            { name: 'MACD', color: COLORS.slow, values: m.line },
            { name: 'Signal', color: COLORS.fast, values: m.signal },
          ],
          histogram: m.hist,
        },
      };
    },
  },
];

export const strategyById = (id: string) => STRATEGIES.find((s) => s.id === id) ?? STRATEGIES[0];

export const defaultParams = (s: Strategy): Params => Object.fromEntries(s.params.map((d) => [d.key, d.value]));
