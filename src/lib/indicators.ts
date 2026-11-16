// Technical indicators. Every function returns an array as long as its input, with NaN wherever
// there isn't enough history yet, so values line up with the candles they belong to.

const blank = (n: number) => new Array<number>(n).fill(NaN);
const firstValid = (values: readonly number[]) => values.findIndex((v) => !Number.isNaN(v));

/** Simple moving average. Leading NaNs are skipped. */
export function sma(values: readonly number[], period: number): number[] {
  const out = blank(values.length);
  const start = firstValid(values);
  if (start < 0 || period < 1) return out;
  let sum = 0;
  for (let i = start; i < values.length; i++) {
    sum += values[i];
    if (i - start >= period) sum -= values[i - period];
    if (i - start >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average, seeded with the SMA of its first `period` values. Leading NaNs are skipped. */
export function ema(values: readonly number[], period: number): number[] {
  return smoothed(values, period, 2 / (period + 1));
}

/** Wilder's moving average (RMA), used by RSI, ATR and ADX. */
export function rma(values: readonly number[], period: number): number[] {
  return smoothed(values, period, 1 / period);
}

function smoothed(values: readonly number[], period: number, k: number): number[] {
  const out = blank(values.length);
  const start = firstValid(values);
  if (start < 0 || period < 1 || start + period > values.length) return out;
  let prev = 0;
  for (let i = start; i < start + period; i++) prev += values[i];
  prev /= period;
  out[start + period - 1] = prev;
  for (let i = start + period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Linearly weighted moving average. */
export function wma(values: readonly number[], period: number): number[] {
  const out = blank(values.length);
  const start = firstValid(values);
  if (start < 0 || period < 1) return out;
  const denom = (period * (period + 1)) / 2;
  for (let i = start + period - 1; i < values.length; i++) {
    let s = 0;
    for (let j = 0; j < period; j++) s += values[i - j] * (period - j);
    out[i] = s / denom;
  }
  return out;
}

/** Hull moving average: fast and smooth. */
export function hma(values: readonly number[], period: number): number[] {
  const half = wma(values, Math.max(1, Math.round(period / 2)));
  const full = wma(values, period);
  return wma(
    half.map((v, i) => 2 * v - full[i]),
    Math.max(1, Math.round(Math.sqrt(period))),
  );
}

/** Double exponential moving average. */
export function dema(values: readonly number[], period: number): number[] {
  const e1 = ema(values, period);
  const e2 = ema(e1, period);
  return e1.map((v, i) => 2 * v - e2[i]);
}

/** Population standard deviation over a rolling window. */
export function stdev(values: readonly number[], period: number): number[] {
  const mean = sma(values, period);
  const out = blank(values.length);
  for (let i = period - 1; i < values.length; i++) {
    if (Number.isNaN(mean[i])) continue;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += (values[j] - mean[i]) ** 2;
    out[i] = Math.sqrt(sq / period);
  }
  return out;
}

/** Relative Strength Index with Wilder's smoothing (the standard RSI). */
export function rsi(values: readonly number[], period: number): number[] {
  const out = blank(values.length);
  const start = firstValid(values);
  if (start < 0 || values.length - start <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = start + 1; i <= start + period; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  const value = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[start + period] = value();
  for (let i = start + period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = value();
  }
  return out;
}

/** Bollinger Bands: an SMA with bands `width` standard deviations above and below. */
export function bollinger(values: readonly number[], period: number, width: number) {
  const mid = sma(values, period);
  const sd = stdev(values, period);
  const upper = mid.map((m, i) => m + width * sd[i]);
  const lower = mid.map((m, i) => m - width * sd[i]);
  const percentB = values.map((v, i) => (upper[i] - lower[i] > 0 ? (v - lower[i]) / (upper[i] - lower[i]) : NaN));
  const bandwidth = mid.map((m, i) => (m ? (upper[i] - lower[i]) / m : NaN));
  return { mid, upper, lower, percentB, bandwidth };
}

/** True range of each bar. */
export function trueRange(high: readonly number[], low: readonly number[], close: readonly number[]): number[] {
  return high.map((h, i) => (i === 0 ? h - low[i] : Math.max(h - low[i], Math.abs(h - close[i - 1]), Math.abs(low[i] - close[i - 1]))));
}

/** Average true range (Wilder). */
export function atr(high: readonly number[], low: readonly number[], close: readonly number[], period: number): number[] {
  return rma(trueRange(high, low, close), period);
}

/** Keltner channel: an EMA with bands `mult` ATRs above and below. */
export function keltner(high: readonly number[], low: readonly number[], close: readonly number[], period: number, mult: number) {
  const mid = ema(close, period);
  const a = atr(high, low, close, period);
  return { mid, upper: mid.map((m, i) => m + mult * a[i]), lower: mid.map((m, i) => m - mult * a[i]) };
}

/** Highest (or lowest) value of the `period` bars before each bar, not counting the bar itself. */
function priorExtreme(values: readonly number[], period: number, highest: boolean): number[] {
  const out = blank(values.length);
  const window: number[] = []; // indices, best value first
  let head = 0;
  const beats = (a: number, b: number) => (highest ? a >= b : a <= b);
  for (let i = 0; i < values.length; i++) {
    if (i >= period) {
      while (window[head] < i - period) head++;
      out[i] = values[window[head]];
    }
    while (window.length > head && beats(values[i], values[window[window.length - 1]])) window.pop();
    window.push(i);
  }
  return out;
}

/** Highest value of the last `period` bars including the current one. */
export function highest(values: readonly number[], period: number): number[] {
  const prior = priorExtreme(values, period - 1 || 1, true);
  return values.map((v, i) => (period <= 1 ? v : i >= period - 1 ? Math.max(v, prior[i]) : NaN));
}

/** Lowest value of the last `period` bars including the current one. */
export function lowest(values: readonly number[], period: number): number[] {
  const prior = priorExtreme(values, period - 1 || 1, false);
  return values.map((v, i) => (period <= 1 ? v : i >= period - 1 ? Math.min(v, prior[i]) : NaN));
}

/** Donchian channel: the highest high and lowest low of the previous `period` bars (a breakout level). */
export function donchian(highs: readonly number[], lows: readonly number[], period: number) {
  const upper = priorExtreme(highs, period, true);
  const lower = priorExtreme(lows, period, false);
  return { upper, lower, mid: upper.map((u, i) => (u + lower[i]) / 2) };
}

/** MACD line (fast EMA minus slow EMA), its signal line and the histogram between them. */
export function macd(values: readonly number[], fast: number, slow: number, signal: number) {
  const f = ema(values, fast);
  const s = ema(values, slow);
  const line = values.map((_, i) => f[i] - s[i]);
  const sig = ema(line, signal);
  const hist = line.map((v, i) => v - sig[i]);
  return { line, signal: sig, hist };
}

/** Stochastic oscillator %K (smoothed) and %D. */
export function stochastic(high: readonly number[], low: readonly number[], close: readonly number[], period: number, smoothK: number, smoothD: number) {
  const hh = highest(high, period);
  const ll = lowest(low, period);
  const raw = close.map((c, i) => (hh[i] - ll[i] > 0 ? (100 * (c - ll[i])) / (hh[i] - ll[i]) : 50));
  const valid = raw.map((v, i) => (Number.isNaN(hh[i]) ? NaN : v));
  const k = sma(valid, smoothK);
  return { k, d: sma(k, smoothD) };
}

/** Stochastic RSI. */
export function stochRsi(close: readonly number[], rsiLen: number, stochLen: number, smoothK: number, smoothD: number) {
  const r = rsi(close, rsiLen);
  return stochastic(r, r, r, stochLen, smoothK, smoothD);
}

/** Average directional index with the +DI and -DI lines. */
export function adx(high: readonly number[], low: readonly number[], close: readonly number[], period: number) {
  const n = high.length;
  const plusDM = blank(n);
  const minusDM = blank(n);
  for (let i = 1; i < n; i++) {
    const up = high[i] - high[i - 1];
    const down = low[i - 1] - low[i];
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
  }
  const tr = trueRange(high, low, close);
  tr[0] = NaN;
  const trS = rma(tr, period);
  const plus = rma(plusDM, period).map((v, i) => (trS[i] > 0 ? (100 * v) / trS[i] : NaN));
  const minus = rma(minusDM, period).map((v, i) => (trS[i] > 0 ? (100 * v) / trS[i] : NaN));
  const dx = plus.map((p, i) => (p + minus[i] > 0 ? (100 * Math.abs(p - minus[i])) / (p + minus[i]) : NaN));
  return { adx: rma(dx, period), plus, minus };
}

/** Commodity channel index. */
export function cci(high: readonly number[], low: readonly number[], close: readonly number[], period: number): number[] {
  const tp = close.map((c, i) => (high[i] + low[i] + c) / 3);
  const mean = sma(tp, period);
  const out = blank(close.length);
  for (let i = period - 1; i < close.length; i++) {
    let dev = 0;
    for (let j = i - period + 1; j <= i; j++) dev += Math.abs(tp[j] - mean[i]);
    dev /= period;
    out[i] = dev > 0 ? (tp[i] - mean[i]) / (0.015 * dev) : 0;
  }
  return out;
}

/** Rate of change in percent over `period` bars. */
export function roc(values: readonly number[], period: number): number[] {
  return values.map((v, i) => (i >= period && values[i - period] ? (100 * (v - values[i - period])) / values[i - period] : NaN));
}

/** Momentum: the change over `period` bars. */
export function momentum(values: readonly number[], period: number): number[] {
  return values.map((v, i) => (i >= period ? v - values[i - period] : NaN));
}

/** Williams %R, from 0 (top of the range) to -100 (bottom). */
export function williamsR(high: readonly number[], low: readonly number[], close: readonly number[], period: number): number[] {
  const hh = highest(high, period);
  const ll = lowest(low, period);
  return close.map((c, i) => (hh[i] - ll[i] > 0 ? (-100 * (hh[i] - c)) / (hh[i] - ll[i]) : NaN));
}

/** On-balance volume. */
export function obv(close: readonly number[], volume: readonly number[]): number[] {
  let total = 0;
  return close.map((c, i) => {
    if (i > 0) total += c > close[i - 1] ? volume[i] : c < close[i - 1] ? -volume[i] : 0;
    return total;
  });
}

/** Money flow index (volume-weighted RSI). */
export function mfi(high: readonly number[], low: readonly number[], close: readonly number[], volume: readonly number[], period: number): number[] {
  const tp = close.map((c, i) => (high[i] + low[i] + c) / 3);
  const out = blank(close.length);
  for (let i = period; i < close.length; i++) {
    let pos = 0;
    let neg = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const flow = tp[j] * volume[j];
      if (tp[j] > tp[j - 1]) pos += flow;
      else if (tp[j] < tp[j - 1]) neg += flow;
    }
    out[i] = neg === 0 ? (pos === 0 ? 50 : 100) : 100 - 100 / (1 + pos / neg);
  }
  return out;
}

/** Chaikin money flow. */
export function cmf(high: readonly number[], low: readonly number[], close: readonly number[], volume: readonly number[], period: number): number[] {
  const mfv = close.map((c, i) => (high[i] - low[i] > 0 ? ((c - low[i] - (high[i] - c)) / (high[i] - low[i])) * volume[i] : 0));
  const a = sma(mfv, period);
  const v = sma(volume, period);
  return a.map((x, i) => (v[i] > 0 ? x / v[i] : NaN));
}

/** Supertrend line and direction (1 up, -1 down). */
export function supertrend(high: readonly number[], low: readonly number[], close: readonly number[], period: number, mult: number) {
  const n = close.length;
  const a = atr(high, low, close, period);
  const line = blank(n);
  const dir = blank(n);
  let upper = NaN;
  let lower = NaN;
  let d = 1;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(a[i])) continue;
    const hl2 = (high[i] + low[i]) / 2;
    const bu = hl2 + mult * a[i];
    const bl = hl2 - mult * a[i];
    const prevClose = i > 0 ? close[i - 1] : close[i];
    upper = Number.isNaN(upper) || bu < upper || prevClose > upper ? bu : upper;
    lower = Number.isNaN(lower) || bl > lower || prevClose < lower ? bl : lower;
    if (Number.isNaN(line[i - 1])) d = close[i] >= hl2 ? 1 : -1;
    else if (d === -1 && close[i] > upper) d = 1;
    else if (d === 1 && close[i] < lower) d = -1;
    line[i] = d === 1 ? lower : upper;
    dir[i] = d;
  }
  return { line, dir };
}

/** Parabolic SAR. */
export function psar(high: readonly number[], low: readonly number[], step: number, max: number): number[] {
  const n = high.length;
  const out = blank(n);
  if (n < 2) return out;
  let up = high[1] >= high[0];
  let sar = up ? low[0] : high[0];
  let ep = up ? high[1] : low[1];
  let af = step;
  for (let i = 1; i < n; i++) {
    sar = sar + af * (ep - sar);
    if (up) {
      sar = Math.min(sar, low[i - 1], i > 1 ? low[i - 2] : low[i - 1]);
      if (low[i] < sar) {
        up = false;
        sar = ep;
        ep = low[i];
        af = step;
      } else if (high[i] > ep) {
        ep = high[i];
        af = Math.min(max, af + step);
      }
    } else {
      sar = Math.max(sar, high[i - 1], i > 1 ? high[i - 2] : high[i - 1]);
      if (high[i] > sar) {
        up = true;
        sar = ep;
        ep = high[i];
        af = step;
      } else if (low[i] < ep) {
        ep = low[i];
        af = Math.min(max, af + step);
      }
    }
    out[i] = sar;
  }
  return out;
}

/** Ichimoku lines. The leading spans are shown where they apply (shifted forward by `kijun` bars). */
export function ichimoku(high: readonly number[], low: readonly number[], tenkanLen: number, kijunLen: number, spanBLen: number) {
  const mid = (len: number) => {
    const hh = highest(high, len);
    const ll = lowest(low, len);
    return hh.map((h, i) => (h + ll[i]) / 2);
  };
  const tenkan = mid(tenkanLen);
  const kijun = mid(kijunLen);
  const rawA = tenkan.map((t, i) => (t + kijun[i]) / 2);
  const rawB = mid(spanBLen);
  const shift = (xs: number[]) => xs.map((_, i) => (i >= kijunLen ? xs[i - kijunLen] : NaN));
  return { tenkan, kijun, spanA: shift(rawA), spanB: shift(rawB) };
}

/** Volume-weighted average price over a rolling window of bars. */
export function vwap(high: readonly number[], low: readonly number[], close: readonly number[], volume: readonly number[], period: number): number[] {
  const pv = close.map((c, i) => ((high[i] + low[i] + c) / 3) * volume[i]);
  const a = sma(pv, period);
  const v = sma(volume, period);
  return a.map((x, i) => (v[i] > 0 ? x / v[i] : NaN));
}

/** Aroon up and down. */
export function aroon(high: readonly number[], low: readonly number[], period: number) {
  const n = high.length;
  const up = blank(n);
  const down = blank(n);
  for (let i = period; i < n; i++) {
    let hi = i;
    let lo = i;
    for (let j = i - period; j <= i; j++) {
      if (high[j] >= high[hi]) hi = j;
      if (low[j] <= low[lo]) lo = j;
    }
    up[i] = (100 * (period - (i - hi))) / period;
    down[i] = (100 * (period - (i - lo))) / period;
  }
  return { up, down };
}

/** Z-score of a value against its rolling mean and deviation. */
export function zscore(values: readonly number[], period: number): number[] {
  const m = sma(values, period);
  const sd = stdev(values, period);
  return values.map((v, i) => (sd[i] > 0 ? (v - m[i]) / sd[i] : NaN));
}

/** Slope of a least-squares line through the last `period` values, in percent of price per bar. */
export function slope(values: readonly number[], period: number): number[] {
  const out = blank(values.length);
  const sx = (period * (period - 1)) / 2;
  const sxx = ((period - 1) * period * (2 * period - 1)) / 6;
  const denom = period * sxx - sx * sx;
  for (let i = period - 1; i < values.length; i++) {
    let sy = 0;
    let sxy = 0;
    for (let j = 0; j < period; j++) {
      const y = values[i - period + 1 + j];
      sy += y;
      sxy += j * y;
    }
    const b = (period * sxy - sx * sy) / denom;
    out[i] = values[i] ? (100 * b) / values[i] : NaN;
  }
  return out;
}

/** True on each bar where `a` closes above `b` after being at or below it on the bar before. */
export function crossesAbove(a: readonly number[], b: readonly number[] | number): boolean[] {
  const at = (i: number) => (typeof b === 'number' ? b : b[i]);
  return a.map((v, i) => i > 0 && v > at(i) && a[i - 1] <= at(i - 1));
}

/** True on each bar where `a` closes below `b` after being at or above it on the bar before. */
export function crossesBelow(a: readonly number[], b: readonly number[] | number): boolean[] {
  const at = (i: number) => (typeof b === 'number' ? b : b[i]);
  return a.map((v, i) => i > 0 && v < at(i) && a[i - 1] >= at(i - 1));
}
