import { BarChart3, Code2, FlaskConical, Radio, RefreshCw, SlidersHorizontal, Smartphone, Swords } from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import { AssetIcon, AssetPicker } from './components/AssetPicker';
import { Builder } from './components/Builder';
import { createSync } from './components/charts';
import { PriceChart, type PriceChartHandle } from './components/PriceChart';
import { ExitBreakdown, Hero, MonthlyTable, StatsList, TradesTable, type RunResult } from './components/Results';
import { Panel, Seg, Toaster, Toggle } from './components/ui';
import { inputsOf } from './lib/catalog';
import { isNative, TIMEFRAMES, type Timeframe } from './lib/data/core';
import { granularityLabel } from './lib/data/csv';
import { assetTitle } from './lib/data/search';
import { loadSeries, SOURCE_LABEL, timeframesFor, type Asset, type Series } from './lib/data/sources';
import { describe } from './lib/english';
import { runBacktest } from './lib/engine';
import { isoDay } from './lib/format';
import { computeStats } from './lib/metrics';
import { evaluate, problems, type Strategy } from './lib/rules';
import { decodeSession, DEFAULT_SESSION, encodeSession, loadLastSession, saveLastSession, type Session } from './lib/state';
import { CodeView } from './views/CodeView';
import { CompareView } from './views/CompareView';
import { LiveView } from './views/LiveView';
import { RobustnessView } from './views/RobustnessView';

type Mode = 'backtest' | 'lab' | 'compare' | 'live' | 'code';
type View = Mode | 'strategy';

const MODES: { id: Mode; label: string; icon: typeof BarChart3 }[] = [
  { id: 'backtest', label: 'Backtest', icon: BarChart3 },
  { id: 'lab', label: 'Robustness', icon: FlaskConical },
  { id: 'compare', label: 'Compare', icon: Swords },
  { id: 'live', label: 'Live', icon: Radio },
  { id: 'code', label: 'Pine & share', icon: Code2 },
];

function initialSession(): Session {
  const fromHash = location.hash.startsWith('#s=') ? decodeSession(location.hash.slice(3)) : null;
  return fromHash ?? loadLastSession() ?? DEFAULT_SESSION;
}

const yearsAgo = (n: number) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return d.toISOString().slice(0, 10);
};

export default function App() {
  const [session, setSession] = useState<Session>(initialSession);
  const [past, setPast] = useState<Strategy[]>([]);
  const [future, setFuture] = useState<Strategy[]>([]);
  const [custom, setCustom] = useState<Asset[]>([]);
  const [fetched, setFetched] = useState<{ key: string; series: Series | null; error: string | null } | null>(null);
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<View>('backtest');
  const [picker, setPicker] = useState(false);
  const [log, setLog] = useState(false);
  const [tab, setTab] = useState<'trades' | 'monthly' | 'stats' | 'exits' | 'words'>('trades');
  const chartRef = useRef<PriceChartHandle>(null);
  const sync = useMemo(() => createSync(), []);

  const { asset, tf, from, to, strategy } = session;
  const mode: Mode = view === 'strategy' ? 'backtest' : view;

  const setStrategy = useCallback((s: Strategy) => {
    setSession((cur) => {
      setPast((p) => [...p.slice(-40), cur.strategy]);
      setFuture([]);
      return { ...cur, strategy: s };
    });
  }, []);
  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [session.strategy, ...f]);
    setSession((cur) => ({ ...cur, strategy: past[past.length - 1] }));
    setPast((p) => p.slice(0, -1));
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, session.strategy]);
    setSession((cur) => ({ ...cur, strategy: future[0] }));
    setFuture((f) => f.slice(1));
  };

  // Load prices whenever the market or timeframe changes.
  const tfs = timeframesFor(asset);
  const tfLoad: Timeframe = tfs.length && !tfs.includes(tf) ? (tfs.includes('1d') ? '1d' : tfs[0]) : tf;
  const loadKey = `${asset.id}|${tfLoad}|${reload}`;
  useEffect(() => {
    let live = true;
    loadSeries(asset, tfLoad, { refresh: reload > 0 })
      .then((s) => live && setFetched({ key: loadKey, series: s, error: null }))
      .catch((e) => live && setFetched({ key: loadKey, series: null, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [asset, tfLoad, reload, loadKey]);
  const current = fetched?.key === loadKey ? fetched : null;
  const loading = !current;
  const loadError = current?.error ?? null;
  const series = current?.series ?? (fetched?.series && fetched.series.asset.id === asset.id ? fetched.series : null);

  // Remember the session and keep the address shareable.
  useEffect(() => {
    const t = setTimeout(() => {
      saveLastSession(session);
      try {
        history.replaceState(null, '', `#s=${encodeSession(session)}`);
      } catch {
        // some embedded browsers refuse replaceState
      }
    }, 400);
    return () => clearTimeout(t);
  }, [session]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPicker(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const deferred = useDeferredValue(strategy);
  const ready = series && series.asset.id === asset.id && (series.asset.source === 'csv' || series.tf === tfLoad);

  const result = useMemo((): { run: RunResult; plots: ReturnType<typeof evaluate>['plots'] } | { error: string } | null => {
    if (!ready || !series) return null;
    const c = series.candles;
    const issues = problems(deferred).filter((p) => p.startsWith('Add at least'));
    if (issues.length) return { error: issues[0] };
    try {
      const sig = evaluate(deferred, inputsOf(c));
      const fromT = from ? Date.parse(`${from}T00:00:00Z`) / 1000 : -Infinity;
      const toT = to ? Date.parse(`${to}T23:59:59Z`) / 1000 : Infinity;
      let first = c.findIndex((x) => x.time >= fromT);
      if (first < 0) return { error: `No ${asset.display} bars after ${from}.` };
      let last = c.length - 1;
      while (last > 0 && c[last].time > toT) last--;
      first = Math.max(first, sig.warmup);
      if (last - first < 5) return { error: 'Not enough bars between those dates once the indicators have warmed up. Pick an earlier start.' };
      const bt = runBacktest(c, sig, deferred, { start: first, end: last });
      const stats = computeStats(bt, c, series.granularity, deferred.costs.capital);
      return {
        run: { candles: c, granularity: series.granularity, bt, stats, capital: deferred.costs.capital, key: `${asset.id}|${series.tf}|${from}|${to}|${JSON.stringify(deferred)}` },
        plots: sig.plots,
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [ready, series, deferred, from, to, asset.display, asset.id]);

  const run = result && 'run' in result ? result.run : null;
  // The chart shows the tested period plus a little lead-in, not years of history before it.
  const shown = useMemo(() => {
    if (!run || !result || !('plots' in result)) return null;
    const a = Math.max(0, run.bt.start - Math.round((run.bt.end - run.bt.start) * 0.04) - 20);
    const b = run.bt.end + 1;
    return { candles: run.candles.slice(a, b), plots: result.plots.map((p) => ({ ...p, values: p.values.slice(a, b) })) };
  }, [run, result]);
  const intraday = (series?.granularity ?? 86_400) < 86_400;
  const setAsset = (a: Asset) => {
    setSession((s) => ({ ...s, asset: a }));
    setPicker(false);
  };
  const quick = [
    { id: '1', label: '1Y', from: yearsAgo(1) },
    { id: '3', label: '3Y', from: yearsAgo(3) },
    { id: '5', label: '5Y', from: yearsAgo(5) },
    { id: 'all', label: 'All', from: '' },
  ];
  const quickId = to ? '' : (quick.find((q) => q.from === from)?.id ?? '');
  const shareUrl = `${location.origin}${location.pathname}#s=${encodeSession(session)}`;

  const chooseView = (v: View) => {
    setView(v);
    document.querySelector('.main')?.scrollTo({ top: 0 });
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="./favicon.svg" alt="" />
          <span>Edgelab</span>
        </div>
        <button className="asset-btn" onClick={() => setPicker(true)} aria-label={`Market: ${asset.display}. Change market`}>
          <AssetIcon a={asset} />
          <span className="sym">{asset.display}</span>
          <span className="name">{assetTitle(asset)}</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="top-tf">
          {asset.source === 'csv' ? (
            <span className="chip">{series ? granularityLabel(series.granularity) : 'File'}</span>
          ) : (
            <Seg label="Timeframe" value={tfLoad} onChange={(v: Timeframe) => setSession((s) => ({ ...s, tf: v }))} options={TIMEFRAMES.map((t) => ({ id: t.id, label: t.label, disabled: !tfs.includes(t.id), title: !tfs.includes(t.id) ? 'Live in the Android app' : undefined }))} />
          )}
        </div>
        <nav className="modes" role="tablist" aria-label="Mode">
          {MODES.map((m) => (
            <button key={m.id} role="tab" aria-selected={mode === m.id} onClick={() => chooseView(m.id)}>
              <m.icon />
              <span>{m.label}</span>
            </button>
          ))}
        </nav>
        {isNative() ? null : (
          <a className="get-app" href="./Edgelab.apk" download="Edgelab.apk" title="Download the Android app (APK)">
            <Smartphone />
            <span>Android app</span>
          </a>
        )}
      </header>

      <div className="body" data-view={view}>
        <aside className="rail" aria-label="Strategy">
          <Builder strategy={strategy} onChange={setStrategy} onCode={() => chooseView('code')} canUndo={past.length > 0} canRedo={future.length > 0} onUndo={undo} onRedo={redo} />
        </aside>
        <main className="main">
          {mode === 'backtest' || mode === 'lab' ? (
            <div className="main-inner" style={{ marginBottom: 18 }}>
              <div className="toolbar">
                <span className="status">
                  <span className={`dot ${loadError ? 'off' : series?.live ? 'live' : 'warn'}`} />
                  {loading ? 'Loading prices…' : loadError ? 'No data' : series ? `${SOURCE_LABEL[series.asset.source]}${series.live ? ' · live' : ''} · ${series.candles.length.toLocaleString('en-US')} bars${series.note ? ` · ${series.note}` : ''}` : ''}
                </span>
                {asset.source !== 'csv' ? (
                  <button className="icon-btn sm" title="Reload prices" aria-label="Reload prices" onClick={() => setReload((r) => r + 1)}>
                    <RefreshCw />
                  </button>
                ) : null}
                <span className="grow" />
                <Seg label="Period" value={quickId} onChange={(id) => setSession((s) => ({ ...s, from: quick.find((q) => q.id === id)!.from, to: '' }))} options={quick.map((q) => ({ id: q.id, label: q.label }))} />
                <input className="input date" type="date" aria-label="Start date" value={from} max={to || undefined} onChange={(e) => setSession((s) => ({ ...s, from: e.target.value }))} />
                <span className="muted to-date">to</span>
                <input className="input date to-date" type="date" aria-label="End date" value={to} min={from || undefined} onChange={(e) => setSession((s) => ({ ...s, to: e.target.value }))} />
              </div>
              {loadError ? <div className="note bad">{loadError}</div> : null}
              {result && 'error' in result ? <div className="note warn">{result.error}</div> : null}
            </div>
          ) : null}

          {mode === 'backtest' ? (
            run && result && 'plots' in result ? (
              <div className="main-inner">
                <Hero r={run} title={`${strategy.name} · ${asset.display} ${asset.source === 'csv' ? granularityLabel(run.granularity) : tf}`} />
                <Panel
                  title="Price and trades"
                  sub={`${run.bt.trades.length} trades · arrows are entries, dots are exits`}
                  actions={
                    <div className="field">
                      <span className="label">Log scale</span>
                      <Toggle label="Log scale" on={log} onChange={setLog} />
                    </div>
                  }
                  bodyClass="panel-body"
                >
                  <PriceChart ref={chartRef} candles={shown!.candles} plots={shown!.plots} trades={run.bt.trades} intraday={intraday} log={log} sync={sync} fitKey={`${asset.id}|${tf}|${from}|${to}`} />
                </Panel>
                <section className="panel">
                  <div className="tabs" role="tablist">
                    {(
                      [
                        ['trades', `Trades (${run.bt.trades.length})`],
                        ['monthly', 'Monthly returns'],
                        ['stats', 'All statistics'],
                        ['exits', 'How trades ended'],
                        ['words', 'Rules in words'],
                      ] as const
                    ).map(([id, label]) => (
                      <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="panel-body">
                    {tab === 'trades' ? <TradesTable trades={run.bt.trades} granularity={run.granularity} onPick={(t) => chartRef.current?.focus(t.entryTime, t.exitTime)} /> : null}
                    {tab === 'monthly' ? <MonthlyTable r={run} /> : null}
                    {tab === 'stats' ? <StatsList st={run.stats} /> : null}
                    {tab === 'exits' ? <ExitBreakdown st={run.stats} /> : null}
                    {tab === 'words' ? <p className="prose">{describe(strategy)}</p> : null}
                  </div>
                </section>
                <p className="muted" style={{ fontSize: 12, textAlign: 'center' }}>
                  Signals use closed bars and fill at the next open. Past results don’t promise future ones. Data: {SOURCE_LABEL[asset.source]}, through {isoDay(run.candles[run.bt.end].time)}.
                </p>
              </div>
            ) : !loadError && !(result && 'error' in result) ? (
              <div className="main-inner">
                <div className="panel empty">
                  <div className="spinner" />
                  <p>Loading {asset.display}…</p>
                </div>
              </div>
            ) : null
          ) : null}

          {mode === 'lab' ? run ? <RobustnessView strategy={deferred} run={run} onApply={setStrategy} /> : null : null}
          {mode === 'compare' ? (
            <CompareView
              strategy={strategy}
              asset={asset}
              tf={tf}
              from={from}
              to={to}
              custom={custom}
              onCustom={(a) => setCustom((c) => [...c.filter((x) => x.id !== a.id), a])}
              onOpen={(s, a, t) => {
                setStrategy(s);
                setSession((cur) => ({ ...cur, asset: a, tf: t }));
                chooseView('backtest');
              }}
            />
          ) : null}
          {mode === 'live' ? <LiveView strategy={strategy} asset={asset} tf={tf} /> : null}
          {mode === 'code' ? <CodeView strategy={strategy} shareUrl={shareUrl} from={from} onImport={setStrategy} /> : null}
        </main>
      </div>

      <nav className="tabbar" role="tablist" aria-label="Sections">
        {(
          [
            ['strategy', 'Strategy', SlidersHorizontal],
            ['backtest', 'Results', BarChart3],
            ['lab', 'Lab', FlaskConical],
            ['compare', 'Compare', Swords],
            ['live', 'Live', Radio],
          ] as const
        ).map(([id, label, Icon]) => (
          <button key={id} role="tab" aria-selected={view === id || (id === 'backtest' && view === 'code')} onClick={() => chooseView(id)}>
            <Icon />
            {label}
          </button>
        ))}
      </nav>

      {picker ? <AssetPicker onPick={setAsset} onClose={() => setPicker(false)} custom={custom} onCustom={(a) => setCustom((c) => [...c.filter((x) => x.id !== a.id), a])} /> : null}
      <Toaster />
    </div>
  );
}
