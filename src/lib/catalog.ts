// Every indicator the rule builder can use: how to compute it, how to show it and how to write it in Pine Script.
import * as ta from './indicators';
import type { Candle } from './types';

export type Source = 'open' | 'high' | 'low' | 'close' | 'hl2' | 'hlc3' | 'ohlc4' | 'volume';
export const SOURCES: { id: Source; label: string }[] = [
  { id: 'close', label: 'Close' },
  { id: 'open', label: 'Open' },
  { id: 'high', label: 'High' },
  { id: 'low', label: 'Low' },
  { id: 'hl2', label: 'HL/2' },
  { id: 'hlc3', label: 'HLC/3' },
  { id: 'ohlc4', label: 'OHLC/4' },
  { id: 'volume', label: 'Volume' },
];

export interface Inputs {
  time: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

export interface ParamSpec {
  label: string;
  def: number;
  min: number;
  max: number;
  step: number;
}

export type Group = 'Price' | 'Trend' | 'Momentum' | 'Volatility' | 'Volume' | 'Time' | 'Pattern';

export interface IndicatorDef {
  id: string;
  name: string;
  short: string; // label used in rule chips, e.g. "EMA"
  group: Group;
  params: ParamSpec[];
  outputs: { key: string; label: string }[]; // the first output is the default
  source?: Source; // indicators that read a price series default to this one
  place: 'overlay' | 'pane' | 'none';
  levels?: number[]; // reference lines for panes (RSI 30/70 ...)
  /** Typical comparison value offered when a rule compares this indicator with a number. */
  hint?: number;
  compute(d: Inputs, p: number[], src: number[]): Record<string, number[]>;
  /** Pine Script: declaration lines and an expression per output. `v` is a unique variable prefix. */
  pine(p: number[], src: string, v: string): { lines?: string[]; out: Record<string, string> };
}

const n = (label: string, def: number, min = 1, max = 400, step = 1): ParamSpec => ({ label, def, min, max, step });
const len = (def: number, max = 400) => n('Length', def, 1, max);
const mult = (label: string, def: number, min = 0.1, max = 10) => n(label, def, min, max, 0.1);
const one = (key = 'value', label = 'Value') => [{ key, label }];

const bool = (xs: boolean[]) => xs.map((b) => (b ? 1 : 0));

export const INDICATORS: IndicatorDef[] = [
  // ---- Price & time
  {
    id: 'price',
    name: 'Price',
    short: 'Price',
    group: 'Price',
    params: [],
    outputs: one(),
    source: 'close',
    place: 'none',
    compute: (_d, _p, src) => ({ value: src }),
    pine: (_p, src) => ({ out: { value: src } }),
  },
  {
    id: 'change',
    name: 'Change % over N bars',
    short: 'Change%',
    group: 'Price',
    params: [n('Bars', 1, 1, 400)],
    outputs: one(),
    source: 'close',
    place: 'pane',
    levels: [0],
    hint: 0,
    compute: (_d, [k], src) => ({ value: ta.roc(src, k) }),
    pine: ([k], src) => ({ out: { value: `ta.roc(${src}, ${k})` } }),
  },
  {
    id: 'hour',
    name: 'Hour of day (UTC)',
    short: 'Hour',
    group: 'Time',
    params: [],
    outputs: one(),
    place: 'none',
    hint: 13,
    compute: (d) => ({ value: d.time.map((t) => new Date(t * 1000).getUTCHours()) }),
    pine: () => ({ out: { value: 'hour(time, "UTC")' } }),
  },
  {
    id: 'weekday',
    name: 'Day of week (0 Sun – 6 Sat)',
    short: 'Weekday',
    group: 'Time',
    params: [],
    outputs: one(),
    place: 'none',
    hint: 1,
    compute: (d) => ({ value: d.time.map((t) => new Date(t * 1000).getUTCDay()) }),
    pine: () => ({ out: { value: '(dayofweek(time, "UTC") - 1)' } }),
  },
  {
    id: 'month',
    name: 'Month (1 – 12)',
    short: 'Month',
    group: 'Time',
    params: [],
    outputs: one(),
    place: 'none',
    hint: 1,
    compute: (d) => ({ value: d.time.map((t) => new Date(t * 1000).getUTCMonth() + 1) }),
    pine: () => ({ out: { value: 'month(time, "UTC")' } }),
  },

  // ---- Trend
  {
    id: 'sma',
    name: 'Simple moving average',
    short: 'SMA',
    group: 'Trend',
    params: [len(50)],
    outputs: one(),
    source: 'close',
    place: 'overlay',
    compute: (_d, [k], src) => ({ value: ta.sma(src, k) }),
    pine: ([k], src) => ({ out: { value: `ta.sma(${src}, ${k})` } }),
  },
  {
    id: 'ema',
    name: 'Exponential moving average',
    short: 'EMA',
    group: 'Trend',
    params: [len(21)],
    outputs: one(),
    source: 'close',
    place: 'overlay',
    compute: (_d, [k], src) => ({ value: ta.ema(src, k) }),
    pine: ([k], src) => ({ out: { value: `ta.ema(${src}, ${k})` } }),
  },
  {
    id: 'wma',
    name: 'Weighted moving average',
    short: 'WMA',
    group: 'Trend',
    params: [len(20)],
    outputs: one(),
    source: 'close',
    place: 'overlay',
    compute: (_d, [k], src) => ({ value: ta.wma(src, k) }),
    pine: ([k], src) => ({ out: { value: `ta.wma(${src}, ${k})` } }),
  },
  {
    id: 'hma',
    name: 'Hull moving average',
    short: 'HMA',
    group: 'Trend',
    params: [len(55)],
    outputs: one(),
    source: 'close',
    place: 'overlay',
    compute: (_d, [k], src) => ({ value: ta.hma(src, k) }),
    pine: ([k], src) => ({ out: { value: `ta.hma(${src}, ${k})` } }),
  },
  {
    id: 'dema',
    name: 'Double EMA',
    short: 'DEMA',
    group: 'Trend',
    params: [len(30)],
    outputs: one(),
    source: 'close',
    place: 'overlay',
    compute: (_d, [k], src) => ({ value: ta.dema(src, k) }),
    pine: ([k], src, v) => ({ lines: [`${v}e = ta.ema(${src}, ${k})`], out: { value: `(2 * ${v}e - ta.ema(${v}e, ${k}))` } }),
  },
  {
    id: 'vwap',
    name: 'Rolling VWAP',
    short: 'VWAP',
    group: 'Trend',
    params: [len(24)],
    outputs: one(),
    place: 'overlay',
    compute: (d, [k]) => ({ value: ta.vwap(d.high, d.low, d.close, d.volume, k) }),
    pine: ([k]) => ({ out: { value: `(math.sum(hlc3 * volume, ${k}) / math.sum(volume, ${k}))` } }),
  },
  {
    id: 'supertrend',
    name: 'Supertrend',
    short: 'Supertrend',
    group: 'Trend',
    params: [len(10, 100), mult('Multiplier', 3)],
    outputs: [
      { key: 'line', label: 'Line' },
      { key: 'dir', label: 'Direction (1 up, -1 down)' },
    ],
    place: 'overlay',
    compute: (d, [k, m]) => {
      const s = ta.supertrend(d.high, d.low, d.close, k, m);
      return { line: s.line, dir: s.dir };
    },
    pine: ([k, m], _src, v) => ({ lines: [`[${v}l, ${v}d] = ta.supertrend(${m}, ${k})`], out: { line: `${v}l`, dir: `(-${v}d)` } }),
  },
  {
    id: 'psar',
    name: 'Parabolic SAR',
    short: 'PSAR',
    group: 'Trend',
    params: [n('Step', 0.02, 0.001, 0.2, 0.001), n('Max', 0.2, 0.01, 1, 0.01)],
    outputs: one(),
    place: 'overlay',
    compute: (d, [s, m]) => ({ value: ta.psar(d.high, d.low, s, m) }),
    pine: ([s, m]) => ({ out: { value: `ta.sar(${s}, ${s}, ${m})` } }),
  },
  {
    id: 'ichimoku',
    name: 'Ichimoku cloud',
    short: 'Ichimoku',
    group: 'Trend',
    params: [n('Tenkan', 9, 1, 100), n('Kijun', 26, 1, 200), n('Span B', 52, 1, 300)],
    outputs: [
      { key: 'spanA', label: 'Span A' },
      { key: 'spanB', label: 'Span B' },
      { key: 'tenkan', label: 'Tenkan' },
      { key: 'kijun', label: 'Kijun' },
    ],
    place: 'overlay',
    compute: (d, [a, b, c]) => ta.ichimoku(d.high, d.low, a, b, c),
    pine: ([a, b, c], _src, v) => ({
      lines: [
        `${v}t = (ta.highest(high, ${a}) + ta.lowest(low, ${a})) / 2`,
        `${v}k = (ta.highest(high, ${b}) + ta.lowest(low, ${b})) / 2`,
        `${v}a = ((${v}t + ${v}k) / 2)[${b}]`,
        `${v}b = ((ta.highest(high, ${c}) + ta.lowest(low, ${c})) / 2)[${b}]`,
      ],
      out: { spanA: `${v}a`, spanB: `${v}b`, tenkan: `${v}t`, kijun: `${v}k` },
    }),
  },
  {
    id: 'adx',
    name: 'ADX / DMI',
    short: 'ADX',
    group: 'Trend',
    params: [len(14, 100)],
    outputs: [
      { key: 'adx', label: 'ADX' },
      { key: 'plus', label: '+DI' },
      { key: 'minus', label: '-DI' },
    ],
    place: 'pane',
    levels: [25],
    hint: 25,
    compute: (d, [k]) => ta.adx(d.high, d.low, d.close, k),
    pine: ([k], _src, v) => ({ lines: [`[${v}p, ${v}m, ${v}a] = ta.dmi(${k}, ${k})`], out: { adx: `${v}a`, plus: `${v}p`, minus: `${v}m` } }),
  },
  {
    id: 'aroon',
    name: 'Aroon',
    short: 'Aroon',
    group: 'Trend',
    params: [len(25, 200)],
    outputs: [
      { key: 'up', label: 'Up' },
      { key: 'down', label: 'Down' },
    ],
    place: 'pane',
    levels: [70, 30],
    hint: 70,
    compute: (d, [k]) => ta.aroon(d.high, d.low, k),
    pine: ([k]) => ({ out: { up: `(100 * (${k} + ta.highestbars(high, ${k + 1})) / ${k})`, down: `(100 * (${k} + ta.lowestbars(low, ${k + 1})) / ${k})` } }),
  },
  {
    id: 'slope',
    name: 'Regression slope % per bar',
    short: 'Slope',
    group: 'Trend',
    params: [len(20, 300)],
    outputs: one(),
    source: 'close',
    place: 'pane',
    levels: [0],
    hint: 0,
    compute: (_d, [k], src) => ({ value: ta.slope(src, k) }),
    pine: ([k], src) => ({ out: { value: `(100 * (ta.linreg(${src}, ${k}, 0) - ta.linreg(${src}, ${k}, 1)) / ${src})` } }),
  },

  // ---- Momentum
  {
    id: 'rsi',
    name: 'Relative strength index',
    short: 'RSI',
    group: 'Momentum',
    params: [len(14, 100)],
    outputs: one(),
    source: 'close',
    place: 'pane',
    levels: [30, 70],
    hint: 30,
    compute: (_d, [k], src) => ({ value: ta.rsi(src, k) }),
    pine: ([k], src) => ({ out: { value: `ta.rsi(${src}, ${k})` } }),
  },
  {
    id: 'stoch',
    name: 'Stochastic',
    short: 'Stoch',
    group: 'Momentum',
    params: [len(14, 100), n('%K smoothing', 3, 1, 20), n('%D smoothing', 3, 1, 20)],
    outputs: [
      { key: 'k', label: '%K' },
      { key: 'd', label: '%D' },
    ],
    place: 'pane',
    levels: [20, 80],
    hint: 20,
    compute: (d, [k, sk, sd]) => ta.stochastic(d.high, d.low, d.close, k, sk, sd),
    pine: ([k, sk, sd], _src, v) => ({ lines: [`${v}k = ta.sma(ta.stoch(close, high, low, ${k}), ${sk})`], out: { k: `${v}k`, d: `ta.sma(${v}k, ${sd})` } }),
  },
  {
    id: 'stochrsi',
    name: 'Stochastic RSI',
    short: 'StochRSI',
    group: 'Momentum',
    params: [n('RSI length', 14, 1, 100), n('Stoch length', 14, 1, 100), n('%K smoothing', 3, 1, 20), n('%D smoothing', 3, 1, 20)],
    outputs: [
      { key: 'k', label: '%K' },
      { key: 'd', label: '%D' },
    ],
    source: 'close',
    place: 'pane',
    levels: [20, 80],
    hint: 20,
    compute: (_d, [r, s, sk, sd], src) => ta.stochRsi(src, r, s, sk, sd),
    pine: ([r, s, sk, sd], src, v) => ({
      lines: [`${v}r = ta.rsi(${src}, ${r})`, `${v}k = ta.sma(ta.stoch(${v}r, ${v}r, ${v}r, ${s}), ${sk})`],
      out: { k: `${v}k`, d: `ta.sma(${v}k, ${sd})` },
    }),
  },
  {
    id: 'macd',
    name: 'MACD',
    short: 'MACD',
    group: 'Momentum',
    params: [n('Fast', 12, 1, 200), n('Slow', 26, 2, 300), n('Signal', 9, 1, 100)],
    outputs: [
      { key: 'line', label: 'MACD line' },
      { key: 'signal', label: 'Signal line' },
      { key: 'hist', label: 'Histogram' },
    ],
    source: 'close',
    place: 'pane',
    levels: [0],
    hint: 0,
    compute: (_d, [f, s, g], src) => ta.macd(src, f, s, g),
    pine: ([f, s, g], src, v) => ({ lines: [`[${v}l, ${v}s, ${v}h] = ta.macd(${src}, ${f}, ${s}, ${g})`], out: { line: `${v}l`, signal: `${v}s`, hist: `${v}h` } }),
  },
  {
    id: 'cci',
    name: 'Commodity channel index',
    short: 'CCI',
    group: 'Momentum',
    params: [len(20, 200)],
    outputs: one(),
    place: 'pane',
    levels: [-100, 100],
    hint: -100,
    compute: (d, [k]) => ({ value: ta.cci(d.high, d.low, d.close, k) }),
    pine: ([k]) => ({ out: { value: `ta.cci(hlc3, ${k})` } }),
  },
  {
    id: 'roc',
    name: 'Rate of change %',
    short: 'ROC',
    group: 'Momentum',
    params: [len(12, 300)],
    outputs: one(),
    source: 'close',
    place: 'pane',
    levels: [0],
    hint: 0,
    compute: (_d, [k], src) => ({ value: ta.roc(src, k) }),
    pine: ([k], src) => ({ out: { value: `ta.roc(${src}, ${k})` } }),
  },
  {
    id: 'mom',
    name: 'Momentum',
    short: 'Mom',
    group: 'Momentum',
    params: [len(10, 300)],
    outputs: one(),
    source: 'close',
    place: 'pane',
    levels: [0],
    hint: 0,
    compute: (_d, [k], src) => ({ value: ta.momentum(src, k) }),
    pine: ([k], src) => ({ out: { value: `ta.mom(${src}, ${k})` } }),
  },
  {
    id: 'willr',
    name: 'Williams %R',
    short: '%R',
    group: 'Momentum',
    params: [len(14, 100)],
    outputs: one(),
    place: 'pane',
    levels: [-80, -20],
    hint: -80,
    compute: (d, [k]) => ({ value: ta.williamsR(d.high, d.low, d.close, k) }),
    pine: ([k]) => ({ out: { value: `ta.wpr(${k})` } }),
  },
  {
    id: 'zscore',
    name: 'Z-score',
    short: 'Z',
    group: 'Momentum',
    params: [len(20, 300)],
    outputs: one(),
    source: 'close',
    place: 'pane',
    levels: [-2, 2],
    hint: -2,
    compute: (_d, [k], src) => ({ value: ta.zscore(src, k) }),
    pine: ([k], src) => ({ out: { value: `((${src} - ta.sma(${src}, ${k})) / ta.stdev(${src}, ${k}))` } }),
  },

  // ---- Volatility
  {
    id: 'bb',
    name: 'Bollinger Bands',
    short: 'BB',
    group: 'Volatility',
    params: [len(20, 200), mult('Width (σ)', 2, 0.5, 5)],
    outputs: [
      { key: 'upper', label: 'Upper band' },
      { key: 'mid', label: 'Middle' },
      { key: 'lower', label: 'Lower band' },
      { key: 'percentB', label: '%B' },
      { key: 'bandwidth', label: 'Bandwidth' },
    ],
    source: 'close',
    place: 'overlay',
    compute: (_d, [k, w], src) => ta.bollinger(src, k, w),
    pine: ([k, w], src, v) => ({
      lines: [`[${v}m, ${v}u, ${v}l] = ta.bb(${src}, ${k}, ${w})`],
      out: { upper: `${v}u`, mid: `${v}m`, lower: `${v}l`, percentB: `((${src} - ${v}l) / (${v}u - ${v}l))`, bandwidth: `((${v}u - ${v}l) / ${v}m)` },
    }),
  },
  {
    id: 'keltner',
    name: 'Keltner channel',
    short: 'KC',
    group: 'Volatility',
    params: [len(20, 200), mult('ATR multiple', 2, 0.5, 6)],
    outputs: [
      { key: 'upper', label: 'Upper' },
      { key: 'mid', label: 'Middle' },
      { key: 'lower', label: 'Lower' },
    ],
    place: 'overlay',
    compute: (d, [k, m]) => ta.keltner(d.high, d.low, d.close, k, m),
    pine: ([k, m], _src, v) => ({
      lines: [`${v}m = ta.ema(close, ${k})`, `${v}a = ta.atr(${k})`],
      out: { upper: `(${v}m + ${m} * ${v}a)`, mid: `${v}m`, lower: `(${v}m - ${m} * ${v}a)` },
    }),
  },
  // "price drops 1.5 ATR below the 25 SMA": a moving average shifted by a multiple of ATR
  ...(['sma', 'ema'] as const).map(
    (ma): IndicatorDef => ({
      id: `${ma}atr`,
      name: `${ma.toUpperCase()} ± ATR`,
      short: `${ma.toUpperCase()} ± ATR`,
      group: 'Volatility',
      params: [len(20), mult('ATR multiple', 1.5, 0.1, 10), n('ATR length', 14, 1, 200)],
      outputs: [
        { key: 'lower', label: 'Lower' },
        { key: 'upper', label: 'Upper' },
      ],
      source: 'close',
      place: 'overlay',
      compute: (d, [k, m, a], src) => {
        const mid = ma === 'sma' ? ta.sma(src, k) : ta.ema(src, k);
        const r = ta.atr(d.high, d.low, d.close, a);
        return { lower: mid.map((x, i) => x - m * r[i]), upper: mid.map((x, i) => x + m * r[i]) };
      },
      pine: ([k, m, a], src, v) => ({
        lines: [`${v}m = ta.${ma}(${src}, ${k})`, `${v}a = ta.atr(${a})`],
        out: { lower: `(${v}m - ${m} * ${v}a)`, upper: `(${v}m + ${m} * ${v}a)` },
      }),
    }),
  ),
  {
    id: 'donchian',
    name: 'Donchian channel (prior bars)',
    short: 'Donchian',
    group: 'Volatility',
    params: [len(20, 300)],
    outputs: [
      { key: 'upper', label: 'Upper (prior high)' },
      { key: 'lower', label: 'Lower (prior low)' },
      { key: 'mid', label: 'Middle' },
    ],
    place: 'overlay',
    compute: (d, [k]) => ta.donchian(d.high, d.low, k),
    pine: ([k], _src, v) => ({
      lines: [`${v}u = ta.highest(high, ${k})[1]`, `${v}l = ta.lowest(low, ${k})[1]`],
      out: { upper: `${v}u`, lower: `${v}l`, mid: `((${v}u + ${v}l) / 2)` },
    }),
  },
  {
    id: 'highest',
    name: 'Highest over N bars',
    short: 'Highest',
    group: 'Volatility',
    params: [len(20, 300)],
    outputs: one(),
    source: 'high',
    place: 'overlay',
    compute: (_d, [k], src) => ({ value: ta.highest(src, k) }),
    pine: ([k], src) => ({ out: { value: `ta.highest(${src}, ${k})` } }),
  },
  {
    id: 'lowest',
    name: 'Lowest over N bars',
    short: 'Lowest',
    group: 'Volatility',
    params: [len(20, 300)],
    outputs: one(),
    source: 'low',
    place: 'overlay',
    compute: (_d, [k], src) => ({ value: ta.lowest(src, k) }),
    pine: ([k], src) => ({ out: { value: `ta.lowest(${src}, ${k})` } }),
  },
  {
    id: 'atr',
    name: 'Average true range',
    short: 'ATR',
    group: 'Volatility',
    params: [len(14, 200)],
    outputs: one(),
    place: 'pane',
    compute: (d, [k]) => ({ value: ta.atr(d.high, d.low, d.close, k) }),
    pine: ([k]) => ({ out: { value: `ta.atr(${k})` } }),
  },
  {
    id: 'atrp',
    name: 'ATR % of price',
    short: 'ATR%',
    group: 'Volatility',
    params: [len(14, 200)],
    outputs: one(),
    place: 'pane',
    hint: 3,
    compute: (d, [k]) => {
      const a = ta.atr(d.high, d.low, d.close, k);
      return { value: a.map((x, i) => (100 * x) / d.close[i]) };
    },
    pine: ([k]) => ({ out: { value: `(100 * ta.atr(${k}) / close)` } }),
  },
  {
    id: 'stdev',
    name: 'Standard deviation',
    short: 'StDev',
    group: 'Volatility',
    params: [len(20, 300)],
    outputs: one(),
    source: 'close',
    place: 'pane',
    compute: (_d, [k], src) => ({ value: ta.stdev(src, k) }),
    pine: ([k], src) => ({ out: { value: `ta.stdev(${src}, ${k})` } }),
  },

  // ---- Volume
  {
    id: 'volume',
    name: 'Volume',
    short: 'Volume',
    group: 'Volume',
    params: [],
    outputs: one(),
    place: 'none',
    compute: (d) => ({ value: d.volume }),
    pine: () => ({ out: { value: 'volume' } }),
  },
  {
    id: 'volsma',
    name: 'Average volume',
    short: 'AvgVol',
    group: 'Volume',
    params: [len(20, 300)],
    outputs: one(),
    place: 'none',
    compute: (d, [k]) => ({ value: ta.sma(d.volume, k) }),
    pine: ([k]) => ({ out: { value: `ta.sma(volume, ${k})` } }),
  },
  {
    id: 'rvol',
    name: 'Relative volume',
    short: 'RelVol',
    group: 'Volume',
    params: [len(20, 300)],
    outputs: one(),
    place: 'pane',
    levels: [1],
    hint: 1.5,
    compute: (d, [k]) => {
      const a = ta.sma(d.volume, k);
      return { value: d.volume.map((v, i) => (a[i] > 0 ? v / a[i] : NaN)) };
    },
    pine: ([k]) => ({ out: { value: `(volume / ta.sma(volume, ${k}))` } }),
  },
  {
    id: 'obv',
    name: 'On-balance volume',
    short: 'OBV',
    group: 'Volume',
    params: [],
    outputs: one(),
    place: 'pane',
    compute: (d) => ({ value: ta.obv(d.close, d.volume) }),
    pine: () => ({ out: { value: 'ta.obv' } }),
  },
  {
    id: 'mfi',
    name: 'Money flow index',
    short: 'MFI',
    group: 'Volume',
    params: [len(14, 100)],
    outputs: one(),
    place: 'pane',
    levels: [20, 80],
    hint: 20,
    compute: (d, [k]) => ({ value: ta.mfi(d.high, d.low, d.close, d.volume, k) }),
    pine: ([k]) => ({ out: { value: `ta.mfi(hlc3, ${k})` } }),
  },
  {
    id: 'cmf',
    name: 'Chaikin money flow',
    short: 'CMF',
    group: 'Volume',
    params: [len(20, 200)],
    outputs: one(),
    place: 'pane',
    levels: [0],
    hint: 0,
    compute: (d, [k]) => ({ value: ta.cmf(d.high, d.low, d.close, d.volume, k) }),
    pine: ([k]) => ({
      out: { value: `(math.sum(((close - low) - (high - close)) / math.max(high - low, syminfo.mintick) * volume, ${k}) / math.sum(volume, ${k}))` },
    }),
  },

  // ---- Candle patterns (1 when the pattern prints, 0 otherwise)
  {
    id: 'pattern',
    name: 'Candle pattern',
    short: 'Pattern',
    group: 'Pattern',
    params: [],
    outputs: [
      { key: 'bullEngulf', label: 'Bullish engulfing' },
      { key: 'bearEngulf', label: 'Bearish engulfing' },
      { key: 'hammer', label: 'Hammer' },
      { key: 'shootingStar', label: 'Shooting star' },
      { key: 'inside', label: 'Inside bar' },
      { key: 'doji', label: 'Doji' },
      { key: 'upStreak', label: 'Up closes in a row' },
      { key: 'downStreak', label: 'Down closes in a row' },
    ],
    place: 'none',
    hint: 1,
    compute: (d) => {
      const { open: o, high: h, low: l, close: c } = d;
      const body = c.map((x, i) => Math.abs(x - o[i]));
      const range = h.map((x, i) => x - l[i]);
      let up = 0;
      let down = 0;
      const upStreak: number[] = [];
      const downStreak: number[] = [];
      c.forEach((x, i) => {
        up = i > 0 && x > c[i - 1] ? up + 1 : 0;
        down = i > 0 && x < c[i - 1] ? down + 1 : 0;
        upStreak.push(up);
        downStreak.push(down);
      });
      return {
        bullEngulf: bool(c.map((x, i) => i > 0 && x > o[i] && c[i - 1] < o[i - 1] && x >= o[i - 1] && o[i] <= c[i - 1])),
        bearEngulf: bool(c.map((x, i) => i > 0 && x < o[i] && c[i - 1] > o[i - 1] && x <= o[i - 1] && o[i] >= c[i - 1])),
        hammer: bool(c.map((x, i) => range[i] > 0 && Math.min(x, o[i]) - l[i] >= 2 * body[i] && h[i] - Math.max(x, o[i]) <= body[i] * 0.5)),
        shootingStar: bool(c.map((x, i) => range[i] > 0 && h[i] - Math.max(x, o[i]) >= 2 * body[i] && Math.min(x, o[i]) - l[i] <= body[i] * 0.5)),
        inside: bool(h.map((x, i) => i > 0 && x < h[i - 1] && l[i] > l[i - 1])),
        doji: bool(body.map((b, i) => range[i] > 0 && b <= range[i] * 0.1)),
        upStreak,
        downStreak,
      };
    },
    pine: (_p, _src, v) => ({
      lines: [
        `${v}body = math.abs(close - open)`,
        `${v}rng = high - low`,
        `var int ${v}up = 0`,
        `var int ${v}dn = 0`,
        `${v}up := close > close[1] ? ${v}up + 1 : 0`,
        `${v}dn := close < close[1] ? ${v}dn + 1 : 0`,
      ],
      out: {
        bullEngulf: '(close > open and close[1] < open[1] and close >= open[1] and open <= close[1] ? 1 : 0)',
        bearEngulf: '(close < open and close[1] > open[1] and close <= open[1] and open >= close[1] ? 1 : 0)',
        hammer: `(${v}rng > 0 and math.min(close, open) - low >= 2 * ${v}body and high - math.max(close, open) <= 0.5 * ${v}body ? 1 : 0)`,
        shootingStar: `(${v}rng > 0 and high - math.max(close, open) >= 2 * ${v}body and math.min(close, open) - low <= 0.5 * ${v}body ? 1 : 0)`,
        inside: '(high < high[1] and low > low[1] ? 1 : 0)',
        doji: `(${v}rng > 0 and ${v}body <= 0.1 * ${v}rng ? 1 : 0)`,
        upStreak: `${v}up`,
        downStreak: `${v}dn`,
      },
    }),
  },
];

const BY_ID = new Map(INDICATORS.map((d) => [d.id, d]));
export const indicator = (id: string): IndicatorDef => {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown indicator "${id}"`);
  return def;
};
export const hasIndicator = (id: string) => BY_ID.has(id);

export function inputsOf(candles: readonly Candle[]): Inputs {
  return {
    time: candles.map((c) => c.time),
    open: candles.map((c) => c.open),
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    close: candles.map((c) => c.close),
    volume: candles.map((c) => c.volume),
  };
}

export function sourceSeries(d: Inputs, s: Source): number[] {
  switch (s) {
    case 'hl2':
      return d.high.map((h, i) => (h + d.low[i]) / 2);
    case 'hlc3':
      return d.high.map((h, i) => (h + d.low[i] + d.close[i]) / 3);
    case 'ohlc4':
      return d.open.map((o, i) => (o + d.high[i] + d.low[i] + d.close[i]) / 4);
    default:
      return d[s];
  }
}

export const PINE_SOURCE: Record<Source, string> = {
  open: 'open',
  high: 'high',
  low: 'low',
  close: 'close',
  hl2: 'hl2',
  hlc3: 'hlc3',
  ohlc4: 'ohlc4',
  volume: 'volume',
};
