import type { Backtest } from './engine';
import type { Candle, Trade } from './types';

const DAY = 86_400;
const YEAR = 365.25 * DAY;

export interface CurveStats {
  returnPct: number;
  cagr: number | null; // null when the test is shorter than six months
  maxDrawdown: number; // negative fraction, e.g. -0.32
  maxDrawdownDays: number; // longest time spent below a previous high
  sharpe: number;
  sortino: number;
}

export interface Stats extends CurveStats {
  netProfit: number;
  calmar: number | null;
  trades: number;
  winRate: number;
  profitFactor: number; // Infinity when there are no losing trades
  avgTrade: number;
  avgWin: number;
  avgLoss: number;
  best: number;
  worst: number;
  avgBars: number;
  exposure: number;
  fees: number;
  slippage: number;
  expectancy: number;
}

/** Fraction below the running high at each point (0 at a new high, -0.25 when 25% down). `start` is the capital before the first bar. */
export function drawdowns(equity: readonly number[], start: number): number[] {
  let peak = start;
  return equity.map((v) => {
    peak = Math.max(peak, v);
    return v / peak - 1;
  });
}

/**
 * Return, CAGR, max drawdown, Sharpe and Sortino of an equity curve. `start` is the capital before the first bar;
 * crypto trades every day, so a year has 365 days of bars.
 */
export function curveStats(equity: readonly number[], times: readonly number[], granularity: number, start: number): CurveStats {
  const final = equity[equity.length - 1];
  const years = (times[times.length - 1] - times[0] + granularity) / YEAR;
  const rets: number[] = [];
  let prev = start;
  for (const v of equity) {
    rets.push(prev > 0 ? v / prev - 1 : 0);
    prev = v;
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1));
  const downside = Math.sqrt(rets.reduce((a, r) => a + Math.min(r, 0) ** 2, 0) / Math.max(1, rets.length - 1));
  const perYear = Math.sqrt((365 * DAY) / granularity);

  let peak = start;
  let peakTime = times[0]; // when the running high was set (bars are measured at their close)
  let maxDrawdown = 0;
  let maxDrawdownDays = 0;
  equity.forEach((v, i) => {
    const closeTime = times[i] + granularity;
    if (v >= peak) {
      peak = v;
      peakTime = closeTime;
    } else {
      maxDrawdown = Math.min(maxDrawdown, v / peak - 1);
      maxDrawdownDays = Math.max(maxDrawdownDays, (closeTime - peakTime) / DAY);
    }
  });

  return {
    returnPct: final / start - 1,
    cagr: years < 0.5 ? null : final > 0 ? (final / start) ** (1 / years) - 1 : -1,
    maxDrawdown,
    maxDrawdownDays: Math.round(maxDrawdownDays),
    sharpe: sd > 0 ? (mean / sd) * perYear : 0,
    sortino: downside > 0 ? (mean / downside) * perYear : 0,
  };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function tradeStats(trades: readonly Trade[]) {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = -losses.reduce((a, t) => a + t.pnl, 0);
  return {
    trades: trades.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    avgTrade: avg(trades.map((t) => t.pnlPct)),
    avgWin: avg(wins.map((t) => t.pnlPct)),
    avgLoss: avg(losses.map((t) => t.pnlPct)),
    best: trades.length ? Math.max(...trades.map((t) => t.pnlPct)) : 0,
    worst: trades.length ? Math.min(...trades.map((t) => t.pnlPct)) : 0,
    avgBars: avg(trades.map((t) => t.bars)),
    expectancy: avg(trades.map((t) => t.pnl)),
  };
}

export function computeStats(bt: Backtest, candles: readonly Candle[], granularity: number, capital: number): Stats {
  const times = candles.slice(bt.start, bt.end + 1).map((c) => c.time);
  const curve = curveStats(bt.equity, times, granularity, capital);
  return {
    ...curve,
    ...tradeStats(bt.trades),
    netProfit: bt.equity[bt.equity.length - 1] - capital,
    calmar: curve.cagr !== null && curve.maxDrawdown < 0 ? curve.cagr / -curve.maxDrawdown : null,
    exposure: bt.position.filter((p) => p !== 0).length / bt.position.length,
    fees: bt.fees,
    slippage: bt.slippage,
  };
}

export interface YearRow {
  year: number;
  months: (number | null)[]; // 12 entries, null where the test has no bars
  total: number;
}

/** Calendar-month returns (UTC) from an equity curve, plus each year's total. */
export function monthlyReturns(equity: readonly number[], times: readonly number[], capital: number): YearRow[] {
  const rows = new Map<number, YearRow>();
  let before = capital; // account value at the end of the previous month
  let yearStart = capital;
  for (let i = 0; i < equity.length; i++) {
    const d = new Date(times[i] * 1000);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const next = i + 1 < equity.length ? new Date(times[i + 1] * 1000) : null;
    const monthEnds = !next || next.getUTCMonth() !== month || next.getUTCFullYear() !== year;
    if (!rows.has(year)) {
      rows.set(year, { year, months: new Array<number | null>(12).fill(null), total: 0 });
      yearStart = before;
    }
    if (monthEnds) {
      const row = rows.get(year)!;
      row.months[month] = before > 0 ? equity[i] / before - 1 : 0;
      row.total = yearStart > 0 ? equity[i] / yearStart - 1 : 0;
      before = equity[i];
    }
  }
  return [...rows.values()];
}
