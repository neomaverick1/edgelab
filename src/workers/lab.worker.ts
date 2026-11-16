// Heavy robustness work runs here so the page stays smooth.
import { inputsOf } from '../lib/catalog';
import type { Objective } from '../lib/metrics';
import { grid, monteCarlo, walkForward, type Axis } from '../lib/robustness';
import type { Strategy } from '../lib/rules';
import type { Candle } from '../lib/types';

export type LabRequest =
  | { id: number; task: 'grid'; candles: Candle[]; granularity: number; strategy: Strategy; axes: Axis[]; start: number; end: number; objective: Objective; holdoutPct: number }
  | { id: number; task: 'walkforward'; candles: Candle[]; granularity: number; strategy: Strategy; axes: Axis[]; start: number; end: number; objective: Objective; windows: number; isRatio: number; anchored: boolean }
  | { id: number; task: 'montecarlo'; returns: number[]; runs: number; method: 'shuffle' | 'bootstrap' };

self.onmessage = (ev: MessageEvent<LabRequest>) => {
  const r = ev.data;
  const progress = (f: number) => self.postMessage({ id: r.id, progress: f });
  try {
    if (r.task === 'montecarlo') {
      self.postMessage({ id: r.id, result: monteCarlo(r.returns, r.runs, r.method) });
      return;
    }
    const ctx = { candles: r.candles, inputs: inputsOf(r.candles), granularity: r.granularity };
    const result =
      r.task === 'grid'
        ? grid(ctx, r.strategy, r.axes, r.start, r.end, r.objective, r.holdoutPct, progress)
        : walkForward(ctx, r.strategy, r.axes, r.start, r.end, r.windows, r.isRatio, r.anchored, r.objective, progress);
    self.postMessage({ id: r.id, result });
  } catch (e) {
    self.postMessage({ id: r.id, error: e instanceof Error ? e.message : String(e) });
  }
};
