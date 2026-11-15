import { isoDay } from '../lib/format';
import { STRATEGIES, defaultParams, strategyById } from '../lib/strategies';
import type { AppState } from '../lib/share';
import type { Params, Settings } from '../lib/types';
import { Field, NumberBox, Segmented, SliderField } from './ui';

const DAY = 86_400;
const SPANS = [
  { id: '5y', label: '5Y', days: 5 * 365 },
  { id: '3y', label: '3Y', days: 3 * 365 },
  { id: '1y', label: '1Y', days: 365 },
  { id: '6m', label: '6M', days: 182 },
  { id: '3m', label: '3M', days: 91 },
  { id: '1m', label: '1M', days: 30 },
  { id: '2w', label: '2W', days: 14 },
];

// Parameters that must stay in order; moving one past the other nudges its partner along.
const PAIRS: Record<string, [string, 1 | -1]> = {
  fast: ['slow', 1],
  slow: ['fast', -1],
  oversold: ['overbought', 1],
  overbought: ['oversold', -1],
};

interface Props {
  state: AppState;
  first: number | null; // first and last candle in the data
  last: number | null;
  onChange: (patch: Partial<AppState>) => void;
}

export function Controls({ state, first, last, onChange }: Props) {
  const strategy = strategyById(state.strategy);
  const set = (patch: Partial<Settings>) => onChange({ settings: { ...state.settings, ...patch } });

  const setParam = (key: string, v: number) => {
    let next: Params = { ...state.params, [key]: v };
    const pair = PAIRS[key];
    if (strategy.check?.(next) && pair) {
      const def = strategy.params.find((d) => d.key === pair[0]);
      if (def) next = { ...next, [def.key]: Math.min(def.max, Math.max(def.min, v + pair[1] * def.step)) };
    }
    if (!strategy.check?.(next)) onChange({ params: next });
  };

  const spanDays = first !== null && last !== null ? (last - first) / DAY : 0;
  const spans = SPANS.filter((s) => s.days < spanDays * 0.95).slice(0, 4);
  const fromFor = (days: number) => (last === null ? state.from : isoDay(last - days * DAY));
  const activeSpan = state.to
    ? null
    : first !== null && state.from <= isoDay(first)
      ? 'all'
      : (spans.find((s) => fromFor(s.days) === state.from)?.id ?? null);

  return (
    <>
      <section className="section">
        <h3>Strategy</h3>
        <div className="strategies">
          {STRATEGIES.map((s) => (
            <button
              key={s.id}
              type="button"
              className="strategy"
              aria-pressed={s.id === strategy.id}
              onClick={() => s.id !== strategy.id && onChange({ strategy: s.id, params: defaultParams(s) })}
            >
              <b>{s.name}</b>
              <span>{s.summary}</span>
            </button>
          ))}
        </div>
        <ul className="rules">
          {strategy.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
          <li>{state.settings.direction === 'both' ? 'Opposite signals open shorts.' : 'Long only: sell signals close the position.'}</li>
        </ul>
      </section>

      <section className="section">
        <h3>Parameters</h3>
        {strategy.params.map((d) => (
          <SliderField
            key={d.key}
            label={d.label}
            value={state.params[d.key]}
            min={d.min}
            max={d.max}
            step={d.step}
            onChange={(v) => setParam(d.key, v)}
          />
        ))}
      </section>

      <section className="section">
        <h3>Test period</h3>
        <div style={{ marginBottom: 10 }}>
          <Segmented
            label="Test period"
            small
            value={activeSpan ?? ''}
            options={[{ id: 'all', label: 'All' }, ...spans.map((s) => ({ id: s.id, label: s.label }))]}
            onChange={(id) => {
              if (id === 'all' && first !== null) onChange({ from: isoDay(first), to: '' });
              const s = spans.find((x) => x.id === id);
              if (s) onChange({ from: fromFor(s.days), to: '' });
            }}
          />
        </div>
        <div className="grid-2">
          <Field label="From">
            <input
              className="date-input"
              type="date"
              aria-label="From"
              value={first !== null && state.from < isoDay(first) ? isoDay(first) : state.from}
              min={first !== null ? isoDay(first) : undefined}
              max={last !== null ? isoDay(last) : undefined}
              onChange={(e) => e.target.value && onChange({ from: e.target.value })}
            />
          </Field>
          <Field label="To" hint={state.to ? undefined : 'latest'}>
            <input
              className="date-input"
              type="date"
              aria-label="To"
              value={state.to || (last !== null ? isoDay(last) : '')}
              min={first !== null ? isoDay(first) : undefined}
              max={last !== null ? isoDay(last) : undefined}
              onChange={(e) => onChange({ to: !e.target.value || (last !== null && e.target.value >= isoDay(last)) ? '' : e.target.value })}
            />
          </Field>
        </div>
      </section>

      <section className="section">
        <h3>Position</h3>
        <div style={{ marginBottom: 12 }}>
          <Segmented
            label="Direction"
            value={state.settings.direction}
            options={[
              { id: 'long', label: 'Long only' },
              { id: 'both', label: 'Long & short' },
            ]}
            onChange={(direction) => set({ direction })}
          />
        </div>
        <div className="grid-2">
          <Field label="Starting capital">
            <NumberBox
              label="Starting capital"
              value={state.settings.capital}
              min={100}
              max={10_000_000}
              step={1000}
              suffix="$"
              onChange={(capital) => set({ capital })}
            />
          </Field>
          <Field label="Position size">
            <NumberBox
              label="Position size"
              value={state.settings.sizePct}
              min={1}
              max={100}
              step={5}
              suffix="%"
              onChange={(sizePct) => set({ sizePct })}
            />
          </Field>
        </div>
      </section>

      <section className="section">
        <h3>Risk management</h3>
        <div className="grid-2">
          <Field label="Stop loss" hint={state.settings.stopPct ? undefined : 'off'}>
            <NumberBox
              label="Stop loss"
              value={state.settings.stopPct}
              min={0}
              max={90}
              step={0.5}
              suffix="%"
              onChange={(stopPct) => set({ stopPct })}
            />
          </Field>
          <Field label="Take profit" hint={state.settings.takeProfitPct ? undefined : 'off'}>
            <NumberBox
              label="Take profit"
              value={state.settings.takeProfitPct}
              min={0}
              max={1000}
              step={1}
              suffix="%"
              onChange={(takeProfitPct) => set({ takeProfitPct })}
            />
          </Field>
          <Field label="Trailing stop" hint={state.settings.trailPct ? undefined : 'off'}>
            <NumberBox
              label="Trailing stop"
              value={state.settings.trailPct}
              min={0}
              max={90}
              step={0.5}
              suffix="%"
              onChange={(trailPct) => set({ trailPct })}
            />
          </Field>
          <Field label="Trend filter" hint={state.settings.trendFilter ? undefined : 'off'}>
            <select
              className="select"
              aria-label="Trend filter"
              value={state.settings.trendFilter}
              onChange={(e) => set({ trendFilter: Number(e.target.value) })}
            >
              <option value={0}>Off</option>
              <option value={50}>With SMA 50</option>
              <option value={100}>With SMA 100</option>
              <option value={200}>With SMA 200</option>
            </select>
          </Field>
        </div>
      </section>

      <section className="section">
        <h3>Costs</h3>
        <div className="grid-2">
          <Field label="Fee per trade">
            <NumberBox
              label="Fee per trade"
              value={state.settings.feePct}
              min={0}
              max={5}
              step={0.05}
              suffix="%"
              onChange={(feePct) => set({ feePct })}
            />
          </Field>
          <Field label="Slippage">
            <NumberBox
              label="Slippage"
              value={state.settings.slippagePct}
              min={0}
              max={5}
              step={0.05}
              suffix="%"
              onChange={(slippagePct) => set({ slippagePct })}
            />
          </Field>
        </div>
      </section>
    </>
  );
}
