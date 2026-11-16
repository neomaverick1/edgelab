import { Check, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';

import { OBJECTIVES, type Objective } from '../lib/metrics';
import { axisValues, type GridResult } from '../lib/robustness';
import { applyValues, tunables, type Strategy } from '../lib/rules';
import { GridView } from '../views/RobustnessView';
import { defaultAxis, type AxisCfg } from './axes';
import type { RunResult } from './Results';
import { toast } from './toast';
import { NumberInput } from './ui';
import { useLab } from './useLab';

/** Tries every combination of two numbers in the strategy and applies the best one with a click. */
export function Optimizer({ strategy, run, onApply }: { strategy: Strategy; run: RunResult; onApply: (s: Strategy) => void }) {
  const tun = useMemo(() => tunables(strategy), [strategy]);
  const [axes, setAxes] = useState<AxisCfg[]>(() => tun.slice(0, 2).map(defaultAxis));
  const [objective, setObjective] = useState<Objective>('returnOverDD');
  const [holdout, setHoldout] = useState(30);
  const [res, setRes] = useState<GridResult | null>(null);
  const [colorBy, setColorBy] = useState<'score' | 'holdout'>('score');
  const lab = useLab();

  const live = axes.filter((a) => tun.some((t) => t.id === a.id));
  const axisObjs = live.map((a) => {
    const t = tun.find((x) => x.id === a.id)!;
    return { tunable: t, values: axisValues(a.min, a.max, a.steps, t.step) };
  });
  const combos = axisObjs.reduce((n, a) => n * a.values.length, 1);
  const apply = (vals: number[], label: string) => {
    onApply(applyValues(strategy, axisObjs.map((a) => a.tunable), vals));
    toast(label);
  };

  const optimize = async () => {
    if (!axisObjs.length) return;
    try {
      setRes(await lab.run<GridResult>({ task: 'grid', candles: run.candles, granularity: run.granularity, strategy, start: run.bt.start, end: run.bt.end, objective, axes: axisObjs, holdoutPct: holdout }));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The optimizer failed.');
    }
  };

  if (!tun.length) return <p className="muted">Add rules with indicators or turn on a stop to get numbers to optimize.</p>;
  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr)' }}>
      {[0, 1].map((k) => {
        const a = live[k];
        return (
          <div className="cfg" key={k}>
            <select
              className="select"
              style={{ minWidth: 200, flex: '1 1 200px' }}
              aria-label={`Number ${k + 1} to optimize`}
              value={a?.id ?? ''}
              onChange={(e) => {
                const t = tun.find((x) => x.id === e.target.value);
                const next = live.slice();
                if (t) next[k] = defaultAxis(t);
                else next.splice(k, 1);
                setAxes(next);
                setRes(null);
              }}
            >
              {k === 1 ? <option value="">Only one number</option> : null}
              {tun.map((t) => (
                <option key={t.id} value={t.id} disabled={live.some((x, j) => j !== k && x.id === t.id)}>
                  {t.label} (now {t.value})
                </option>
              ))}
            </select>
            {a ? (
              <>
                <div className="field">
                  <span className="label">from</span>
                  <NumberInput label="From" value={a.min} onChange={(v) => setAxes(live.map((x, j) => (j === k ? { ...x, min: v } : x)))} />
                </div>
                <div className="field">
                  <span className="label">to</span>
                  <NumberInput label="To" value={a.max} onChange={(v) => setAxes(live.map((x, j) => (j === k ? { ...x, max: v } : x)))} />
                </div>
                <div className="field">
                  <span className="label">steps</span>
                  <NumberInput label="Steps" value={a.steps} min={2} max={25} width={56} onChange={(v) => setAxes(live.map((x, j) => (j === k ? { ...x, steps: v } : x)))} />
                </div>
              </>
            ) : null}
          </div>
        );
      })}
      <div className="cfg">
        <div className="field">
          <span className="label">Best by</span>
          <select className="select" value={objective} onChange={(e) => setObjective(e.target.value as Objective)}>
            {OBJECTIVES.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="label">Hold back</span>
          <NumberInput label="Holdout percent" value={holdout} min={0} max={60} step={5} width={56} onChange={setHoldout} />
          <span className="unit">%</span>
        </div>
      </div>
      <div className="cfg">
        <button className="btn gold" onClick={optimize} disabled={lab.busy}>
          <Sparkles /> Optimize {combos} settings
        </button>
        {res ? (
          <button className="btn primary" onClick={() => apply(res.best.values, 'Best settings applied')}>
            <Check /> Use best settings
          </button>
        ) : null}
      </div>
      {lab.busy ? (
        <div className="progress">
          <i style={{ width: `${Math.round((lab.progress ?? 0) * 100)}%` }} />
        </div>
      ) : null}
      {res ? (
        <GridView g={res} colorBy={colorBy} setColorBy={setColorBy} onApply={(vals) => apply(vals, 'Settings applied')} />
      ) : (
        <p className="muted">
          Tests every combination on the first {100 - holdout}% of the period{holdout ? `, then checks the best one on the last ${holdout}% it never saw` : ''}.
        </p>
      )}
    </div>
  );
}
