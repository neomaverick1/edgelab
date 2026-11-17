// The strategy model behind the rule builder: entry and exit rules made of indicator comparisons grouped with
// AND / OR, plus stops, targets, sizing and costs. `evaluate` turns a strategy into per-bar signals.
import { indicator, sourceSeries, type Inputs, type Source } from './catalog';
import { atr } from './indicators';

export type Cmp = 'gt' | 'lt' | 'gte' | 'lte' | 'xup' | 'xdn' | 'rising' | 'falling';

export const CMPS: { id: Cmp; label: string; word: string; unary?: boolean }[] = [
  { id: 'xup', label: 'crosses above', word: 'crosses above' },
  { id: 'xdn', label: 'crosses below', word: 'crosses below' },
  { id: 'gt', label: 'is above', word: 'is above' },
  { id: 'lt', label: 'is below', word: 'is below' },
  { id: 'gte', label: 'is at or above', word: 'is at or above' },
  { id: 'lte', label: 'is at or below', word: 'is at or below' },
  { id: 'rising', label: 'is rising', word: 'is rising', unary: true },
  { id: 'falling', label: 'is falling', word: 'is falling', unary: true },
];

export interface IndOperand {
  kind: 'ind';
  id: string; // indicator id from the catalog
  p: number[]; // parameter values
  out?: string; // which output, when the indicator has several
  src?: Source; // price series it reads, when it reads one
  ago?: number; // value this many bars back
}
export interface NumOperand {
  kind: 'num';
  v: number;
}
export type Operand = IndOperand | NumOperand;

export interface Rule {
  type: 'rule';
  a: IndOperand;
  cmp: Cmp;
  b: Operand;
  within?: number; // true if the comparison held on any of the last N bars
  bars?: number; // for rising / falling: compared with N bars ago
}
export interface RuleGroup {
  type: 'group';
  mode: 'all' | 'any';
  items: (Rule | RuleGroup)[];
}

export type DistUnit = 'pct' | 'atr';
export interface Exits {
  atrLength: number;
  stop: { on: boolean; unit: DistUnit; value: number };
  trail: { on: boolean; unit: DistUnit; value: number; activate: number }; // activate: profit % before it starts (0 = at once)
  targets: { on: boolean; levels: { unit: DistUnit | 'r'; value: number; size: number }[] }; // size: % of the position
  breakeven: { on: boolean; unit: 'pct' | 'r'; value: number };
  time: { on: boolean; bars: number };
}
export interface Sizing {
  mode: 'equity' | 'risk' | 'cash'; // % of equity, % of equity at risk per trade, fixed amount
  value: number;
  leverage: number; // most exposure allowed, as a multiple of equity
  scaleIn: { on: boolean; max: number; size: number; onlyInProfit: boolean }; // size: % of the first entry
}
export interface Costs {
  capital: number;
  feePct: number;
  slippagePct: number;
}
export interface Strategy {
  v: 2;
  name: string;
  side: 'long' | 'short' | 'both';
  longEntry: RuleGroup;
  longExit: RuleGroup;
  shortEntry: RuleGroup;
  shortExit: RuleGroup;
  filter: RuleGroup; // "only trade when": must hold for any new entry
  exits: Exits;
  sizing: Sizing;
  costs: Costs;
}

export const group = (mode: 'all' | 'any' = 'all', items: (Rule | RuleGroup)[] = []): RuleGroup => ({ type: 'group', mode, items });
export const ind = (id: string, p: number[] = indicator(id).params.map((x) => x.def), extra: Partial<IndOperand> = {}): IndOperand => ({
  kind: 'ind',
  id,
  p,
  ...extra,
});
export const num = (v: number): NumOperand => ({ kind: 'num', v });
export const rule = (a: IndOperand, cmp: Cmp, b: Operand = num(0), extra: Partial<Rule> = {}): Rule => ({ type: 'rule', a, cmp, b, ...extra });

export const DEFAULT_EXITS: Exits = {
  atrLength: 14,
  stop: { on: false, unit: 'pct', value: 5 },
  trail: { on: false, unit: 'atr', value: 3, activate: 0 },
  targets: { on: false, levels: [{ unit: 'pct', value: 10, size: 100 }] },
  breakeven: { on: false, unit: 'r', value: 1 },
  time: { on: false, bars: 20 },
};
export const DEFAULT_SIZING: Sizing = { mode: 'equity', value: 100, leverage: 1, scaleIn: { on: false, max: 2, size: 50, onlyInProfit: true } };
export const DEFAULT_COSTS: Costs = { capital: 10_000, feePct: 0.1, slippagePct: 0.05 };

export function blankStrategy(name = 'New strategy'): Strategy {
  return {
    v: 2,
    name,
    side: 'long',
    longEntry: group(),
    longExit: group(),
    shortEntry: group(),
    shortExit: group(),
    filter: group(),
    exits: structuredClone(DEFAULT_EXITS),
    sizing: structuredClone(DEFAULT_SIZING),
    costs: { ...DEFAULT_COSTS },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Evaluation

export interface Plot {
  key: string;
  label: string;
  place: 'overlay' | 'pane';
  pane: string; // plots with the same pane key share a pane
  values: number[];
  levels?: number[];
}

export interface Signals {
  longEntry: Uint8Array;
  longExit: Uint8Array;
  shortEntry: Uint8Array;
  shortExit: Uint8Array;
  filter: Uint8Array;
  atr: number[];
  plots: Plot[];
  warmup: number; // bars before every indicator in use has a value
}

const PANE_OUTPUTS = new Set(['bb.percentB', 'bb.bandwidth']);
const HIDDEN_OUTPUTS = new Set(['supertrend.dir']);

export const instanceKey = (o: IndOperand) => {
  const def = indicator(o.id);
  return `${o.id}(${o.p.join(',')}${def.source ? `,${o.src ?? def.source}` : ''})`;
};

/** Short human label: "EMA 200", "RSI 14", "MACD 12/26/9 signal line", "20-bar high", "Close". */
export function operandLabel(o: Operand): string {
  if (o.kind === 'num') return formatNum(o.v);
  const def = indicator(o.id);
  const out = o.out ?? def.outputs[0].key;
  const outLabel = (def.outputs.find((x) => x.key === out)?.label ?? '').replace(/\s*\(.*\)$/, '');
  let base: string;
  if (o.id === 'price') base = (o.src ?? 'close').replace(/^\w/, (c) => c.toUpperCase());
  else if (o.id === 'pattern') base = outLabel;
  else if (o.id === 'donchian' && out !== 'mid') base = `${o.p[0]}-bar ${out === 'upper' ? 'high' : 'low'}`;
  else if (o.id === 'smaatr' || o.id === 'emaatr')
    base = `${o.id.slice(0, 3).toUpperCase()} ${o.p[0]} ${out === 'upper' ? '+' : '-'} ${formatNum(o.p[1])} ATR${o.p[2] !== 14 ? ` ${o.p[2]}` : ''}`;
  else base = [def.short, o.p.join('/'), def.outputs.length > 1 && out !== def.outputs[0].key ? outLabel.toLowerCase() : ''].filter(Boolean).join(' ');
  const src = def.source && o.src && o.src !== def.source && o.id !== 'price' ? ` of ${o.src}` : '';
  const ago = o.ago ? ` ${o.ago} bar${o.ago > 1 ? 's' : ''} ago` : '';
  return base + src + ago;
}

export const formatNum = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(+v.toFixed(6)));

class Evaluator {
  private cache = new Map<string, Record<string, number[]>>();
  private sources = new Map<Source, number[]>();
  readonly used = new Map<string, { op: IndOperand; outs: Set<string> }>();
  private d: Inputs;
  constructor(d: Inputs) {
    this.d = d;
  }

  private source(s: Source) {
    let v = this.sources.get(s);
    if (!v) {
      v = sourceSeries(this.d, s);
      this.sources.set(s, v);
    }
    return v;
  }

  outputs(o: IndOperand) {
    const key = instanceKey(o);
    let r = this.cache.get(key);
    if (!r) {
      const def = indicator(o.id);
      r = def.compute(this.d, o.p, this.source(o.src ?? def.source ?? 'close'));
      this.cache.set(key, r);
    }
    return r;
  }

  series(o: Operand): number[] | number {
    if (o.kind === 'num') return o.v;
    const def = indicator(o.id);
    const out = o.out ?? def.outputs[0].key;
    const vals = this.outputs(o)[out] ?? this.outputs(o)[def.outputs[0].key];
    const key = instanceKey(o);
    const entry = this.used.get(key) ?? { op: o, outs: new Set<string>() };
    entry.outs.add(out);
    this.used.set(key, entry);
    if (!o.ago) return vals;
    const k = o.ago;
    return vals.map((_, i) => (i >= k ? vals[i - k] : NaN));
  }

  rule(r: Rule): Uint8Array {
    const n = this.d.close.length;
    const a = this.series(r.a) as number[];
    const b = this.series(r.b);
    const at = typeof b === 'number' ? () => b : (i: number) => b[i];
    const out = new Uint8Array(n);
    const k = Math.max(1, r.bars ?? 1);
    for (let i = 0; i < n; i++) {
      const x = a[i];
      const y = at(i);
      let ok = false;
      switch (r.cmp) {
        case 'gt':
          ok = x > y;
          break;
        case 'lt':
          ok = x < y;
          break;
        case 'gte':
          ok = x >= y;
          break;
        case 'lte':
          ok = x <= y;
          break;
        case 'xup':
          ok = i > 0 && x > y && a[i - 1] <= at(i - 1);
          break;
        case 'xdn':
          ok = i > 0 && x < y && a[i - 1] >= at(i - 1);
          break;
        case 'rising':
          ok = i >= k && x > a[i - k];
          break;
        case 'falling':
          ok = i >= k && x < a[i - k];
          break;
      }
      out[i] = ok ? 1 : 0;
    }
    const w = Math.max(1, r.within ?? 1);
    if (w <= 1) return out;
    const held = new Uint8Array(n);
    let last = -Infinity;
    for (let i = 0; i < n; i++) {
      if (out[i]) last = i;
      held[i] = i - last < w ? 1 : 0;
    }
    return held;
  }

  group(g: RuleGroup, empty: 0 | 1): Uint8Array {
    const n = this.d.close.length;
    const res = new Uint8Array(n);
    if (!g.items.length) return res.fill(empty);
    const parts = g.items.map((it) => (it.type === 'rule' ? this.rule(it) : this.group(it, g.mode === 'all' ? 1 : 0)));
    for (let i = 0; i < n; i++) {
      let v = g.mode === 'all' ? 1 : 0;
      for (const p of parts) {
        if (g.mode === 'all' && !p[i]) {
          v = 0;
          break;
        }
        if (g.mode === 'any' && p[i]) {
          v = 1;
          break;
        }
      }
      res[i] = v;
    }
    return res;
  }
}

export function evaluate(s: Strategy, d: Inputs): Signals {
  const ev = new Evaluator(d);
  const long = s.side !== 'short';
  const short = s.side !== 'long';
  const n = d.close.length;
  const none = new Uint8Array(n);
  const sig: Signals = {
    longEntry: long ? ev.group(s.longEntry, 0) : none,
    longExit: long ? ev.group(s.longExit, 0) : none,
    shortEntry: short ? ev.group(s.shortEntry, 0) : none,
    shortExit: short ? ev.group(s.shortExit, 0) : none,
    filter: ev.group(s.filter, 1),
    atr: atr(d.high, d.low, d.close, Math.max(1, s.exits.atrLength)),
    plots: [],
    warmup: 0,
  };

  // Warm-up: the first bar where every series in use has a value.
  const usesAtr =
    (s.exits.stop.on && s.exits.stop.unit === 'atr') ||
    (s.exits.trail.on && s.exits.trail.unit === 'atr') ||
    (s.exits.targets.on && s.exits.targets.levels.some((l) => l.unit === 'atr'));
  let warmup = usesAtr ? s.exits.atrLength : 0;
  for (const { op, outs } of ev.used.values()) {
    const vals = ev.outputs(op);
    for (const o of outs) {
      const first = vals[o]?.findIndex((v) => Number.isFinite(v)) ?? 0;
      warmup = Math.max(warmup, first + (op.ago ?? 0) + 1);
    }
  }
  sig.warmup = Math.min(warmup, n - 1);

  // Lines for the chart.
  for (const [key, { op, outs }] of ev.used) {
    const def = indicator(op.id);
    if (def.place === 'none') continue;
    const vals = ev.outputs(op);
    // Bands are drawn whole (upper, middle, lower); other indicators only show the lines the rules use.
    const BANDS = new Set(['bb', 'keltner', 'ichimoku']);
    const shown =
      def.place === 'overlay'
        ? BANDS.has(op.id)
          ? def.outputs.filter((o) => !PANE_OUTPUTS.has(`${op.id}.${o.key}`) && !HIDDEN_OUTPUTS.has(`${op.id}.${o.key}`) && (op.id !== 'ichimoku' || o.key.startsWith('span'))).map((o) => o.key)
          : []
        : def.outputs.map((o) => o.key);
    const keys = new Set([...shown, ...[...outs].filter((o) => !HIDDEN_OUTPUTS.has(`${op.id}.${o}`))]);
    for (const out of keys) {
      const paneOut = def.place === 'pane' || PANE_OUTPUTS.has(`${op.id}.${out}`);
      const label = operandLabel({ ...op, out, ago: 0 });
      sig.plots.push({
        key: `${key}.${out}`,
        label,
        place: paneOut ? 'pane' : 'overlay',
        pane: paneOut ? (def.place === 'pane' ? key : `${key}.${out}`) : 'main',
        values: vals[out],
        levels: paneOut ? def.levels : undefined,
      });
    }
  }
  return sig;
}

// ---------------------------------------------------------------------------------------------------------------
// Tunable numbers, for the optimizer and the robustness lab.

export interface Tunable {
  id: string; // stable within one strategy
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  paths: string[]; // every place this number lives (an indicator used twice is tuned once)
}

type Node = Record<string, unknown>;
const at = (obj: unknown, path: string) => path.split('.').reduce<unknown>((o, k) => (o as Node)?.[k], obj);

export function setPath<T>(obj: T, path: string, value: number): T {
  const keys = path.split('.');
  let o = obj as unknown as Node;
  for (const k of keys.slice(0, -1)) o = o[k] as Node;
  o[keys[keys.length - 1]] = value;
  return obj;
}

export function applyValues(s: Strategy, tunables: Tunable[], values: number[]): Strategy {
  const copy = structuredClone(s);
  tunables.forEach((t, i) => t.paths.forEach((p) => setPath(copy, p, values[i])));
  return copy;
}

const GROUP_NAMES: Record<string, string> = {
  longEntry: 'long entry',
  longExit: 'long exit',
  shortEntry: 'short entry',
  shortExit: 'short exit',
  filter: 'filter',
};

export function tunables(s: Strategy): Tunable[] {
  const out: Tunable[] = [];
  const byInstance = new Map<string, Tunable[]>();
  const active = (k: string) => (k.startsWith('long') ? s.side !== 'short' : k.startsWith('short') ? s.side !== 'long' : true);

  const walk = (g: RuleGroup, path: string, where: string) => {
    g.items.forEach((it, idx) => {
      const p = `${path}.items.${idx}`;
      if (it.type === 'group') return walk(it, p, where);
      for (const side of ['a', 'b'] as const) {
        const o = it[side];
        if (o.kind === 'num') {
          if (side === 'b' && !CMPS.find((c) => c.id === it.cmp)?.unary) {
            const step = Math.abs(o.v) >= 50 ? 1 : Math.abs(o.v) >= 5 ? 0.5 : 0.1;
            out.push({
              id: `${p}.b.v`,
              label: `${operandLabel(it.a)} level (${where})`,
              value: o.v,
              min: o.v - Math.max(Math.abs(o.v), 10),
              max: o.v + Math.max(Math.abs(o.v), 10),
              step,
              paths: [`${p}.b.v`],
            });
          }
          continue;
        }
        const def = indicator(o.id);
        const key = instanceKey(o);
        const seen = byInstance.get(key);
        if (seen) {
          def.params.forEach((_, k) => seen[k].paths.push(`${p}.${side}.p.${k}`));
          continue;
        }
        const list = def.params.map((spec, k) => ({
          id: `${p}.${side}.p.${k}`,
          label: `${operandLabel({ ...o, out: undefined, ago: 0 })} ${spec.label.toLowerCase()} (${where})`,
          value: o.p[k],
          min: spec.min,
          max: spec.max,
          step: spec.step,
          paths: [`${p}.${side}.p.${k}`],
        }));
        byInstance.set(key, list);
        out.push(...list);
      }
    });
  };
  for (const k of ['longEntry', 'longExit', 'shortEntry', 'shortExit', 'filter'] as const) if (active(k)) walk(s[k], k, GROUP_NAMES[k]);

  const e = s.exits;
  const unit = (u: string) => (u === 'atr' ? '× ATR' : u === 'r' ? 'R' : '%');
  if (e.stop.on) out.push({ id: 'exits.stop.value', label: `Stop loss (${unit(e.stop.unit)})`, value: e.stop.value, min: 0.1, max: e.stop.unit === 'atr' ? 10 : 50, step: e.stop.unit === 'atr' ? 0.25 : 0.5, paths: ['exits.stop.value'] });
  if (e.trail.on) out.push({ id: 'exits.trail.value', label: `Trailing stop (${unit(e.trail.unit)})`, value: e.trail.value, min: 0.1, max: e.trail.unit === 'atr' ? 10 : 50, step: e.trail.unit === 'atr' ? 0.25 : 0.5, paths: ['exits.trail.value'] });
  if (e.targets.on)
    e.targets.levels.forEach((l, i) =>
      out.push({ id: `exits.targets.levels.${i}.value`, label: `Take profit ${i + 1} (${unit(l.unit)})`, value: l.value, min: 0.1, max: l.unit === 'pct' ? 200 : 20, step: l.unit === 'pct' ? 0.5 : 0.25, paths: [`exits.targets.levels.${i}.value`] }),
    );
  if (e.time.on) out.push({ id: 'exits.time.bars', label: 'Time exit (bars)', value: e.time.bars, min: 1, max: 500, step: 1, paths: ['exits.time.bars'] });
  if (e.breakeven.on) out.push({ id: 'exits.breakeven.value', label: `Breakeven after (${unit(e.breakeven.unit)})`, value: e.breakeven.value, min: 0.1, max: e.breakeven.unit === 'r' ? 10 : 50, step: 0.25, paths: ['exits.breakeven.value'] });
  return out;
}

export const valueAt = (s: Strategy, path: string) => at(s, path) as number;

/** Counts the rules in use (for the overfitting score and the summary line). */
export function ruleCount(s: Strategy): number {
  const count = (g: RuleGroup): number => g.items.reduce((a, it) => a + (it.type === 'rule' ? 1 : count(it)), 0);
  const longOn = s.side !== 'short';
  const shortOn = s.side !== 'long';
  return (longOn ? count(s.longEntry) + count(s.longExit) : 0) + (shortOn ? count(s.shortEntry) + count(s.shortExit) : 0) + count(s.filter);
}

/** Problems that would make a backtest meaningless, in plain words. */
export function problems(s: Strategy): string[] {
  const out: string[] = [];
  const long = s.side !== 'short';
  const short = s.side !== 'long';
  if (long && !s.longEntry.items.length) out.push('Add at least one long entry rule.');
  if (short && !s.shortEntry.items.length) out.push('Add at least one short entry rule.');
  const hasExit = (g: RuleGroup) => g.items.length > 0;
  const anyExit = s.exits.stop.on || s.exits.trail.on || s.exits.targets.on || s.exits.time.on || (long && hasExit(s.longExit)) || (short && hasExit(s.shortExit)) || s.side === 'both';
  if (!anyExit) out.push('Nothing ever closes a trade. Add an exit rule, a stop, a target or a time exit.');
  if (s.sizing.mode === 'risk' && !s.exits.stop.on) out.push('Risk-based sizing needs a stop loss; until one is set, trades use the full account.');
  if (s.exits.targets.on) {
    const total = s.exits.targets.levels.reduce((a, l) => a + l.size, 0);
    if (Math.round(total) !== 100) out.push(`Take-profit sizes add up to ${total}%; the last level closes whatever is left.`);
    if (s.exits.targets.levels.some((l) => l.unit === 'r') && !s.exits.stop.on) out.push('Targets in R need a stop loss to measure R; they are skipped without one.');
  }
  return out;
}
