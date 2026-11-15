import { runBacktest } from './engine';
import { curveStats, tradeStats } from './metrics';
import { strategyById, type ParamDef, type Signals } from './strategies';
import type { Candle, Params, Settings } from './types';

export interface Metrics {
  returnPct: number;
  sharpe: number;
  maxDrawdown: number;
  trades: number;
  winRate: number;
  profitFactor: number;
}

export interface Cell {
  x: number;
  y: number;
  valid: boolean;
  train: Metrics; // the period the grid is fitted on
  test: Metrics | null; // the held-out period, when there is one
}

export interface OptimizeRequest {
  candles: Candle[];
  strategyId: string;
  params: Params;
  xKey: string;
  yKey: string;
  settings: Settings;
  start: number;
  end: number;
  granularity: number;
  holdout: number; // share of the range kept back for testing, 0 = none
}

export interface Grid {
  xKey: string;
  yKey: string;
  xs: number[];
  ys: number[];
  cells: Cell[]; // row by row: every x for ys[0], then ys[1], …
  splitIndex: number | null; // last candle of the fitting period
  ms: number;
}

const round = (v: number) => Number(v.toFixed(4));

/** The values tried for one parameter: its whole range thinned out to at most `limit` steps, plus the current value. */
export function axisValues(def: ParamDef, limit = 14, current?: number): number[] {
  const count = Math.floor((def.max - def.min) / def.step + 1e-9) + 1;
  const stride = Math.ceil(count / limit);
  const out: number[] = [];
  for (let k = 0; k < count; k += stride) out.push(round(def.min + k * def.step));
  if (out[out.length - 1] !== def.max) out.push(def.max);
  if (current !== undefined && current >= def.min && current <= def.max && !out.includes(current)) out.push(current);
  return out.sort((a, b) => a - b);
}

export function evaluate(
  candles: readonly Candle[],
  signals: Signals,
  settings: Settings,
  start: number,
  end: number,
  granularity: number,
): Metrics {
  const bt = runBacktest(candles, signals, settings, start, end);
  const times = candles.slice(start, end + 1).map((c) => c.time);
  const curve = curveStats(bt.equity, times, granularity, settings.capital);
  const t = tradeStats(bt.trades);
  return {
    returnPct: curve.returnPct,
    sharpe: curve.sharpe,
    maxDrawdown: curve.maxDrawdown,
    trades: t.trades,
    winRate: t.winRate,
    profitFactor: t.profitFactor,
  };
}

const EMPTY: Metrics = { returnPct: 0, sharpe: 0, maxDrawdown: 0, trades: 0, winRate: 0, profitFactor: 0 };

/** Backtests every combination of two parameters (the others stay as they are). */
export function optimize(req: OptimizeRequest): Grid {
  const t0 = performance.now();
  const strategy = strategyById(req.strategyId);
  const xDef = strategy.params.find((p) => p.key === req.xKey)!;
  const yDef = strategy.params.find((p) => p.key === req.yKey)!;
  const xs = axisValues(xDef, 14, req.params[req.xKey]);
  const ys = axisValues(yDef, 14, req.params[req.yKey]);
  const splitIndex = req.holdout > 0 ? req.start + Math.floor((req.end - req.start) * (1 - req.holdout)) : null;
  const cells: Cell[] = [];
  for (const y of ys) {
    for (const x of xs) {
      const params = { ...req.params, [req.xKey]: x, [req.yKey]: y };
      if (strategy.check?.(params)) {
        cells.push({ x, y, valid: false, train: EMPTY, test: null });
        continue;
      }
      const signals = strategy.signals(req.candles, params);
      const fitEnd = splitIndex ?? req.end;
      cells.push({
        x,
        y,
        valid: true,
        train: evaluate(req.candles, signals, req.settings, req.start, fitEnd, req.granularity),
        test: splitIndex === null ? null : evaluate(req.candles, signals, req.settings, splitIndex + 1, req.end, req.granularity),
      });
    }
  }
  return { xKey: req.xKey, yKey: req.yKey, xs, ys, cells, splitIndex, ms: performance.now() - t0 };
}
