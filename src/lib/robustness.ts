// The robustness lab: parameter grids, walk-forward testing, Monte Carlo trade shuffles and an overfitting grade.
import type { Inputs } from './catalog';
import { runBacktest, type Backtest } from './engine';
import { computeStats, score, type Objective, type Stats } from './metrics';
import { applyValues, evaluate, ruleCount, type Signals, type Strategy, type Tunable } from './rules';
import type { Candle } from './types';

export interface Ctx {
  candles: Candle[];
  inputs: Inputs;
  granularity: number;
}

export interface Axis {
  tunable: Tunable;
  values: number[];
}

export function axisValues(min: number, max: number, steps: number, step: number): number[] {
  if (steps <= 1 || max <= min) return [min];
  const out = new Set<number>();
  for (let k = 0; k < steps; k++) {
    const raw = min + ((max - min) * k) / (steps - 1);
    const snapped = Math.round(raw / step) * step;
    out.add(+snapped.toFixed(6));
  }
  return [...out].sort((a, b) => a - b);
}

/** Runs one strategy over bars start..end. Signals can be passed in when they were computed already. */
export function runRange(ctx: Ctx, s: Strategy, start: number, end: number, sig?: Signals): { bt: Backtest; stats: Stats; sig: Signals } {
  const signals = sig ?? evaluate(s, ctx.inputs);
  const from = Math.min(Math.max(start, signals.warmup), end);
  const bt = runBacktest(ctx.candles, signals, s, { start: from, end });
  return { bt, stats: computeStats(bt, ctx.candles, ctx.granularity, s.costs.capital), sig: signals };
}

// ---------------------------------------------------------------------------------------------------------------
// Grid (stability map)

export interface Cell {
  values: number[];
  score: number;
  returnPct: number;
  maxDrawdown: number;
  trades: number;
  sharpe: number;
  holdout?: { returnPct: number; maxDrawdown: number; trades: number };
}

export interface GridResult {
  axes: { label: string; values: number[] }[];
  cells: Cell[];
  best: Cell;
  current: Cell;
  stability: number; // average neighbour score / best score (1 = flat plateau, near 0 = lonely spike)
  profitable: number; // share of cells that made money
  splitTime: number | null; // when the held-back test starts
}

export function combos(axes: Axis[]): number[][] {
  let out: number[][] = [[]];
  for (const a of axes) out = out.flatMap((c) => a.values.map((v) => [...c, v]));
  return out;
}

export function grid(ctx: Ctx, s: Strategy, axes: Axis[], start: number, end: number, objective: Objective, holdoutPct: number, progress?: (f: number) => void): GridResult {
  const tun = axes.map((a) => a.tunable);
  const split = holdoutPct > 0 ? Math.floor(start + (end - start) * (1 - holdoutPct / 100)) : end;
  const list = combos(axes);
  const cells: Cell[] = [];
  list.forEach((vals, k) => {
    const strat = applyValues(s, tun, vals);
    const sig = evaluate(strat, ctx.inputs);
    const ins = runRange(ctx, strat, start, split, sig).stats;
    const cell: Cell = { values: vals, score: score(ins, objective), returnPct: ins.returnPct, maxDrawdown: ins.maxDrawdown, trades: ins.trades, sharpe: ins.sharpe };
    if (holdoutPct > 0 && split < end) {
      const oos = runRange(ctx, strat, split + 1, end, sig).stats;
      cell.holdout = { returnPct: oos.returnPct, maxDrawdown: oos.maxDrawdown, trades: oos.trades };
    }
    cells.push(cell);
    if (progress && k % 5 === 0) progress(k / list.length);
  });
  const finite = cells.filter((c) => Number.isFinite(c.score));
  const best = finite.length ? finite.reduce((a, b) => (b.score > a.score ? b : a)) : cells[0];

  const cur = tun.map((t) => t.value);
  const curStrat = applyValues(s, tun, cur);
  const curSig = evaluate(curStrat, ctx.inputs);
  const ci = runRange(ctx, curStrat, start, split, curSig).stats;
  const current: Cell = { values: cur, score: score(ci, objective), returnPct: ci.returnPct, maxDrawdown: ci.maxDrawdown, trades: ci.trades, sharpe: ci.sharpe };
  if (holdoutPct > 0 && split < end) {
    const o = runRange(ctx, curStrat, split + 1, end, curSig).stats;
    current.holdout = { returnPct: o.returnPct, maxDrawdown: o.maxDrawdown, trades: o.trades };
  }

  // Stability: how good are the best cell's neighbours?
  const idx = (vals: number[]) => vals.map((v, d) => axes[d].values.indexOf(v));
  const bi = idx(best.values);
  const neigh = cells.filter((c) => {
    const ci2 = idx(c.values);
    const dist = ci2.reduce((a, x, d) => Math.max(a, Math.abs(x - bi[d])), 0);
    return dist === 1;
  });
  const ns = neigh.map((c) => (Number.isFinite(c.score) ? c.score : 0));
  const stability = best.score > 0 && ns.length ? Math.max(0, Math.min(1, ns.reduce((a, b) => a + b, 0) / ns.length / best.score)) : 0;

  return {
    axes: axes.map((a) => ({ label: a.tunable.label, values: a.values })),
    cells,
    best,
    current,
    stability,
    profitable: cells.filter((c) => c.returnPct > 0).length / Math.max(1, cells.length),
    splitTime: holdoutPct > 0 && split < end ? ctx.candles[split + 1].time : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Walk-forward

export interface WfWindow {
  isStart: number;
  isEnd: number;
  oosStart: number;
  oosEnd: number;
  chosen: number[];
  isReturn: number;
  oosReturn: number;
  oosDrawdown: number;
  oosTrades: number;
}
export interface WalkForward {
  windows: WfWindow[];
  equity: { time: number; value: number }[]; // stitched out-of-sample equity
  oosReturn: number;
  oosMaxDrawdown: number;
  efficiency: number | null; // annualised out-of-sample return / annualised in-sample return
  profitableWindows: number;
  labels: string[];
}

export function walkForward(
  ctx: Ctx,
  s: Strategy,
  axes: Axis[],
  start: number,
  end: number,
  windows: number,
  isRatio: number,
  anchored: boolean,
  objective: Objective,
  progress?: (f: number) => void,
): WalkForward {
  const tun = axes.map((a) => a.tunable);
  const list = combos(axes);
  // Signals don't depend on the window, so compute them once per parameter set.
  const sigs = list.map((vals) => {
    const strat = applyValues(s, tun, vals);
    return { strat, sig: evaluate(strat, ctx.inputs) };
  });
  const total = end - start + 1;
  const r = isRatio / (1 - isRatio);
  const oosLen = Math.max(5, Math.floor(total / (windows + r)));
  const isLen = Math.max(10, total - windows * oosLen);
  const out: WfWindow[] = [];
  const stitched: { time: number; value: number }[] = [];
  let value = s.costs.capital;
  let isAnnual = 0;
  let oosAnnual = 0;
  const yearOf = (a: number, b: number) => Math.max(1e-6, (ctx.candles[b].time - ctx.candles[a].time + ctx.granularity) / (365.25 * 86400));

  for (let w = 0; w < windows; w++) {
    const oosStart = start + isLen + w * oosLen;
    const oosEnd = w === windows - 1 ? end : Math.min(end, oosStart + oosLen - 1);
    if (oosStart > end) break;
    const isStart = anchored ? start : oosStart - isLen;
    const isEnd = oosStart - 1;
    let bestK = 0;
    let bestScore = -Infinity;
    let bestReturn = 0;
    sigs.forEach(({ strat, sig }, k) => {
      const st = runRange(ctx, strat, isStart, isEnd, sig).stats;
      const sc = st.trades >= 3 ? score(st, objective) : -Infinity;
      if (sc > bestScore) {
        bestScore = sc;
        bestK = k;
        bestReturn = st.returnPct;
      }
    });
    const pick = sigs[bestK];
    const { bt, stats } = runRange(ctx, pick.strat, oosStart, oosEnd, pick.sig);
    const base = value;
    bt.equity.forEach((v, i) => stitched.push({ time: ctx.candles[bt.start + i].time, value: (base * v) / pick.strat.costs.capital }));
    value = (base * bt.equity[bt.equity.length - 1]) / pick.strat.costs.capital;
    isAnnual += (1 + bestReturn) ** (1 / yearOf(isStart, isEnd)) - 1;
    oosAnnual += (1 + stats.returnPct) ** (1 / yearOf(oosStart, oosEnd)) - 1;
    out.push({ isStart, isEnd, oosStart, oosEnd, chosen: list[bestK], isReturn: bestReturn, oosReturn: stats.returnPct, oosDrawdown: stats.maxDrawdown, oosTrades: stats.trades });
    progress?.((w + 1) / windows);
  }
  let peak = s.costs.capital;
  let mdd = 0;
  for (const p of stitched) {
    peak = Math.max(peak, p.value);
    mdd = Math.min(mdd, p.value / peak - 1);
  }
  const n = Math.max(1, out.length);
  return {
    windows: out,
    equity: stitched,
    oosReturn: value / s.costs.capital - 1,
    oosMaxDrawdown: mdd,
    efficiency: isAnnual / n > 0 ? oosAnnual / n / (isAnnual / n) : null,
    profitableWindows: out.filter((w) => w.oosReturn > 0).length / n,
    labels: tun.map((t) => t.label),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Monte Carlo

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MonteCarlo {
  runs: number;
  method: 'shuffle' | 'bootstrap';
  finals: number[]; // sorted final returns
  drawdowns: number[]; // sorted max drawdowns (negative)
  probLoss: number;
  probRuin: number; // chance of a 50% drawdown
  bands: { p5: number[]; p50: number[]; p95: number[] }; // equity (1 = start) after each trade
  samples: number[][];
  original: { final: number; drawdown: number };
}

export const percentile = (sorted: number[], p: number) => {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, (p / 100) * (sorted.length - 1)));
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

export function monteCarlo(returns: number[], runs = 2000, method: 'shuffle' | 'bootstrap' = 'bootstrap', seed = 7): MonteCarlo {
  const n = returns.length;
  const rand = rng(seed);
  const finals: number[] = [];
  const dds: number[] = [];
  const paths: number[][] = [];
  const keep = 60;
  const atStep: number[][] = Array.from({ length: n + 1 }, () => []);
  const path = (seq: number[]) => {
    let eq = 1;
    let peak = 1;
    let dd = 0;
    const p = [1];
    for (const r of seq) {
      eq *= 1 + r;
      if (eq < 0) eq = 0;
      peak = Math.max(peak, eq);
      dd = Math.min(dd, peak > 0 ? eq / peak - 1 : -1);
      p.push(eq);
    }
    return { eq, dd, p };
  };
  const orig = path(returns);
  for (let k = 0; k < runs; k++) {
    let seq: number[];
    if (method === 'shuffle') {
      seq = returns.slice();
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [seq[i], seq[j]] = [seq[j], seq[i]];
      }
    } else seq = Array.from({ length: n }, () => returns[Math.floor(rand() * n)]);
    const { eq, dd, p } = path(seq);
    finals.push(eq - 1);
    dds.push(dd);
    p.forEach((v, i) => atStep[i].push(v));
    if (paths.length < keep) paths.push(p);
  }
  finals.sort((a, b) => a - b);
  dds.sort((a, b) => a - b);
  const sorted = atStep.map((xs) => xs.sort((a, b) => a - b));
  return {
    runs,
    method,
    finals,
    drawdowns: dds,
    probLoss: finals.filter((f) => f < 0).length / Math.max(1, runs),
    probRuin: dds.filter((d) => d <= -0.5).length / Math.max(1, runs),
    bands: { p5: sorted.map((xs) => percentile(xs, 5)), p50: sorted.map((xs) => percentile(xs, 50)), p95: sorted.map((xs) => percentile(xs, 95)) },
    samples: paths,
    original: { final: orig.eq - 1, drawdown: orig.dd },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Overfitting grade

export interface Grade {
  score: number; // 0..100
  letter: 'A' | 'B' | 'C' | 'D' | 'F';
  checks: { label: string; detail: string; points: number; max: number; ok: 'good' | 'fair' | 'poor' | 'skip' }[];
}

export function grade(input: { stats: Stats; strategy: Strategy; tunableCount: number; wf?: WalkForward | null; mc?: MonteCarlo | null; grid?: GridResult | null }): Grade {
  const { stats, wf, mc, grid: g } = input;
  const checks: Grade['checks'] = [];
  const add = (label: string, detail: string, points: number, max: number) =>
    checks.push({ label, detail, points, max, ok: points >= max * 0.75 ? 'good' : points >= max * 0.4 ? 'fair' : 'poor' });
  const skip = (label: string, detail: string, max: number) => checks.push({ label, detail, points: 0, max, ok: 'skip' });

  const t = stats.trades;
  add('Sample size', `${t} trades`, t >= 100 ? 15 : t >= 50 ? 12 : t >= 30 ? 8 : t >= 15 ? 4 : 0, 15);

  const edge = stats.returnPct > 0 && stats.sharpe >= 1 ? 10 : stats.returnPct > 0 && stats.sharpe >= 0.5 ? 7 : stats.returnPct > 0 ? 4 : 0;
  add('Edge', `Sharpe ${stats.sharpe.toFixed(2)}, ${stats.returnPct >= stats.benchmarkReturn ? 'beats' : 'trails'} buy & hold`, edge, 10);

  if (wf) {
    const e = wf.efficiency ?? 0;
    const pts = (e >= 0.6 ? 18 : e >= 0.4 ? 13 : e >= 0.2 ? 8 : e > 0 ? 4 : 0) + Math.round(wf.profitableWindows * 7);
    add('Walk-forward', `${Math.round(wf.profitableWindows * 100)}% of unseen windows profitable, efficiency ${wf.efficiency === null ? 'n/a' : `${Math.round(e * 100)}%`}`, pts, 25);
  } else skip('Walk-forward', 'Run a walk-forward test to score this', 25);

  if (mc) {
    const p = mc.probLoss;
    add('Monte Carlo', `${(p * 100).toFixed(1)}% chance of losing money, ${(mc.probRuin * 100).toFixed(1)}% chance of a 50% drawdown`, p <= 0.05 ? 20 : p <= 0.15 ? 14 : p <= 0.3 ? 8 : 0, 20);
  } else skip('Monte Carlo', 'Run Monte Carlo to score this', 20);

  if (g) {
    const sv = g.stability;
    add('Parameter stability', `Neighbours keep ${Math.round(sv * 100)}% of the best score; ${Math.round(g.profitable * 100)}% of settings profitable`, sv >= 0.8 ? 20 : sv >= 0.6 ? 14 : sv >= 0.4 ? 8 : 2, 20);
  } else skip('Parameter stability', 'Run the stability map to score this', 20);

  const k = input.tunableCount + ruleCount(input.strategy) / 2;
  add('Simplicity', `${input.tunableCount} tunable numbers, ${ruleCount(input.strategy)} rules`, k <= 4 ? 10 : k <= 7 ? 7 : k <= 11 ? 4 : 1, 10);

  const max = checks.filter((c) => c.ok !== 'skip').reduce((a, c) => a + c.max, 0);
  const got = checks.reduce((a, c) => a + c.points, 0);
  const sc = max ? Math.round((100 * got) / max) : 0;
  const letter = sc >= 85 ? 'A' : sc >= 70 ? 'B' : sc >= 55 ? 'C' : sc >= 40 ? 'D' : 'F';
  return { score: sc, letter, checks };
}
