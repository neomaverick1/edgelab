// Technical indicators. Every function returns an array as long as its input, with NaN wherever
// there isn't enough history yet, so values line up with the candles they belong to.

const blank = (n: number) => new Array<number>(n).fill(NaN);

/** Simple moving average. */
export function sma(values: readonly number[], period: number): number[] {
  const out = blank(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average, seeded with the SMA of its first `period` values. Leading NaNs are skipped. */
export function ema(values: readonly number[], period: number): number[] {
  const out = blank(values.length);
  const start = values.findIndex((v) => !Number.isNaN(v));
  if (start < 0 || start + period > values.length) return out;
  const k = 2 / (period + 1);
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

/** Relative Strength Index with Wilder's smoothing (the standard RSI). */
export function rsi(values: readonly number[], period: number): number[] {
  const out = blank(values.length);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  const value = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[period] = value();
  for (let i = period + 1; i < values.length; i++) {
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
  const upper = blank(values.length);
  const lower = blank(values.length);
  for (let i = period - 1; i < values.length; i++) {
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += (values[j] - mid[i]) ** 2;
    const sd = Math.sqrt(sq / period);
    upper[i] = mid[i] + width * sd;
    lower[i] = mid[i] - width * sd;
  }
  return { mid, upper, lower };
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

/** Donchian channel: the highest high and lowest low of the previous `period` bars. */
export function donchian(highs: readonly number[], lows: readonly number[], period: number) {
  return { upper: priorExtreme(highs, period, true), lower: priorExtreme(lows, period, false) };
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
