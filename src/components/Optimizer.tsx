import { useEffect, useRef, useState } from 'react';

import { pct, ratio } from '../lib/format';
import type { Cell, Grid, Metrics, OptimizeRequest } from '../lib/optimizer';
import type { Strategy } from '../lib/strategies';
import type { Candle, Params, Settings } from '../lib/types';
import { Segmented } from './ui';

type MetricKey = 'sharpe' | 'returnPct' | 'maxDrawdown' | 'profitFactor' | 'winRate';

const BEST: Record<MetricKey, string> = {
  sharpe: 'Best Sharpe ratio',
  returnPct: 'Best return',
  maxDrawdown: 'Smallest drawdown',
  profitFactor: 'Best profit factor',
  winRate: 'Best win rate',
};

const METRICS: { id: MetricKey; label: string }[] = [
  { id: 'sharpe', label: 'Sharpe' },
  { id: 'returnPct', label: 'Return' },
  { id: 'maxDrawdown', label: 'Max drawdown' },
  { id: 'profitFactor', label: 'Profit factor' },
  { id: 'winRate', label: 'Win rate' },
];

const show = (key: MetricKey, v: number) => {
  if (key === 'sharpe') return ratio(v);
  if (key === 'profitFactor') return ratio(v);
  if (key === 'returnPct' && Math.abs(v) >= 10) return `${v > 0 ? '+' : '−'}${((Math.abs(v) * 100) / 1000).toFixed(1)}k%`;
  return pct(v, { sign: key === 'returnPct', digits: 0 });
};

/** Comparable score where higher is better, and the value that counts as neutral. */
function score(key: MetricKey, m: Metrics): number {
  if (key === 'profitFactor') return m.trades ? Math.log(Math.min(m.profitFactor === Infinity ? 20 : m.profitFactor, 20) || 0.05) : 0;
  if (key === 'winRate') return m.trades ? m.winRate - 0.5 : 0;
  return m[key];
}

function colorFor(key: MetricKey, value: number, lo: number, hi: number): string {
  if (key === 'maxDrawdown') {
    const t = hi > lo ? (value - lo) / (hi - lo) : 1; // 1 = shallowest drawdown
    const r = Math.round(242 + (43 - 242) * t);
    const g = Math.round(85 + (212 - 85) * t);
    const b = Math.round(90 + (138 - 90) * t);
    return `rgba(${r}, ${g}, ${b}, 0.55)`;
  }
  const span = value >= 0 ? hi : -lo;
  const a = span > 0 ? 0.08 + (Math.abs(value) / span) * 0.62 : 0.08;
  return value >= 0 ? `rgba(43, 212, 138, ${a})` : `rgba(242, 85, 90, ${a})`;
}

interface Props {
  candles: Candle[];
  strategy: Strategy;
  params: Params;
  settings: Settings;
  start: number;
  end: number;
  granularity: number;
  onApply: (p: Params) => void;
}

export function Optimizer({ candles, strategy, params, settings, start, end, granularity, onApply }: Props) {
  const keys = strategy.params.map((p) => p.key);
  const [axes, setAxes] = useState({ strategy: strategy.id, x: keys[0], y: keys[1] });
  const x = axes.strategy === strategy.id ? axes.x : keys[0];
  const y = axes.strategy === strategy.id ? axes.y : keys[1];
  const [metric, setMetric] = useState<MetricKey>('sharpe');
  const [holdout, setHoldout] = useState(true);
  const [view, setView] = useState<'train' | 'test'>('train');
  const [result, setResult] = useState<{ grid: Grid; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const w = new Worker(new URL('../workers/optimize.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    return () => w.terminate();
  }, []);

  const lastTime = candles[candles.length - 1]?.time;
  const key = JSON.stringify([strategy.id, x, y, params, settings, start, end, candles.length, lastTime, holdout]);

  // Re-runs the grid (in the worker) shortly after any input settles.
  useEffect(() => {
    const w = worker.current;
    if (!w || x === y) return;
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      const req: OptimizeRequest = {
        candles,
        strategyId: strategy.id,
        params,
        xKey: x,
        yKey: y,
        settings,
        start,
        end,
        granularity,
        holdout: holdout ? 0.3 : 0,
      };
      w.onmessage = (e: MessageEvent<{ id: number; grid?: Grid; error?: string }>) => {
        if (e.data.id !== requestId.current) return;
        if (e.data.grid) setResult({ grid: e.data.grid, key });
        setError(e.data.error ?? null);
      };
      w.postMessage({ id, req });
    }, 250);
    return () => clearTimeout(timer);
  }, [key, candles, strategy.id, params, x, y, settings, start, end, granularity, holdout]);

  const grid = result?.grid ?? null;
  const running = !result || result.key !== key;
  const side: 'train' | 'test' = holdout && view === 'test' ? 'test' : 'train';
  const metricsOf = (c: Cell) => (side === 'test' ? c.test : c.train) ?? c.train;

  let summary: { lo: number; hi: number; best: Cell | null; current: Cell | null } | null = null;
  if (grid) {
    const valid = grid.cells.filter((c) => c.valid && c.train.trades > 0);
    const values = valid.map((c) => score(metric, metricsOf(c)));
    const best = valid.reduce<Cell | null>((b, c) => (!b || score(metric, c.train) > score(metric, b.train) ? c : b), null);
    const current = grid.cells.find((c) => c.x === params[x] && c.y === params[y]) ?? null;
    summary = { lo: Math.min(0, ...values), hi: Math.max(0, ...values), best, current };
  }

  const xDef = strategy.params.find((p) => p.key === x)!;
  const yDef = strategy.params.find((p) => p.key === y)!;
  const others = strategy.params.filter((p) => p.key !== x && p.key !== y);

  return (
    <>
      <div className="toolbar">
        {keys.length > 2 ? (
          <>
            <label className="muted" htmlFor="opt-x">
              Across
            </label>
            <select
              id="opt-x"
              className="select"
              value={x}
              onChange={(e) => setAxes({ strategy: strategy.id, x: e.target.value, y: e.target.value === y ? x : y })}
            >
              {strategy.params.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
            <label className="muted" htmlFor="opt-y">
              Down
            </label>
            <select
              id="opt-y"
              className="select"
              value={y}
              onChange={(e) => setAxes({ strategy: strategy.id, y: e.target.value, x: e.target.value === x ? y : x })}
            >
              {strategy.params.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <Segmented label="Colour by" small value={metric} options={METRICS} onChange={setMetric} />
        <span className="spacer" />
        <label className="toggle">
          <input type="checkbox" checked={holdout} onChange={(e) => setHoldout(e.target.checked)} /> Hold back the last 30% for testing
        </label>
      </div>

      {error ? <div className="warning">The optimizer stopped: {error}</div> : null}
      {!grid ? (
        <div className="empty">
          <div className="spinner" />
          Testing every combination…
        </div>
      ) : (
        <div className="opt-layout">
          <div style={{ opacity: running ? 0.55 : 1, transition: 'opacity 0.2s' }}>
            {holdout ? (
              <div style={{ marginBottom: 10 }}>
                <Segmented
                  label="Period"
                  small
                  value={view}
                  onChange={setView}
                  options={[
                    { id: 'train', label: 'Fitting period (first 70%)' },
                    { id: 'test', label: 'Held-back period (last 30%)' },
                  ]}
                />
              </div>
            ) : null}
            <div className="heatmap-wrap">
              <div className="heatmap" style={{ gridTemplateColumns: `auto repeat(${grid.xs.length}, 46px)` }}>
                {grid.ys.map((yv) => (
                  <Row
                    key={yv}
                    yv={yv}
                    grid={grid}
                    metric={metric}
                    summary={summary}
                    metricsOf={metricsOf}
                    params={params}
                    x={x}
                    y={y}
                    xLabel={xDef.label}
                    yLabel={yDef.label}
                    onApply={onApply}
                  />
                ))}
                <span />
                {grid.xs.map((xv) => (
                  <span key={xv} className="axis">
                    {xv}
                  </span>
                ))}
              </div>
            </div>
            <p className="axis-title">
              Across: <b>{xDef.label}</b> · Down: <b>{yDef.label}</b>
              {others.length ? ` · ${others.map((o) => `${o.label} fixed at ${params[o.key]}`).join(', ')}` : ''} ·{' '}
              {grid.cells.filter((c) => c.valid).length} backtests in {Math.round(grid.ms)} ms
            </p>
          </div>

          <aside className="opt-side">
            {summary?.best ? (
              <div className="callout">
                <h4>
                  {BEST[metric]}
                  {holdout ? ' in the fitting period' : ''}
                </h4>
                <p>
                  {xDef.label} {summary.best.x}, {yDef.label} {summary.best.y}
                </p>
                <Compare cell={summary.best} holdout={holdout} />
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => onApply({ ...params, [x]: summary.best!.x, [y]: summary.best!.y })}
                >
                  Use these settings
                </button>
              </div>
            ) : null}
            {summary?.current?.valid ? (
              <div className="callout">
                <h4>Current settings</h4>
                <Compare cell={summary.current} holdout={holdout} />
              </div>
            ) : null}
            <div className="callout">
              <h4>Why hold data back?</h4>
              <p>
                The best cell on past data is partly luck. Settings that still hold up on the held-back period, which the grid never saw,
                are far more likely to keep working. Look for broad green areas rather than a single bright cell.
              </p>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

function Compare({ cell, holdout }: { cell: Cell; holdout: boolean }) {
  const rows: [string, (m: Metrics) => string][] = [
    ['Return', (m) => pct(m.returnPct, { sign: true })],
    ['Sharpe', (m) => ratio(m.sharpe)],
    ['Max drawdown', (m) => pct(m.maxDrawdown)],
    ['Trades', (m) => String(m.trades)],
  ];
  return (
    <div className="kv">
      <span />
      <span className="num muted">{holdout ? 'Fit' : 'Result'}</span>
      <span className="num muted">{holdout ? 'Held back' : ''}</span>
      {rows.map(([label, f]) => (
        <KvRow key={label} label={label} a={f(cell.train)} b={holdout && cell.test ? f(cell.test) : ''} />
      ))}
    </div>
  );
}

function KvRow({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <>
      <span>{label}</span>
      <span className="num">{a}</span>
      <span className="num">{b}</span>
    </>
  );
}

function Row({
  yv,
  grid,
  metric,
  summary,
  metricsOf,
  params,
  x,
  y,
  xLabel,
  yLabel,
  onApply,
}: {
  yv: number;
  grid: Grid;
  metric: MetricKey;
  summary: { lo: number; hi: number } | null;
  metricsOf: (c: Cell) => Metrics;
  params: Params;
  x: string;
  y: string;
  xLabel: string;
  yLabel: string;
  onApply: (p: Params) => void;
}) {
  return (
    <>
      <span className="axis y">{yv}</span>
      {grid.xs.map((xv) => {
        const cell = grid.cells.find((c) => c.x === xv && c.y === yv)!;
        if (!cell.valid) return <span key={xv} className="cell void" title="Not a valid combination" />;
        const m = metricsOf(cell);
        const current = params[x] === xv && params[y] === yv;
        const empty = m.trades === 0;
        return (
          <button
            type="button"
            key={xv}
            className={`cell${current ? ' current' : ''}`}
            style={{ background: empty ? 'var(--panel-2)' : colorFor(metric, score(metric, m), summary?.lo ?? 0, summary?.hi ?? 0) }}
            title={`${xLabel} ${xv}, ${yLabel} ${yv}\nReturn ${pct(m.returnPct, { sign: true })} · Sharpe ${ratio(m.sharpe)} · Max drawdown ${pct(m.maxDrawdown)} · ${m.trades} trades\nClick to use these settings`}
            onClick={() => onApply({ ...params, [x]: xv, [y]: yv })}
          >
            {empty ? '·' : show(metric, m[metric])}
          </button>
        );
      })}
    </>
  );
}
