import { BookOpen, LineChart, Play, Plus, Trash2, Trophy } from 'lucide-react';
import { useState } from 'react';

import { AssetIcon, AssetPicker } from '../components/AssetPicker';
import { SERIES, THEME } from '../components/charts';
import { LinesChart } from '../components/PriceChart';
import { Modal, Panel } from '../components/ui';
import { toast } from '../components/toast';
import { inputsOf } from '../lib/catalog';
import type { Timeframe } from '../lib/data/core';
import { loadSeries, type Asset } from '../lib/data/sources';
import { pct, ratio } from '../lib/format';
import { OBJECTIVES, score, type Objective, type Stats } from '../lib/metrics';
import { PRESETS } from '../lib/presets';
import { runRange } from '../lib/robustness';
import type { Strategy } from '../lib/rules';
import { loadLibrary } from '../lib/state';

interface Slot {
  id: string;
  strategy: Strategy;
  asset: Asset;
  tf: Timeframe;
}

interface Outcome {
  slot: Slot;
  stats?: Stats;
  curve?: { time: number; value: number }[];
  error?: string;
}

interface Props {
  strategy: Strategy;
  asset: Asset;
  tf: Timeframe;
  from: string;
  to: string;
  custom: Asset[];
  onCustom: (a: Asset) => void;
  onOpen: (s: Strategy, a: Asset, tf: Timeframe) => void;
}

let uid = 0;
const slot = (strategy: Strategy, asset: Asset, tf: Timeframe): Slot => ({ id: `s${++uid}`, strategy: structuredClone(strategy), asset, tf });

export function CompareView({ strategy, asset, tf, from, to, custom, onCustom, onOpen }: Props) {
  const [slots, setSlots] = useState<Slot[]>(() => [slot(strategy, asset, tf)]);
  const [results, setResults] = useState<Outcome[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [objective, setObjective] = useState<Objective>('returnOverDD');
  const [picking, setPicking] = useState<string | null>(null); // slot id or 'new'
  const [choosing, setChoosing] = useState(false);

  const run = async (list = slots) => {
    setBusy(true);
    const fromT = from ? Date.parse(`${from}T00:00:00Z`) / 1000 : -Infinity;
    const toT = to ? Date.parse(`${to}T23:59:59Z`) / 1000 : Infinity;
    const out = await Promise.all(
      list.map(async (s): Promise<Outcome> => {
        try {
          const series = await loadSeries(s.asset, s.tf);
          const c = series.candles;
          const startIdx = Math.max(0, c.findIndex((x) => x.time >= fromT));
          let endIdx = c.length - 1;
          while (endIdx > 0 && c[endIdx].time > toT) endIdx--;
          const { bt, stats } = runRange({ candles: c, inputs: inputsOf(c), granularity: series.granularity }, s.strategy, startIdx, endIdx);
          return { slot: s, stats, curve: bt.equity.map((v, i) => ({ time: c[bt.start + i].time, value: v / s.strategy.costs.capital - 1 })) };
        } catch (e) {
          return { slot: s, error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
    setResults(out);
    setBusy(false);
  };

  const ranked = (results ?? []).slice().sort((a, b) => (b.stats ? score(b.stats, objective) : -Infinity) - (a.stats ? score(a.stats, objective) : -Infinity));
  const colorOf = (id: string) => SERIES[slots.findIndex((s) => s.id === id) % SERIES.length];
  const lines = (results ?? []).filter((r) => r.curve).map((r) => ({ id: r.slot.id, label: r.slot.strategy.name, color: colorOf(r.slot.id), points: r.curve!, width: 2 }));

  const addPresets = () => {
    const next = [...slots, ...PRESETS.filter((p) => !slots.some((s) => s.strategy.name === p.strategy.name && s.asset.id === asset.id)).map((p) => slot(p.strategy, asset, tf))];
    setSlots(next);
    void run(next);
  };

  return (
    <div className="main-inner">
      <Panel
        title="Head to head"
        sub="Same dates, same costs, ranked side by side"
        actions={
          <>
            <button className="btn" onClick={addPresets}>
              <Trophy /> All classics on {asset.display}
            </button>
            <button className="btn gold" onClick={() => run()} disabled={busy || !slots.length}>
              {busy ? <span className="spinner" /> : <Play />} Run {slots.length}
            </button>
          </>
        }
      >
        <div>
          {slots.map((s) => (
            <div className="compare-slot" key={s.id}>
              <span className="swatch" style={{ background: colorOf(s.id) }} />
              <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.strategy.name}</b>
              <button className="btn sm" style={{ justifyContent: 'flex-start', minWidth: 0 }} onClick={() => setPicking(s.id)}>
                <AssetIcon a={s.asset} />
                {s.asset.display}
                <span className="muted">· {s.tf}</span>
              </button>
              <button className="icon-btn sm" aria-label="Open in the builder" title="Open in the builder" onClick={() => onOpen(s.strategy, s.asset, s.tf)}>
                <LineChart />
              </button>
              <button className="icon-btn sm" aria-label="Remove" onClick={() => setSlots(slots.filter((x) => x.id !== s.id))}>
                <Trash2 />
              </button>
            </div>
          ))}
          <div className="add-row" style={{ marginTop: 12 }}>
            <button className="btn sm" onClick={() => setPicking('new')}>
              <Plus /> This strategy on another market
            </button>
            <button className="btn sm" onClick={() => setChoosing(true)}>
              <BookOpen /> Another strategy on {asset.display}
            </button>
            <button className="btn sm" onClick={() => setSlots([...slots, slot(strategy, asset, tf)])}>
              <Plus /> Current version again
            </button>
          </div>
        </div>
      </Panel>

      {results ? (
        <>
          <Panel
            title="Ranking"
            actions={
              <select className="select" value={objective} onChange={(e) => setObjective(e.target.value as Objective)} aria-label="Rank by">
                {OBJECTIVES.map((o) => (
                  <option key={o.id} value={o.id}>
                    Rank by {o.label.toLowerCase()}
                  </option>
                ))}
              </select>
            }
          >
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Strategy</th>
                    <th>Market</th>
                    <th className="r">Return</th>
                    <th className="r">CAGR</th>
                    <th className="r">Max drawdown</th>
                    <th className="r">Sharpe</th>
                    <th className="r">Profit factor</th>
                    <th className="r">Win rate</th>
                    <th className="r">Trades</th>
                    <th className="r">vs buy & hold</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((r, i) => (
                    <tr key={r.slot.id} className="clickable" onClick={() => onOpen(r.slot.strategy, r.slot.asset, r.slot.tf)} title="Open in the builder">
                      <td>
                        <span className="swatch" style={{ background: colorOf(r.slot.id), display: 'inline-block', marginRight: 8 }} />
                        {r.stats ? i + 1 : '—'}
                      </td>
                      <td style={{ fontWeight: 700 }}>{r.slot.strategy.name}</td>
                      <td>
                        {r.slot.asset.display} <span className="muted">{r.slot.tf}</span>
                      </td>
                      {r.stats ? (
                        <>
                          <td className={`r ${r.stats.returnPct >= 0 ? 'up' : 'down'}`}>{pct(r.stats.returnPct, { sign: true })}</td>
                          <td className="r">{r.stats.cagr === null ? '—' : pct(r.stats.cagr, { sign: true })}</td>
                          <td className="r">{pct(r.stats.maxDrawdown)}</td>
                          <td className="r">{ratio(r.stats.sharpe)}</td>
                          <td className="r">{ratio(r.stats.profitFactor)}</td>
                          <td className="r">{pct(r.stats.winRate, { digits: 0 })}</td>
                          <td className="r">{r.stats.trades}</td>
                          <td className={`r ${r.stats.returnPct >= r.stats.benchmarkReturn ? 'up' : 'down'}`}>{pct(r.stats.returnPct - r.stats.benchmarkReturn, { sign: true })}</td>
                        </>
                      ) : (
                        <td colSpan={8} className="down">
                          {r.error}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          {lines.length ? (
            <Panel title="Growth" sub="Each run's return since its first bar">
              <LinesChart lines={lines} intraday={false} height={340} percent fitKey={lines.map((l) => l.id).join()} />
              <div className="legend" style={{ paddingTop: 8 }}>
                {lines.map((l) => (
                  <span key={l.id}>
                    <i style={{ background: l.color }} />
                    {slots.find((s) => s.id === l.id)?.strategy.name} · {slots.find((s) => s.id === l.id)?.asset.display}
                  </span>
                ))}
              </div>
            </Panel>
          ) : null}
        </>
      ) : (
        <div className="empty panel">
          <Trophy style={{ width: 28, height: 28, color: THEME.gold }} />
          <h3>Line them up, then run</h3>
          <p>Try your strategy on BTC, SPY and gold at once, or race it against the classic systems on {asset.display}.</p>
        </div>
      )}

      {picking ? (
        <AssetPicker
          custom={custom}
          onCustom={onCustom}
          onClose={() => setPicking(null)}
          onPick={(a) => {
            if (picking === 'new') setSlots([...slots, slot(strategy, a, a.source === 'csv' ? '1d' : tf)]);
            else setSlots(slots.map((s) => (s.id === picking ? { ...s, asset: a } : s)));
            setPicking(null);
          }}
        />
      ) : null}
      {choosing ? (
        <Modal title="Add a strategy" onClose={() => setChoosing(false)}>
          <div className="modal-body" style={{ display: 'grid', gap: 2 }}>
            {[...loadLibrary().map((x) => ({ key: x.id, name: x.strategy.name, blurb: 'Saved on this device', s: x.strategy })), ...PRESETS.map((p) => ({ key: p.id, name: p.name, blurb: p.blurb, s: p.strategy }))].map((x) => (
              <button
                key={x.key}
                className="result"
                onClick={() => {
                  setSlots([...slots, slot(x.s, asset, tf)]);
                  setChoosing(false);
                  toast(`Added ${x.name}`);
                }}
              >
                <span style={{ display: 'grid', gap: 2 }}>
                  <b>{x.name}</b>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {x.blurb}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
