import type { Backtest } from './engine';
import type { Candle, ExitReason, Trade } from './types';

const DAY = 86_400;
const YEAR = 365.25 * DAY;

export interface CurveStats {
  returnPct: number;
  cagr: number | null; // null when the test is shorter than six months
  maxDrawdown: number; // negative fraction, e.g. -0.32
  maxDrawdownDays: number; // longest time spent below a previous high
  sharpe: number;
  sortino: number;
  ulcer: number; // root-mean-square drawdown, in percent
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
  payoff: number; // average win / average loss
  best: number;
  worst: number;
  avgBars: number;
  exposure: number;
  fees: number;
  slippage: number;
  expectancy: number;
  avgR: number | null;
  maxLosingStreak: number;
  longs: { trades: number; winRate: number; pnl: number };
  shorts: { trades: number; winRate: number; pnl: number };
  exits: Partial<Record<ExitReason, { count: number; pnl: number }>>;
  benchmarkReturn: number;
  benchmarkDrawdown: number;
}

/** Fraction below the running high at each point (0 at a new high, -0.25 when 25% down). `start` is the capital before the first bar. */
export function drawdowns(equity: readonly number[], start: number): number[] {
  let peak = start;
  return equity.map((v) => {
    peak = Math.max(peak, v);
    return peak > 0 ? v / peak - 1 : 0;
  });
}

/** Return, CAGR, max drawdown, Sharpe and Sortino of an equity curve. `start` is the capital before the first bar. */
export function curveStats(equity: readonly number[], times: readonly number[], granularity: number, start: number): CurveStats {
  const final = equity[equity.length - 1];
  const years = Math.max((times[times.length - 1] - times[0] + granularity) / YEAR, 1e-9);
  const rets: number[] = [];
  let prev = start;
  for (const v of equity) {
    rets.push(prev > 0 ? v / prev - 1 : 0);
    prev = v;
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1));
  const downside = Math.sqrt(rets.reduce((a, r) => a + Math.min(r, 0) ** 2, 0) / Math.max(1, rets.length - 1));
  // Annualize by how many bars this market actually prints in a year (stocks skip nights and weekends).
  const perYear = Math.sqrt(Math.max(1, equity.length / years));

  let peak = start;
  let peakTime = times[0];
  let maxDrawdown = 0;
  let maxDrawdownDays = 0;
  let sq = 0;
  equity.forEach((v, i) => {
    const closeTime = times[i] + granularity;
    if (v >= peak) {
      peak = v;
      peakTime = closeTime;
    } else {
      const dd = v / peak - 1;
      maxDrawdown = Math.min(maxDrawdown, dd);
      maxDrawdownDays = Math.max(maxDrawdownDays, (closeTime - peakTime) / DAY);
      sq += (dd * 100) ** 2;
    }
  });

  return {
    returnPct: final / start - 1,
    cagr: years < 0.5 ? null : final > 0 ? (final / start) ** (1 / years) - 1 : -1,
    maxDrawdown,
    maxDrawdownDays: Math.round(maxDrawdownDays),
    sharpe: sd > 0 ? (mean / sd) * perYear : 0,
    sortino: downside > 0 ? (mean / downside) * perYear : 0,
    ulcer: Math.sqrt(sq / Math.max(1, equity.length)),
  };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function tradeStats(trades: readonly Trade[]) {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = -losses.reduce((a, t) => a + t.pnl, 0);
  const avgWin = avg(wins.map((t) => t.pnlPct));
  const avgLoss = avg(losses.map((t) => t.pnlPct));
  let streak = 0;
  let maxLosingStreak = 0;
  for (const t of trades) {
    streak = t.pnl <= 0 ? streak + 1 : 0;
    maxLosingStreak = Math.max(maxLosingStreak, streak);
  }
  const rs = trades.map((t) => t.r).filter((r): r is number => r !== null);
  const side = (s: 'long' | 'short') => {
    const ts = trades.filter((t) => t.side === s);
    return { trades: ts.length, winRate: ts.length ? ts.filter((t) => t.pnl > 0).length / ts.length : 0, pnl: ts.reduce((a, t) => a + t.pnl, 0) };
  };
  const exits: Stats['exits'] = {};
  for (const t of trades) {
    for (const f of t.fills) {
      const share = t.fills.length > 1 ? (f.qty / t.fills.reduce((a, x) => a + x.qty, 0)) * t.pnl : t.pnl;
      const e = (exits[f.reason] ??= { count: 0, pnl: 0 });
      e.count++;
      e.pnl += share;
    }
  }
  return {
    trades: trades.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    avgTrade: avg(trades.map((t) => t.pnlPct)),
    avgWin,
    avgLoss,
    payoff: avgLoss < 0 ? avgWin / -avgLoss : avgWin > 0 ? Infinity : 0,
    best: trades.length ? Math.max(...trades.map((t) => t.pnlPct)) : 0,
    worst: trades.length ? Math.min(...trades.map((t) => t.pnlPct)) : 0,
    avgBars: avg(trades.map((t) => t.bars)),
    expectancy: avg(trades.map((t) => t.pnl)),
    avgR: rs.length ? avg(rs) : null,
    maxLosingStreak,
    longs: side('long'),
    shorts: side('short'),
    exits,
  };
}

export function computeStats(bt: Backtest, candles: readonly Candle[], granularity: number, capital: number): Stats {
  const times = candles.slice(bt.start, bt.end + 1).map((c) => c.time);
  const curve = curveStats(bt.equity, times, granularity, capital);
  const bench = curveStats(bt.benchmark, times, granularity, capital);
  return {
    ...curve,
    ...tradeStats(bt.trades),
    netProfit: bt.equity[bt.equity.length - 1] - capital,
    calmar: curve.cagr !== null && curve.maxDrawdown < 0 ? curve.cagr / -curve.maxDrawdown : null,
    exposure: bt.position.filter((p) => p !== 0).length / bt.position.length,
    fees: bt.fees,
    slippage: bt.slippage,
    benchmarkReturn: bench.returnPct,
    benchmarkDrawdown: bench.maxDrawdown,
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
  let before = capital;
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

/** A single score used to rank strategies (and to optimize): return over drawdown with a penalty for few trades. */
export type Objective = 'return' | 'cagr' | 'sharpe' | 'calmar' | 'profitFactor' | 'returnOverDD';
export const OBJECTIVES: { id: Objective; label: string }[] = [
  { id: 'returnOverDD', label: 'Return / max drawdown' },
  { id: 'return', label: 'Net return' },
  { id: 'sharpe', label: 'Sharpe ratio' },
  { id: 'calmar', label: 'Calmar ratio' },
  { id: 'profitFactor', label: 'Profit factor' },
];

export function score(st: Pick<Stats, 'returnPct' | 'maxDrawdown' | 'sharpe' | 'calmar' | 'profitFactor' | 'trades' | 'cagr'>, objective: Objective): number {
  if (st.trades === 0) return -Infinity;
  switch (objective) {
    case 'return':
      return st.returnPct;
    case 'cagr':
      return st.cagr ?? st.returnPct;
    case 'sharpe':
      return st.sharpe;
    case 'calmar':
      return st.calmar ?? -Infinity;
    case 'profitFactor':
      return Number.isFinite(st.profitFactor) ? st.profitFactor : 100;
    case 'returnOverDD':
      return st.returnPct / Math.max(0.01, -st.maxDrawdown);
  }
}
