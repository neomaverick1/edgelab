import { AlertTriangle, BookOpen, Brain, Check, Clock, Code2, CopyPlus, FilePlus2, HelpCircle, Plus, Redo2, Save, Sparkles, Trash2, Undo2, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { INDICATORS, SOURCES, indicator, type Group as IndGroup, type Source } from '../lib/catalog';
import { describe as describeStrategy, normalizeEnglish, parseEnglish, readCondition, type ParseResult } from '../lib/english';
import { aiDownloaded, useAi } from './useAi';
import { ENGLISH_EXAMPLES, PRESETS } from '../lib/presets';
import {
  blankStrategy,
  CMPS,
  group,
  ind,
  num,
  operandLabel,
  problems,
  rule,
  type Cmp,
  type DistUnit,
  type IndOperand,
  type Operand,
  type Rule,
  type RuleGroup,
  type Strategy,
} from '../lib/rules';
import { loadLibrary, removeFromLibrary, saveToLibrary, type Saved } from '../lib/state';
import { Modal, NumberInput, Seg, Toggle } from './ui';
import { toast } from './toast';

type SectionKey = 'longEntry' | 'longExit' | 'shortEntry' | 'shortExit' | 'filter';

interface Props {
  strategy: Strategy;
  onChange: (s: Strategy) => void;
  onCode: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export function Builder({ strategy: s, onChange, onCode, canUndo, canRedo, onUndo, onRedo }: Props) {
  const [library, setLibrary] = useState(false);
  const edit = (fn: (draft: Strategy) => void) => {
    const next = structuredClone(s);
    fn(next);
    onChange(next);
  };
  const issues = problems(s);
  const long = s.side !== 'short';
  const short = s.side !== 'long';

  return (
    <>
      <div className="rail-head">
        <div className="name-row">
          <input className="name-input" value={s.name} aria-label="Strategy name" onChange={(e) => edit((d) => (d.name = e.target.value))} />
          <button className="icon-btn" title="Undo" aria-label="Undo" disabled={!canUndo} onClick={onUndo}>
            <Undo2 />
          </button>
          <button className="icon-btn" title="Redo" aria-label="Redo" disabled={!canRedo} onClick={onRedo}>
            <Redo2 />
          </button>
        </div>
        <div className="side-row">
          <Seg
            label="Direction"
            value={s.side}
            onChange={(v) => edit((d) => (d.side = v))}
            options={[
              { id: 'long', label: 'Long only' },
              { id: 'short', label: 'Short only' },
              { id: 'both', label: 'Long & short' },
            ]}
          />
          <div style={{ display: 'flex', gap: 2 }}>
            <button className="icon-btn" title="Strategy library" aria-label="Strategy library" onClick={() => setLibrary(true)}>
              <BookOpen />
            </button>
            <button
              className="icon-btn"
              title="Save to my strategies"
              aria-label="Save to my strategies"
              onClick={() => {
                saveToLibrary(s);
                toast(`Saved “${s.name}” on this device`);
              }}
            >
              <Save />
            </button>
            <button className="icon-btn" title="Start from scratch" aria-label="Start from scratch" onClick={() => onChange(blankStrategy())}>
              <FilePlus2 />
            </button>
            <button className="icon-btn" title="Pine Script and sharing" aria-label="Pine Script and sharing" onClick={onCode}>
              <Code2 />
            </button>
          </div>
        </div>
      </div>

      <EnglishBox strategy={s} onApply={onChange} />

      {long ? <Section title="Buy when" sub="Long entry" k="longEntry" s={s} edit={edit} /> : null}
      {long ? <Section title="Sell when" sub="Long exit rule" k="longExit" s={s} edit={edit} optional /> : null}
      {short ? <Section title="Short when" sub="Short entry" k="shortEntry" s={s} edit={edit} /> : null}
      {short ? <Section title="Cover when" sub="Short exit rule" k="shortExit" s={s} edit={edit} optional /> : null}
      <Section title="Only trade when" sub="Filter for new entries" k="filter" s={s} edit={edit} optional />

      <ExitsEditor s={s} edit={edit} />
      <SizingEditor s={s} edit={edit} />
      <CostsEditor s={s} edit={edit} />

      {issues.length ? (
        <div className="sec" style={{ display: 'grid', gap: 8 }}>
          {issues.map((p) => (
            <div className="note warn" key={p}>
              <AlertTriangle />
              {p}
            </div>
          ))}
        </div>
      ) : null}
      <div style={{ height: 40 }} />
      {library ? (
        <Library
          onClose={() => setLibrary(false)}
          onOpen={(x) => {
            onChange(structuredClone(x));
            setLibrary(false);
            toast(`Opened “${x.name}”`);
          }}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------

interface AiRead {
  from: string; // the part the rule reader couldn't understand
  to: string | null; // the AI's rewrite, when the reader understands it
  reads: string | null; // how the reader understands the rewrite
  keep: boolean;
}

function EnglishBox({ strategy, onApply }: { strategy: Strategy; onApply: (s: Strategy) => void }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [source, setSource] = useState('');
  const [reads, setReads] = useState<AiRead[] | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const ai = useAi();
  const asked = useRef('');

  const apply = (r: ParseResult) => {
    setResult(r);
    if (r.strategy.longEntry.items.length || r.strategy.shortEntry.items.length) {
      const generic = strategy.name === 'New strategy' || strategy.name === 'From English' || PRESETS.some((p) => p.name === strategy.name || p.strategy.name === strategy.name);
      r.strategy.name = generic ? 'My strategy' : strategy.name;
      onApply(r.strategy);
    }
  };
  const build = (value = text) => {
    if (!value.trim()) return;
    setReads(null);
    setSource(value);
    asked.current = '';
    apply(parseEnglish(value, strategy));
  };

  // Parts the reader couldn't understand go to the built-in AI. It starts by itself once the model is on this device.
  const unknown = result?.unknown ?? [];
  const askAi = async () => {
    const key = source + '|' + unknown.join('|');
    if (asked.current === key) return;
    asked.current = key;
    const out: AiRead[] = [];
    for (const u of unknown) {
      setReading(u);
      const to = await ai.rewrite(u);
      const readsAs = to ? readCondition(to) : null;
      out.push({ from: u, to: readsAs ? to : null, reads: readsAs, keep: !!readsAs });
    }
    setReading(null);
    setReads(out);
  };
  useEffect(() => {
    if (!unknown.length || reads) return;
    if (ai.state === 'off' && aiDownloaded()) ai.start();
    if (ai.state !== 'ready') return;
    const t = setTimeout(() => void askAi(), 0);
    return () => clearTimeout(t);
  });

  const addReads = () => {
    if (!reads) return;
    let norm = normalizeEnglish(source);
    for (const r of reads) if (r.keep && r.to) norm = norm.replace(r.from, r.to.toLowerCase());
    setReads(null);
    asked.current = source + '|done';
    apply(parseEnglish(norm, strategy));
    toast('Rules added');
  };

  const kept = reads?.filter((r) => r.keep && r.to).length ?? 0;
  return (
    <div className="sec">
      <div className="sec-head">
        <h3>Describe it in plain English</h3>
        <div className="end">
          <button className="btn ghost sm" title="Write the current rules as a sentence" onClick={() => setText(describeStrategy(strategy))}>
            <Wand2 /> Current rules
          </button>
        </div>
      </div>
      <div className="english">
        <div className="english-inner">
          <textarea
            value={text}
            aria-label="Strategy in plain English"
            placeholder="Buy when RSI is under 30 and price is above the 200 EMA. Sell when RSI crosses above 60. Stop 2 ATR, take profit 8%."
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) build();
            }}
          />
          <div className="bar">
            <span className="muted" style={{ fontSize: 12 }}>
              {ai.state === 'ready' ? 'Built-in AI ready · works offline' : 'Works offline'}
            </span>
            <button className="btn gold sm" onClick={() => build()} disabled={!text.trim()}>
              <Sparkles /> Build rules
            </button>
          </div>
        </div>
      </div>
      {result ? (
        <div className="read">
          <ul>
            {result.understood.map((u) => (
              <li key={u}>
                <Check className="up" />
                {u}
              </li>
            ))}
            {!reads && !reading
              ? unknown.map((u) => (
                  <li key={u} style={{ color: '#8f2236' }}>
                    <HelpCircle />
                    Couldn’t read “{u}”.
                  </li>
                ))
              : null}
          </ul>
          {unknown.length && !reads ? (
            <div className="ai-box">
              <Brain />
              {ai.state === 'off' || ai.state === 'error' ? (
                <div>
                  <b>Let the built-in AI read {unknown.length === 1 ? 'this part' : `these ${unknown.length} parts`}</b>
                  <p className="muted">It runs on this device, so nothing leaves your phone. The first time it downloads its model (about 1.2 GB on Wi-Fi), then it works offline.</p>
                  {ai.state === 'error' ? <p style={{ color: '#8f2236' }}>The AI couldn’t start: {ai.error}</p> : null}
                  <button className="btn gold sm" onClick={ai.start}>
                    <Brain /> {ai.state === 'error' ? 'Try again' : 'Download and read'}
                  </button>
                </div>
              ) : ai.state === 'loading' ? (
                <div style={{ flex: 1 }}>
                  <b>{aiDownloaded() ? 'Starting the built-in AI…' : `Downloading the built-in AI… ${Math.round(ai.progress * 100)}%`}</b>
                  <div className="progress" style={{ marginTop: 8 }}>
                    <i style={{ width: `${Math.round(ai.progress * 100)}%` }} />
                  </div>
                </div>
              ) : (
                <div>
                  <b>Reading “{reading ?? unknown[0]}”…</b>
                  <p className="muted">The built-in AI is working on this device.</p>
                </div>
              )}
            </div>
          ) : null}
          {reads ? (
            <div className="ai-box col">
              <b>
                <Brain /> Check how the AI read it
              </b>
              {reads.map((r, i) => (
                <label key={r.from} className={`ai-read${r.to ? '' : ' bad'}`}>
                  <input type="checkbox" checked={r.keep} disabled={!r.to} onChange={(e) => setReads(reads.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))} />
                  <span>
                    <span className="muted">“{r.from}”</span>
                    <br />
                    {r.reads ? (
                      <b>{r.reads}</b>
                    ) : (
                      <span style={{ color: '#8f2236' }}>
                        <AlertTriangle /> Couldn’t work this one out. Try other words.
                      </span>
                    )}
                  </span>
                </label>
              ))}
              <div className="bar">
                <button className="btn ghost sm" onClick={() => setReads([])}>
                  Skip
                </button>
                <button className="btn gold sm" onClick={addReads} disabled={!kept}>
                  <Check /> Add {kept} {kept === 1 ? 'rule' : 'rules'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="examples">
          {ENGLISH_EXAMPLES.slice(0, 3).map((e, i) => (
            <button
              key={e}
              title={e}
              onClick={() => {
                setText(e);
                build(e);
              }}
            >
              {['RSI dip with ATR stop', 'EMA cross, long & short', 'Breakout with 2 targets'][i]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

const DEFAULT_RULE: Record<SectionKey, () => Rule> = {
  longEntry: () => rule(ind('price'), 'xup', ind('ema', [50])),
  longExit: () => rule(ind('price'), 'xdn', ind('ema', [50])),
  shortEntry: () => rule(ind('price'), 'xdn', ind('ema', [50])),
  shortExit: () => rule(ind('price'), 'xup', ind('ema', [50])),
  filter: () => rule(ind('adx', [14], { out: 'adx' }), 'gt', num(20)),
};

function Section({ title, sub, k, s, edit, optional }: { title: string; sub: string; k: SectionKey; s: Strategy; edit: (fn: (d: Strategy) => void) => void; optional?: boolean }) {
  const g = s[k];
  return (
    <div className="sec">
      <div className="sec-head">
        <h3>{title}</h3>
        <span className="sub">{optional && !g.items.length ? `${sub} · optional` : sub}</span>
      </div>
      <GroupEditor
        g={g}
        path={[]}
        onChange={(fn) =>
          edit((d) => {
            fn(d[k]);
          })
        }
        makeRule={DEFAULT_RULE[k]}
      />
    </div>
  );
}

function GroupEditor({ g, path, onChange, makeRule, nested }: { g: RuleGroup; path: number[]; onChange: (fn: (root: RuleGroup) => void) => void; makeRule: () => Rule; nested?: boolean }) {
  const resolve = (root: RuleGroup) => path.reduce<RuleGroup>((acc, i) => acc.items[i] as RuleGroup, root);
  const word = g.mode === 'all' ? 'and' : 'or';
  return (
    <div className={`group${nested ? ' nested' : ''}`}>
      {g.items.length > 1 ? (
        <div className="group-mode">
          <Seg
            label="How the rules combine"
            value={g.mode}
            onChange={(m) => onChange((root) => (resolve(root).mode = m))}
            options={[
              { id: 'all', label: 'All of these' },
              { id: 'any', label: 'Any of these' },
            ]}
          />
        </div>
      ) : null}
      {g.items.map((it, i) => (
        <div key={i} style={{ display: 'grid', gap: 4 }}>
          {i > 0 ? <span className="joiner">{word}</span> : null}
          {it.type === 'rule' ? (
            <RuleRow
              r={it}
              onChange={(next) => onChange((root) => (resolve(root).items[i] = next))}
              onRemove={() => onChange((root) => resolve(root).items.splice(i, 1))}
              onDuplicate={() => onChange((root) => resolve(root).items.splice(i + 1, 0, structuredClone(it)))}
            />
          ) : (
            <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <GroupEditor g={it} path={[...path, i]} onChange={onChange} makeRule={makeRule} nested />
              </div>
              <button className="icon-btn sm" aria-label="Remove group" title="Remove group" onClick={() => onChange((root) => resolve(root).items.splice(i, 1))}>
                <Trash2 />
              </button>
            </div>
          )}
        </div>
      ))}
      <div className="add-row">
        <button className="btn sm" onClick={() => onChange((root) => resolve(root).items.push(makeRule()))}>
          <Plus /> Rule
        </button>
        {!nested ? (
          <button className="btn sm" title={`Add a group whose rules combine with “${g.mode === 'all' ? 'or' : 'and'}”`} onClick={() => onChange((root) => resolve(root).items.push(group(g.mode === 'all' ? 'any' : 'all', [makeRule(), makeRule()])))}>
            <Plus /> {g.mode === 'all' ? '“Or” group' : '“And” group'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function RuleRow({ r, onChange, onRemove, onDuplicate }: { r: Rule; onChange: (r: Rule) => void; onRemove: () => void; onDuplicate: () => void }) {
  const [picking, setPicking] = useState<'a' | 'b' | null>(null);
  const cmp = CMPS.find((c) => c.id === r.cmp)!;
  return (
    <div className="rule">
      <button className="op" onClick={() => setPicking('a')} title="Change">
        {operandLabel(r.a)}
      </button>
      <select className="cmp" aria-label="Comparison" value={r.cmp} onChange={(e) => onChange({ ...r, cmp: e.target.value as Cmp })}>
        {CMPS.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      {cmp.unary ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, color: 'var(--ink-2)' }}>
          vs
          <NumberInput label="Bars back" value={r.bars ?? 1} min={1} max={200} width={52} onChange={(v) => onChange({ ...r, bars: v })} />
          bars ago
        </span>
      ) : (
        <button className={`op${r.b.kind === 'num' ? ' num' : ''}`} onClick={() => setPicking('b')} title="Change">
          {operandLabel(r.b)}
        </button>
      )}
      {r.within && r.within > 1 ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, color: 'var(--ink-2)' }}>
          in last
          <NumberInput label="Within bars" value={r.within} min={1} max={200} width={52} onChange={(v) => onChange({ ...r, within: v })} />
          bars
        </span>
      ) : null}
      <span className="end">
        {!cmp.unary ? (
          <button className="icon-btn sm" title={r.within && r.within > 1 ? 'Only on this bar' : 'Allow it to have happened in the last few bars'} aria-label="Within bars" onClick={() => onChange({ ...r, within: r.within && r.within > 1 ? undefined : 3 })}>
            <Clock />
          </button>
        ) : null}
        <button className="icon-btn sm" title="Duplicate" aria-label="Duplicate rule" onClick={onDuplicate}>
          <CopyPlus />
        </button>
        <button className="icon-btn sm" title="Remove" aria-label="Remove rule" onClick={onRemove}>
          <Trash2 />
        </button>
      </span>
      {picking ? (
        <OperandPicker
          value={picking === 'a' ? r.a : r.b}
          allowNumber={picking === 'b'}
          hintFor={picking === 'b' ? r.a : undefined}
          onClose={() => setPicking(null)}
          onPick={(o) => {
            if (picking === 'a' && o.kind === 'ind') {
              const def = indicator(o.id);
              // When the left side becomes an oscillator, offer its usual level on the right.
              const b = def.hint !== undefined && r.b.kind === 'ind' && r.b.id === 'price' ? num(def.hint) : r.b.kind === 'num' && def.hint !== undefined && r.a.id !== o.id ? num(def.hint) : r.b;
              onChange({ ...r, a: o, b });
            } else onChange({ ...r, b: o });
            setPicking(null);
          }}
        />
      ) : null}
    </div>
  );
}

const GROUPS: (IndGroup | 'Number')[] = ['Price', 'Trend', 'Momentum', 'Volatility', 'Volume', 'Pattern', 'Time', 'Number'];

function OperandPicker({ value, allowNumber, hintFor, onClose, onPick }: { value: Operand; allowNumber: boolean; hintFor?: IndOperand; onClose: () => void; onPick: (o: Operand) => void }) {
  const [draft, setDraft] = useState<Operand>(structuredClone(value));
  const [tab, setTab] = useState<IndGroup | 'Number'>(value.kind === 'num' ? 'Number' : indicator(value.id).group);
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    return INDICATORS.filter((d) => (query ? `${d.name} ${d.short}`.toLowerCase().includes(query) : d.group === tab));
  }, [q, tab]);
  const def = draft.kind === 'ind' ? indicator(draft.id) : null;
  const choose = (id: string) => {
    const d = indicator(id);
    setDraft(draft.kind === 'ind' && draft.id === id ? draft : ind(id, d.params.map((p) => p.def)));
  };
  return (
    <Modal title="Choose a value" onClose={onClose} wide>
      <div className="search">
        <input placeholder="Search indicators: rsi, bollinger, supertrend…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search indicators" />
      </div>
      <div className="picker" style={{ flex: 1, minHeight: 0 }}>
        <nav aria-label="Indicator groups">
          {GROUPS.filter((g) => g !== 'Number' || allowNumber).map((g) => (
            <button
              key={g}
              aria-pressed={!q && tab === g}
              onClick={() => {
                setQ('');
                setTab(g);
                if (g === 'Number' && draft.kind !== 'num') setDraft(num(hintFor ? (indicator(hintFor.id).hint ?? 0) : 0));
              }}
            >
              {g}
            </button>
          ))}
        </nav>
        <div className="list">
          {tab === 'Number' && !q ? (
            <div style={{ padding: 10, display: 'grid', gap: 10 }}>
              <div className="field">
                <label>Value</label>
                <NumberInput label="Number" value={draft.kind === 'num' ? draft.v : 0} step={1} width={120} onChange={(v) => setDraft(num(v))} />
              </div>
              {hintFor && indicator(hintFor.id).levels?.length ? (
                <div className="examples">
                  {indicator(hintFor.id).levels!.map((lv) => (
                    <button key={lv} onClick={() => setDraft(num(lv))}>
                      {lv}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            list.map((d) => (
              <button key={d.id} onClick={() => choose(d.id)} style={draft.kind === 'ind' && draft.id === d.id ? { background: 'var(--gold-soft)' } : undefined}>
                <b>{d.name}</b>
                <span>{d.outputs.length > 1 ? d.outputs.map((o) => o.label.replace(/\s*\(.*\)$/, '')).join(' · ') : d.short}</span>
              </button>
            ))
          )}
        </div>
      </div>
      {draft.kind === 'ind' && def ? (
        <div className="op-edit">
          {def.outputs.length > 1 ? (
            <div className="field">
              <label>{def.id === 'pattern' ? 'Pattern' : 'Line'}</label>
              <select className="select" value={draft.out ?? def.outputs[0].key} onChange={(e) => setDraft({ ...draft, out: e.target.value })}>
                {def.outputs.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {def.params.map((p, k) => (
            <div className="field" key={p.label}>
              <label>{p.label}</label>
              <NumberInput label={p.label} value={draft.p[k]} min={p.min} max={p.max} step={p.step} onChange={(v) => setDraft({ ...draft, p: draft.p.map((x, j) => (j === k ? v : x)) })} />
            </div>
          ))}
          {def.source ? (
            <div className="field">
              <label>Price</label>
              <select className="select" value={draft.src ?? def.source} onChange={(e) => setDraft({ ...draft, src: e.target.value as Source })}>
                {SOURCES.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="field">
            <label>Value from</label>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <NumberInput label="Bars ago" value={draft.ago ?? 0} min={0} max={500} width={60} onChange={(v) => setDraft({ ...draft, ago: v || undefined })} />
              <span className="unit">bars ago</span>
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" onClick={() => onPick(draft)}>
              Use {operandLabel(draft)}
            </button>
          </div>
        </div>
      ) : (
        <div className="op-edit">
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" onClick={() => onPick(draft)}>
              Use {operandLabel(draft)}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------------------------

const UNIT_OPTS = [
  { id: 'pct' as const, label: '%' },
  { id: 'atr' as const, label: '× ATR' },
];

function ExitsEditor({ s, edit }: { s: Strategy; edit: (fn: (d: Strategy) => void) => void }) {
  const e = s.exits;
  const anyAtr = (e.stop.on && e.stop.unit === 'atr') || (e.trail.on && e.trail.unit === 'atr') || (e.targets.on && e.targets.levels.some((l) => l.unit === 'atr'));
  return (
    <div className="sec">
      <div className="sec-head">
        <h3>Exits</h3>
        <span className="sub">Checked inside every bar, stop first</span>
      </div>

      <div className={`exit-card${e.stop.on ? '' : ' off'}`}>
        <div className="field">
          <label>Stop loss</label>
          <Toggle label="Stop loss" on={e.stop.on} onChange={(v) => edit((d) => (d.exits.stop.on = v))} />
        </div>
        {e.stop.on ? (
          <div className="field">
            <span className="label">Distance</span>
            <span className="inline">
              <NumberInput label="Stop distance" value={e.stop.value} min={0.05} max={95} step={e.stop.unit === 'atr' ? 0.25 : 0.5} onChange={(v) => edit((d) => (d.exits.stop.value = v))} />
              <Seg label="Stop unit" value={e.stop.unit} options={UNIT_OPTS} onChange={(v: DistUnit) => edit((d) => (d.exits.stop.unit = v))} />
            </span>
          </div>
        ) : null}
      </div>

      <div className={`exit-card${e.trail.on ? '' : ' off'}`}>
        <div className="field">
          <label>Trailing stop</label>
          <Toggle label="Trailing stop" on={e.trail.on} onChange={(v) => edit((d) => (d.exits.trail.on = v))} />
        </div>
        {e.trail.on ? (
          <>
            <div className="field">
              <span className="label">Distance from best price</span>
              <span className="inline">
                <NumberInput label="Trail distance" value={e.trail.value} min={0.05} max={95} step={e.trail.unit === 'atr' ? 0.25 : 0.5} onChange={(v) => edit((d) => (d.exits.trail.value = v))} />
                <Seg label="Trail unit" value={e.trail.unit} options={UNIT_OPTS} onChange={(v: DistUnit) => edit((d) => (d.exits.trail.unit = v))} />
              </span>
            </div>
            <div className="field">
              <span className="label">
                Start after a gain of <span className="hint">0 = at once</span>
              </span>
              <span className="inline">
                <NumberInput label="Activate after" value={e.trail.activate} min={0} max={500} step={0.5} onChange={(v) => edit((d) => (d.exits.trail.activate = v))} />
                <span className="unit">%</span>
              </span>
            </div>
          </>
        ) : null}
      </div>

      <div className={`exit-card${e.targets.on ? '' : ' off'}`}>
        <div className="field">
          <label>Take profit</label>
          <Toggle label="Take profit" on={e.targets.on} onChange={(v) => edit((d) => (d.exits.targets.on = v))} />
        </div>
        {e.targets.on ? (
          <div className="ladder">
            {e.targets.levels.map((l, i) => (
              <div className="ladder-row" key={i}>
                <NumberInput label={`Target ${i + 1} size`} value={l.size} min={1} max={100} width={58} onChange={(v) => edit((d) => (d.exits.targets.levels[i].size = v))} />
                <span>% at</span>
                <NumberInput label={`Target ${i + 1} distance`} value={l.value} min={0.05} max={1000} step={0.25} width={62} onChange={(v) => edit((d) => (d.exits.targets.levels[i].value = v))} />
                <select className="select" style={{ height: 30, fontSize: 12.5 }} aria-label="Target unit" value={l.unit} onChange={(ev) => edit((d) => (d.exits.targets.levels[i].unit = ev.target.value as 'pct' | 'atr' | 'r'))}>
                  <option value="pct">%</option>
                  <option value="atr">× ATR</option>
                  <option value="r">R</option>
                </select>
                {e.targets.levels.length > 1 ? (
                  <button className="icon-btn sm" aria-label="Remove target" onClick={() => edit((d) => d.exits.targets.levels.splice(i, 1))}>
                    <Trash2 />
                  </button>
                ) : null}
              </div>
            ))}
            {e.targets.levels.length < 4 ? (
              <button
                className="btn sm"
                style={{ justifySelf: 'start', borderStyle: 'dashed' }}
                onClick={() =>
                  edit((d) => {
                    const lv = d.exits.targets.levels;
                    const last = lv[lv.length - 1];
                    const share = Math.round(100 / (lv.length + 1));
                    lv.forEach((x) => (x.size = share));
                    lv.push({ unit: last.unit, value: +(last.value * 2).toFixed(2), size: 100 - share * lv.length });
                  })
                }
              >
                <Plus /> Scale out at another level
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className={`exit-card${e.breakeven.on ? '' : ' off'}`}>
        <div className="field">
          <label>Move stop to breakeven</label>
          <Toggle label="Breakeven" on={e.breakeven.on} onChange={(v) => edit((d) => (d.exits.breakeven.on = v))} />
        </div>
        {e.breakeven.on ? (
          <div className="field">
            <span className="label">After a gain of</span>
            <span className="inline">
              <NumberInput label="Breakeven trigger" value={e.breakeven.value} min={0.1} max={100} step={0.25} onChange={(v) => edit((d) => (d.exits.breakeven.value = v))} />
              <Seg
                label="Breakeven unit"
                value={e.breakeven.unit}
                options={[
                  { id: 'pct', label: '%' },
                  { id: 'r', label: 'R' },
                ]}
                onChange={(v) => edit((d) => (d.exits.breakeven.unit = v))}
              />
            </span>
          </div>
        ) : null}
      </div>

      <div className={`exit-card${e.time.on ? '' : ' off'}`}>
        <div className="field">
          <label>Time exit</label>
          <Toggle label="Time exit" on={e.time.on} onChange={(v) => edit((d) => (d.exits.time.on = v))} />
        </div>
        {e.time.on ? (
          <div className="field">
            <span className="label">Close after</span>
            <span className="inline">
              <NumberInput label="Bars held" value={e.time.bars} min={1} max={5000} onChange={(v) => edit((d) => (d.exits.time.bars = v))} />
              <span className="unit">bars</span>
            </span>
          </div>
        ) : null}
      </div>
      {anyAtr ? (
        <div className="field">
          <span className="label">ATR length</span>
          <NumberInput label="ATR length" value={e.atrLength} min={1} max={200} onChange={(v) => edit((d) => (d.exits.atrLength = v))} />
        </div>
      ) : null}
    </div>
  );
}

function SizingEditor({ s, edit }: { s: Strategy; edit: (fn: (d: Strategy) => void) => void }) {
  const z = s.sizing;
  return (
    <div className="sec">
      <div className="sec-head">
        <h3>Position size</h3>
      </div>
      <div className="field">
        <Seg
          label="Sizing"
          value={z.mode}
          onChange={(v) =>
            edit((d) => {
              d.sizing.mode = v;
              d.sizing.value = v === 'risk' ? 1 : v === 'cash' ? 1000 : 100;
            })
          }
          options={[
            { id: 'equity', label: '% of account' },
            { id: 'risk', label: 'Risk per trade' },
            { id: 'cash', label: 'Fixed $' },
          ]}
        />
      </div>
      <div className="field">
        <span className="label">{z.mode === 'equity' ? 'Use' : z.mode === 'risk' ? 'Risk (needs a stop loss)' : 'Amount'}</span>
        <span className="inline">
          {z.mode === 'cash' ? <span className="unit">$</span> : null}
          <NumberInput label="Size" value={z.value} min={0.01} max={z.mode === 'cash' ? 1e9 : 1000} step={z.mode === 'risk' ? 0.25 : 5} onChange={(v) => edit((d) => (d.sizing.value = v))} width={z.mode === 'cash' ? 96 : undefined} />
          {z.mode !== 'cash' ? <span className="unit">%</span> : null}
        </span>
      </div>
      <div className="field">
        <span className="label">Leverage limit</span>
        <span className="inline">
          <NumberInput label="Leverage" value={z.leverage} min={0.1} max={125} step={0.5} onChange={(v) => edit((d) => (d.sizing.leverage = v))} />
          <span className="unit">×</span>
        </span>
      </div>
      <div className="exit-card" style={{ marginTop: 6 }}>
        <div className="field">
          <label>Scale in when the entry fires again</label>
          <Toggle label="Scale in" on={z.scaleIn.on} onChange={(v) => edit((d) => (d.sizing.scaleIn.on = v))} />
        </div>
        {z.scaleIn.on ? (
          <>
            <div className="field">
              <span className="label">Up to</span>
              <span className="inline">
                <NumberInput label="Adds" value={z.scaleIn.max} min={1} max={10} onChange={(v) => edit((d) => (d.sizing.scaleIn.max = v))} />
                <span className="unit">adds of</span>
                <NumberInput label="Add size" value={z.scaleIn.size} min={1} max={500} step={5} onChange={(v) => edit((d) => (d.sizing.scaleIn.size = v))} />
                <span className="unit">%</span>
              </span>
            </div>
            <div className="field">
              <span className="label">Only while in profit</span>
              <Toggle label="Only in profit" on={z.scaleIn.onlyInProfit} onChange={(v) => edit((d) => (d.sizing.scaleIn.onlyInProfit = v))} />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function CostsEditor({ s, edit }: { s: Strategy; edit: (fn: (d: Strategy) => void) => void }) {
  return (
    <div className="sec">
      <div className="sec-head">
        <h3>Account and costs</h3>
      </div>
      <div className="field">
        <span className="label">Starting capital</span>
        <span className="inline">
          <span className="unit">$</span>
          <NumberInput label="Capital" value={s.costs.capital} min={100} max={1e10} step={1000} width={110} onChange={(v) => edit((d) => (d.costs.capital = v))} />
        </span>
      </div>
      <div className="field">
        <span className="label">Fee per side</span>
        <span className="inline">
          <NumberInput label="Fee" value={s.costs.feePct} min={0} max={5} step={0.01} onChange={(v) => edit((d) => (d.costs.feePct = v))} />
          <span className="unit">%</span>
        </span>
      </div>
      <div className="field">
        <span className="label">Slippage per fill</span>
        <span className="inline">
          <NumberInput label="Slippage" value={s.costs.slippagePct} min={0} max={5} step={0.01} onChange={(v) => edit((d) => (d.costs.slippagePct = v))} />
          <span className="unit">%</span>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

function Library({ onClose, onOpen }: { onClose: () => void; onOpen: (s: Strategy) => void }) {
  const [tab, setTab] = useState<'presets' | 'mine'>('presets');
  const [mine, setMine] = useState<Saved[]>(loadLibrary);
  return (
    <Modal title="Strategy library" onClose={onClose} wide>
      <div className="filters">
        <Seg
          label="Library"
          value={tab}
          onChange={setTab}
          options={[
            { id: 'presets', label: `Classic systems (${PRESETS.length})` },
            { id: 'mine', label: `My strategies (${mine.length})` },
          ]}
        />
      </div>
      <div className="modal-body" style={{ display: 'grid', gap: 2 }}>
        {tab === 'presets'
          ? PRESETS.map((p) => (
              <button key={p.id} className="result" onClick={() => onOpen(p.strategy)} style={{ alignItems: 'flex-start' }}>
                <span style={{ display: 'grid', gap: 2, flex: 1 }}>
                  <b>{p.name}</b>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {p.blurb}
                  </span>
                </span>
                <span className="chip">{p.style}</span>
              </button>
            ))
          : null}
        {tab === 'mine' && !mine.length ? (
          <div className="empty">
            <h3>Nothing saved yet</h3>
            <p>Use the save button next to the strategy name. Strategies stay on this device.</p>
          </div>
        ) : null}
        {tab === 'mine'
          ? mine.map((x) => (
              <div key={x.id} className="result" style={{ cursor: 'default' }}>
                <span style={{ display: 'grid', gap: 2, flex: 1, minWidth: 0 }}>
                  <b>{x.strategy.name}</b>
                  <span className="muted" style={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {describeStrategy(x.strategy)}
                  </span>
                </span>
                <button className="btn sm" onClick={() => onOpen(x.strategy)}>
                  Open
                </button>
                <button className="icon-btn sm" aria-label="Delete" onClick={() => setMine(removeFromLibrary(x.id))}>
                  <Trash2 />
                </button>
              </div>
            ))
          : null}
      </div>
    </Modal>
  );
}
