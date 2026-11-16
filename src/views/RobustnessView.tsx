import { CheckCircle2, CircleDashed, FlaskConical, Play, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';

import { LinesChart } from '../components/PriceChart';
import type { RunResult } from '../components/Results';
import { Panel, Seg, Toggle, NumberInput } from '../components/ui';
import { toast } from '../components/toast';
import { useLab } from '../components/useLab';
import { THEME } from '../components/charts';
import { date, pct, ratio } from '../lib/format';
import { OBJECTIVES, type Objective } from '../lib/metrics';
import { axisValues, grade, percentile, type GridResult, type MonteCarlo, type WalkForward } from '../lib/robustness';
import { applyValues, tunables, type Strategy } from '../lib/rules';
import { defaultAxis, type AxisCfg } from '../components/axes';

interface Props {
  strategy: Strategy;
  run: RunResult;
  onApply: (s: Strategy) => void;
}


export function RobustnessView({ strategy, run, onApply }: Props) {
  const tun = useMemo(() => tunables(strategy), [strategy]);
  const [axes, setAxes] = useState<AxisCfg[]>(() => tun.slice(0, 2).map(defaultAxis));
  const [objective, setObjective] = useState<Objective>('returnOverDD');
  const [holdout, setHoldout] = useState(30);
  const [windows, setWindows] = useState(6);
  const [isPct, setIsPct] = useState(70);
  const [anchored, setAnchored] = useState(false);
  const [mcRuns, setMcRuns] = useState(2000);
  const [mcMethod, setMcMethod] = useState<'bootstrap' | 'shuffle'>('bootstrap');
  const [gridRes, setGridRes] = useState<GridResult | null>(null);
  const [wf, setWf] = useState<WalkForward | null>(null);
  const [mc, setMc] = useState<MonteCarlo | null>(null);
  const [colorBy, setColorBy] = useState<'score' | 'holdout'>('score');
  const lab = useLab();

  // Keep axes valid when the strategy changes shape.
  const live = axes.filter((a) => tun.some((t) => t.id === a.id));
  const axisObjs = live.map((a) => {
    const t = tun.find((x) => x.id === a.id)!;
    return { tunable: t, values: axisValues(a.min, a.max, a.steps, t.step) };
  });
  const combos = axisObjs.reduce((n, a) => n * a.values.length, 1);
  const g = useMemo(() => grade({ stats: run.stats, strategy, tunableCount: tun.length, wf, mc, grid: gridRes }), [run.stats, strategy, tun.length, wf, mc, gridRes]);
  const intraday = run.granularity < 86_400;

  const base = { candles: run.candles, granularity: run.granularity, strategy, start: run.bt.start, end: run.bt.end, objective };
  const runGrid = async () => {
    if (!axisObjs.length) return;
    try {
      setGridRes(await lab.run<GridResult>({ task: 'grid', ...base, axes: axisObjs, holdoutPct: holdout }));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The stability map failed.');
    }
  };
  const runWf = async () => {
    if (!axisObjs.length) return;
    try {
      setWf(await lab.run<WalkForward>({ task: 'walkforward', ...base, axes: axisObjs, windows, isRatio: isPct / 100, anchored }));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Walk-forward failed.');
    }
  };
  const runMc = async () => {
    const rets = run.bt.trades.map((t) => t.equityPct);
    if (rets.length < 5) {
      toast('Monte Carlo needs at least 5 trades.');
      return;
    }
    setMc(await lab.run<MonteCarlo>({ task: 'montecarlo', returns: rets, runs: mcRuns, method: mcMethod }));
  };
  const runAll = async () => {
    await runMc();
    await runGrid();
    await runWf();
  };

  return (
    <div className="main-inner">
      <Panel
        title="Overfitting grade"
        sub="How likely this edge is real rather than fitted to the past"
        actions={
          <button className="btn gold" onClick={runAll} disabled={lab.busy || !tun.length}>
            <FlaskConical /> Run every test
          </button>
        }
      >
        <div className="grade">
          <div className="grade-letter" style={{ ['--p' as string]: g.score }}>
            {g.letter}
            <small>{g.score} / 100</small>
          </div>
          <div className="checks">
            {g.checks.map((c) => (
              <div className="check" key={c.label}>
                {c.ok === 'good' ? <CheckCircle2 className="up" /> : c.ok === 'skip' ? <CircleDashed className="muted" /> : c.ok === 'fair' ? <CheckCircle2 style={{ color: 'var(--gold)' }} /> : <XCircle className="down" />}
                <b>{c.label}</b>
                <span className="detail">{c.detail}</span>
                <span className="pts">{c.ok === 'skip' ? '—' : `${c.points}/${c.max}`}</span>
              </div>
            ))}
          </div>
        </div>
        {lab.busy ? (
          <div className="progress" style={{ marginTop: 14 }}>
            <i style={{ width: `${Math.round((lab.progress ?? 0) * 100)}%` }} />
          </div>
        ) : null}
      </Panel>

      <Panel title="Numbers to test" sub={tun.length ? `${combos} combinations` : 'This strategy has no tunable numbers yet'}>
        {!tun.length ? (
          <p className="muted">Add rules with indicators or turn on a stop to get something to tune.</p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {[0, 1].map((k) => {
              const a = live[k];
              return (
                <div className="cfg" key={k}>
                  <select
                    className="select"
                    style={{ minWidth: 220, flex: '1 1 220px' }}
                    aria-label={`Parameter ${k + 1}`}
                    value={a?.id ?? ''}
                    onChange={(e) => {
                      const t = tun.find((x) => x.id === e.target.value);
                      const next = live.slice();
                      if (t) next[k] = defaultAxis(t);
                      else next.splice(k, 1);
                      setAxes(next);
                    }}
                  >
                    {k === 1 ? <option value="">Only one parameter</option> : null}
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
                        <NumberInput label="Steps" value={a.steps} min={2} max={25} onChange={(v) => setAxes(live.map((x, j) => (j === k ? { ...x, steps: v } : x)))} width={56} />
                      </div>
                    </>
                  ) : null}
                </div>
              );
            })}
            <div className="cfg">
              <div className="field">
                <span className="label">Rank settings by</span>
                <select className="select" value={objective} onChange={(e) => setObjective(e.target.value as Objective)}>
                  {OBJECTIVES.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}
      </Panel>

      <Panel
        title="Parameter stability map"
        sub="A good edge sits on a plateau, not a lonely peak"
        actions={
          <>
            <div className="field">
              <span className="label">Hold back</span>
              <NumberInput label="Holdout percent" value={holdout} min={0} max={60} step={5} width={56} onChange={setHoldout} />
              <span className="unit">%</span>
            </div>
            <button className="btn" onClick={runGrid} disabled={lab.busy || !axisObjs.length}>
              <Play /> Map it
            </button>
          </>
        }
      >
        {gridRes ? (
          <GridView g={gridRes} colorBy={colorBy} setColorBy={setColorBy} onApply={(vals) => onApply(applyValues(strategy, axisObjs.map((a) => a.tunable), vals))} />
        ) : (
          <p className="muted">Tests every combination on the first {100 - holdout}% of the period, then checks the best one on the {holdout}% it never saw.</p>
        )}
      </Panel>

      <Panel
        title="Walk-forward test"
        sub="Re-optimise on the past, trade the next stretch blind, repeat"
        actions={
          <>
            <div className="field">
              <span className="label">Windows</span>
              <NumberInput label="Windows" value={windows} min={2} max={20} width={50} onChange={setWindows} />
            </div>
            <div className="field">
              <span className="label">Train</span>
              <NumberInput label="Train percent" value={isPct} min={40} max={90} step={5} width={50} onChange={setIsPct} />
              <span className="unit">%</span>
            </div>
            <div className="field">
              <span className="label">Anchored</span>
              <Toggle label="Anchored" on={anchored} onChange={setAnchored} />
            </div>
            <button className="btn" onClick={runWf} disabled={lab.busy || !axisObjs.length}>
              <Play /> Walk forward
            </button>
          </>
        }
      >
        {wf ? <WfView wf={wf} run={run} intraday={intraday} /> : <p className="muted">Shows what you would have earned if you had re-tuned the strategy on a schedule and only ever traded settings chosen without seeing the future.</p>}
      </Panel>

      <Panel
        title="Monte Carlo"
        sub={`Reshuffles the ${run.bt.trades.length} trades to see the range of luck`}
        actions={
          <>
            <Seg
              label="Method"
              value={mcMethod}
              onChange={setMcMethod}
              options={[
                { id: 'bootstrap', label: 'Resample' },
                { id: 'shuffle', label: 'Reorder' },
              ]}
            />
            <div className="field">
              <span className="label">Runs</span>
              <NumberInput label="Runs" value={mcRuns} min={100} max={20000} step={500} width={70} onChange={setMcRuns} />
            </div>
            <button className="btn" onClick={runMc} disabled={lab.busy}>
              <Play /> Simulate
            </button>
          </>
        }
      >
        {mc ? <McView mc={mc} /> : <p className="muted">Resample draws trades at random with replacement (different luck); reorder keeps the same trades in a new order (different drawdowns).</p>}
      </Panel>
    </div>
  );
}

export function GridView({ g, colorBy, setColorBy, onApply }: { g: GridResult; colorBy: 'score' | 'holdout'; setColorBy: (v: 'score' | 'holdout') => void; onApply: (vals: number[]) => void }) {
  const two = g.axes.length === 2;
  const xs = g.axes[0].values;
  const ys = two ? g.axes[1].values : [0];
  const val = (c: (typeof g.cells)[number]) => (colorBy === 'holdout' ? (c.holdout?.returnPct ?? 0) : c.returnPct);
  const finite = g.cells.map(val).filter(Number.isFinite);
  const max = Math.max(0.0001, ...finite.map(Math.abs));
  const color = (v: number) => {
    const a = Math.min(1, Math.abs(v) / max);
    return v >= 0 ? `rgba(15,154,107,${0.12 + a * 0.6})` : `rgba(210,64,90,${0.12 + a * 0.6})`;
  };
  const cell = (x: number, y: number) => g.cells.find((c) => c.values[0] === x && (!two || c.values[1] === y))!;
  const same = (a: number[], b: number[]) => a.every((v, i) => v === b[i]);
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="toolbar">
        <span className="chip gold">Best: {g.axes.map((a, i) => `${a.label.split(' (')[0]} ${g.best.values[i]}`).join(', ')}</span>
        <span className="chip">Stability {Math.round(g.stability * 100)}%</span>
        <span className="chip">{Math.round(g.profitable * 100)}% of settings profitable</span>
        <span className="grow" />
        {g.splitTime ? (
          <Seg
            label="Colour by"
            value={colorBy}
            onChange={setColorBy}
            options={[
              { id: 'score', label: 'Training return' },
              { id: 'holdout', label: 'Held-back return' },
            ]}
          />
        ) : null}
      </div>
      <div className="tbl-wrap">
        <div className="heat" style={{ gridTemplateColumns: `64px repeat(${xs.length}, minmax(46px, 1fr))`, minWidth: 64 + xs.length * 48 }}>
          <div className="axis" style={{ fontSize: 10.5 }}>
            {two ? `${g.axes[1].label.split(' (')[0]} ↓` : ''}
          </div>
          {xs.map((x) => (
            <div className="axis" key={x}>
              {x}
            </div>
          ))}
          {ys
            .slice()
            .reverse()
            .map((y) => [
              <div className="axis" key={`y${y}`}>
                {two ? y : ''}
              </div>,
              ...xs.map((x) => {
                const c = cell(x, y);
                const v = val(c);
                return (
                  <button
                    key={`${x}-${y}`}
                    className={`cell${same(c.values, g.best.values) ? ' best' : ''}${same(c.values, g.current.values) ? ' cur' : ''}`}
                    style={{ background: color(v) }}
                    title={`${g.axes.map((a, i) => `${a.label}: ${c.values[i]}`).join('\n')}\nReturn ${pct(c.returnPct)} · drawdown ${pct(c.maxDrawdown)} · ${c.trades} trades${c.holdout ? `\nHeld back: ${pct(c.holdout.returnPct)}` : ''}\nClick to use these values`}
                    onClick={() => onApply(c.values)}
                  >
                    {pct(v, { digits: 0 })}
                  </button>
                );
              }),
            ])}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          {g.axes[0].label} →  ·  outlined: best  ·  gold ring: current settings  ·  click a cell to use it
        </div>
      </div>
      {g.splitTime ? (
        <table className="tbl">
          <thead>
            <tr>
              <th />
              <th className="r">Training return</th>
              <th className="r">Training drawdown</th>
              <th className="r">Held-back return (from {date(g.splitTime)})</th>
              <th className="r">Held-back drawdown</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Best settings', g.best],
              ['Current settings', g.current],
            ].map(([label, c]) => {
              const cc = c as (typeof g.cells)[number];
              return (
                <tr key={label as string}>
                  <td>
                    <b>{label as string}</b>
                  </td>
                  <td className="r">{pct(cc.returnPct, { sign: true })}</td>
                  <td className="r">{pct(cc.maxDrawdown)}</td>
                  <td className={`r ${(cc.holdout?.returnPct ?? 0) >= 0 ? 'up' : 'down'}`}>{pct(cc.holdout?.returnPct, { sign: true })}</td>
                  <td className="r">{pct(cc.holdout?.maxDrawdown)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function WfView({ wf, run, intraday }: { wf: WalkForward; run: RunResult; intraday: boolean }) {
  const times = run.candles.slice(run.bt.start, run.bt.end + 1).map((c) => c.time);
  const first = wf.equity[0]?.time ?? 0;
  const startIdx = times.findIndex((t) => t >= first);
  const scale = startIdx >= 0 ? run.capital / run.bt.equity[startIdx] : 1;
  const lines = [
    { id: 'wf', label: 'Walk-forward', color: THEME.gold, area: true, points: wf.equity },
    { id: 'full', label: 'Current settings', color: '#2f2a6b', width: 1, points: run.bt.equity.slice(Math.max(0, startIdx)).map((v, i) => ({ time: times[Math.max(0, startIdx) + i], value: v * scale })) },
  ];
  const fmtTime = (i: number) => date(run.candles[i].time);
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="toolbar">
        <span className={`chip ${wf.oosReturn >= 0 ? 'up' : 'down'}`}>Unseen periods {pct(wf.oosReturn, { sign: true })}</span>
        <span className="chip">Max drawdown {pct(wf.oosMaxDrawdown)}</span>
        <span className="chip">{Math.round(wf.profitableWindows * 100)}% of windows profitable</span>
        <span className="chip gold">Efficiency {wf.efficiency === null ? 'n/a' : pct(wf.efficiency, { digits: 0 })}</span>
      </div>
      <LinesChart lines={lines} intraday={intraday} height={240} fitKey={String(wf.equity.length)} />
      <div className="legend">
        <span>
          <i style={{ background: THEME.gold }} />
          Re-tuned each window, traded blind
        </span>
        <span>
          <i style={{ background: '#2f2a6b' }} />
          Current settings over the same period
        </span>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Trained on</th>
              <th>Traded</th>
              <th>Chosen</th>
              <th className="r">Training return</th>
              <th className="r">Unseen return</th>
              <th className="r">Unseen drawdown</th>
              <th className="r">Trades</th>
            </tr>
          </thead>
          <tbody>
            {wf.windows.map((w) => (
              <tr key={w.oosStart}>
                <td>
                  {fmtTime(w.isStart)} – {fmtTime(w.isEnd)}
                </td>
                <td>
                  {fmtTime(w.oosStart)} – {fmtTime(w.oosEnd)}
                </td>
                <td>{w.chosen.join(' / ')}</td>
                <td className="r">{pct(w.isReturn, { sign: true })}</td>
                <td className={`r ${w.oosReturn >= 0 ? 'up' : 'down'}`}>{pct(w.oosReturn, { sign: true })}</td>
                <td className="r">{pct(w.oosDrawdown)}</td>
                <td className="r">{w.oosTrades}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12.5 }}>
        Tuned: {wf.labels.join(', ')}. Efficiency compares yearly return on unseen data with yearly return while training; above 50% is a good sign.
      </p>
    </div>
  );
}

function McView({ mc }: { mc: MonteCarlo }) {
  const rows: [string, number][] = [
    ['Worst 5%', 5],
    ['Bad (25%)', 25],
    ['Typical (median)', 50],
    ['Good (75%)', 75],
    ['Best 5%', 95],
  ];
  const n = mc.bands.p50.length;
  const W = 640;
  const H = 220;
  const all = [...mc.bands.p5, ...mc.bands.p95];
  const lo = Math.min(...all, 1);
  const hi = Math.max(...all, 1);
  const x = (i: number) => (i / Math.max(1, n - 1)) * W;
  const y = (v: number) => H - ((Math.log(Math.max(v, 1e-3)) - Math.log(Math.max(lo, 1e-3))) / (Math.log(hi) - Math.log(Math.max(lo, 1e-3)) || 1)) * H;
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const band = `${path(mc.bands.p95)}${mc.bands.p5
    .map((v, i) => [i, v] as const)
    .reverse()
    .map(([i, v]) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join('')}Z`;
  return (
    <div className="grid-2">
      <div>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Monte Carlo equity paths" style={{ overflow: 'visible' }}>
          <line x1={0} x2={W} y1={y(1)} y2={y(1)} stroke="#d7dae2" strokeDasharray="4 4" />
          {mc.samples.slice(0, 40).map((p, k) => (
            <path key={k} d={path(p)} fill="none" stroke="#2f2a6b" strokeOpacity={0.08} strokeWidth={1} />
          ))}
          <path d={band} fill="rgba(217,178,90,0.18)" />
          <path d={path(mc.bands.p50)} fill="none" stroke={THEME.gold} strokeWidth={2.2} />
        </svg>
        <div className="legend">
          <span>
            <i style={{ background: THEME.gold }} />
            Median path
          </span>
          <span>
            <i style={{ background: 'rgba(217,178,90,0.45)' }} />
            90% of outcomes
          </span>
          <span className="muted">x: trade number · y: account (log)</span>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Outcome</th>
              <th className="r">Final return</th>
              <th className="r">Max drawdown</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, p]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className={`r ${percentile(mc.finals, p) >= 0 ? 'up' : 'down'}`}>{pct(percentile(mc.finals, p), { sign: true })}</td>
                <td className="r">{pct(percentile(mc.drawdowns, p))}</td>
              </tr>
            ))}
            <tr className="me">
              <td>
                <b>Your backtest</b>
              </td>
              <td className="r">{pct(mc.original.final, { sign: true })}</td>
              <td className="r">{pct(mc.original.drawdown)}</td>
            </tr>
          </tbody>
        </table>
        <div className="toolbar">
          <span className={`chip ${mc.probLoss <= 0.1 ? 'up' : 'down'}`}>{pct(mc.probLoss, { digits: 1 })} chance of a loss</span>
          <span className={`chip ${mc.probRuin <= 0.05 ? 'up' : 'down'}`}>{pct(mc.probRuin, { digits: 1 })} chance of a 50% drawdown</span>
          <span className="chip">{ratio(mc.runs, 0)} runs</span>
        </div>
      </div>
    </div>
  );
}
