import { useEffect, useMemo, useRef, useState } from 'react';

import { createSync } from './components/charts';
import { Controls } from './components/Controls';
import { EquityChart } from './components/EquityChart';
import { MonthlyTable } from './components/MonthlyTable';
import { Optimizer } from './components/Optimizer';
import { PineExport } from './components/PineExport';
import { PriceChart, type PriceChartHandle } from './components/PriceChart';
import { StatGrid } from './components/StatGrid';
import { TradesTable } from './components/TradesTable';
import { Icon, Segmented } from './components/ui';
import { loadSeries, MARKETS, seconds, TIMEFRAMES, type Series, type Timeframe } from './lib/data';
import { runBacktest } from './lib/engine';
import { date, fromIsoDay, isoDay } from './lib/format';
import { sma } from './lib/indicators';
import { computeStats, curveStats, drawdowns, monthlyReturns } from './lib/metrics';
import { pineScript } from './lib/pine';
import { decodeState, encodeState, type AppState } from './lib/share';
import { strategyById, type Line } from './lib/strategies';
import type { Candle } from './lib/types';

type Tab = 'trades' | 'monthly' | 'optimizer' | 'pine';
const NO_CANDLES: Candle[] = [];
const MIN_BARS = 30;

/** Candle indices for the chosen dates, keeping at least a few dozen bars. */
function resolveRange(candles: Candle[], from: string, to: string) {
  if (!candles.length) return { start: 0, end: 0 };
  const f = fromIsoDay(from);
  const t = to ? fromIsoDay(to) + 86_399 : Infinity;
  let end = candles.length - 1;
  while (end > 0 && candles[end].time > t) end--;
  let start = candles.findIndex((c) => c.time >= f);
  if (start < 0 || start > end) start = end;
  if (end - start < MIN_BARS) start = Math.max(0, end - MIN_BARS);
  return { start, end };
}

export default function App() {
  const [state, setState] = useState<AppState>(() =>
    decodeState(
      window.location.hash,
      MARKETS.map((m) => m.id),
    ),
  );
  const [series, setSeries] = useState<Series | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('trades');
  const [toast, setToast] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scale, setScale] = useState<'auto' | 'linear' | 'log'>('auto');
  const [sync] = useState(createSync);
  const chart = useRef<PriceChartHandle>(null);

  const update = (patch: Partial<AppState>) => setState((s) => ({ ...s, ...patch }));

  useEffect(() => {
    let cancelled = false;
    loadSeries(state.market, state.tf).then(
      (s) => {
        if (cancelled) return;
        setSeries(s);
        setLoadError(null);
      },
      (e: Error) => !cancelled && setLoadError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [state.market, state.tf]);

  // The address bar always holds a link to the current backtest.
  useEffect(() => {
    const hash = `#${encodeState(state)}`;
    if (hash !== window.location.hash) window.history.replaceState(null, '', hash);
  }, [state]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  const ready = series && series.market === state.market && series.tf === state.tf ? series : null;
  const candles = ready?.candles ?? NO_CANDLES;
  const strategy = strategyById(state.strategy);
  const granularity = seconds(state.tf);
  const intraday = state.tf !== '1d';
  const market = MARKETS.find((m) => m.id === state.market)!;
  const { start, end } = useMemo(() => resolveRange(candles, state.from, state.to), [candles, state.from, state.to]);

  const signals = useMemo(() => strategy.signals(candles, state.params), [strategy, candles, state.params]);
  const result = useMemo(() => {
    if (candles.length < MIN_BARS) return null;
    const bt = runBacktest(candles, signals, state.settings, start, end);
    const times = candles.slice(start, end + 1).map((c) => c.time);
    return {
      bt,
      times,
      stats: computeStats(bt, candles, granularity, state.settings.capital),
      bench: curveStats(bt.benchmark, times, granularity, state.settings.capital),
      drawdown: drawdowns(bt.equity, state.settings.capital),
      monthly: monthlyReturns(bt.equity, times, state.settings.capital),
    };
  }, [candles, signals, state.settings, start, end, granularity]);

  const view = useMemo(() => {
    const cut = (values: number[]) => values.slice(start, end + 1);
    const overlays: Line[] = signals.overlays.map((l) => ({ ...l, values: cut(l.values) }));
    if (state.settings.trendFilter > 0)
      overlays.push({
        name: `Trend SMA ${state.settings.trendFilter}`,
        color: '#6B7A88',
        values: cut(
          sma(
            candles.map((c) => c.close),
            state.settings.trendFilter,
          ),
        ),
        dashed: true,
      });
    const osc = signals.oscillator;
    return {
      candles: candles.slice(start, end + 1),
      overlays,
      oscillator: osc && {
        ...osc,
        lines: osc.lines.map((l) => ({ ...l, values: cut(l.values) })),
        histogram: osc.histogram && cut(osc.histogram),
      },
    };
  }, [candles, signals, start, end, state.settings.trendFilter]);

  const pine = useMemo(
    () =>
      candles.length
        ? pineScript(strategy, state.params, state.settings, {
            market: state.market,
            from: isoDay(candles[start].time),
            to: state.to || null,
          })
        : '',
    [candles, strategy, state.params, state.settings, state.market, start, state.to],
  );

  const refresh = async () => {
    setRefreshing(true);
    try {
      setSeries(await loadSeries(state.market, state.tf, { refresh: true }));
    } catch {
      // keep what we have
    }
    setRefreshing(false);
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setToast('Link to this backtest copied');
    } catch {
      setToast('Copy the address bar to share this backtest');
    }
  };

  const fitKey = `${state.market}-${state.tf}-${start}-${end}`;
  // Long daily histories read best on a log scale; short ones on a linear one, unless chosen.
  const log = scale === 'auto' ? !intraday && end - start > 400 : scale === 'log';
  const first = candles.length ? candles[0].time : null;
  const last = candles.length ? candles[candles.length - 1].time : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
          Edgelab <small>strategy backtester</small>
        </div>
        <Segmented
          label="Market"
          value={state.market}
          options={MARKETS.map((m) => ({ id: m.id, label: m.short, title: `${m.name} (${m.id})` }))}
          onChange={(m) => update({ market: m })}
        />
        <Segmented<Timeframe>
          label="Timeframe"
          value={state.tf}
          options={TIMEFRAMES.map((t) => ({ id: t.id, label: t.label }))}
          onChange={(tf) => update({ tf })}
        />
        <span className="spacer" />
        {ready ? (
          <span
            className="status"
            title={
              ready.live
                ? 'Topped up from the Coinbase public API in your browser'
                : 'Coinbase could not be reached, so the bundled data is used'
            }
          >
            <span className={`dot${ready.live ? ' live' : ''}`} />
            {ready.live ? 'Live from Coinbase' : 'Saved data'} · last candle {date(last!, intraday)}
            <button
              type="button"
              className="icon-btn"
              onClick={refresh}
              disabled={refreshing}
              aria-label="Check for new candles"
              title="Check for new candles"
            >
              <Icon name="refresh" />
            </button>
          </span>
        ) : null}
        <button type="button" className="btn" onClick={share}>
          <Icon name="link" /> Share
        </button>
      </header>

      <div className="layout">
        <aside className={`sidebar${settingsOpen ? '' : ' collapsed'}`}>
          <button type="button" className="settings-toggle" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((o) => !o)}>
            Strategy and settings <span>{settingsOpen ? 'Hide' : `${strategy.name} · change`}</span>
          </button>
          <Controls state={state} first={first} last={last} onChange={update} />
        </aside>

        <main className="main">
          {loadError ? <div className="warning">{loadError}</div> : null}
          {!ready || !result ? (
            <div className="card empty">
              <div className="spinner" />
              Loading {market.name} candles…
            </div>
          ) : (
            <>
              <div className="title-row">
                <div>
                  <h1>
                    {strategy.name} on {market.name}
                  </h1>
                  <p>
                    {state.market} · {TIMEFRAMES.find((t) => t.id === state.tf)!.label} candles · {date(candles[start].time, intraday)} to{' '}
                    {date(candles[end].time, intraday)} · {end - start + 1} bars ·{' '}
                    {state.settings.direction === 'both' ? 'long & short' : 'long only'}
                  </p>
                </div>
              </div>

              <StatGrid s={result.stats} bench={result.bench} barHours={granularity / 3600} />

              <section className="card" id="price-card">
                <div className="card-head">
                  <h2>Price and trades</h2>
                  <Segmented
                    label="Price scale"
                    small
                    value={log ? 'log' : 'linear'}
                    options={[
                      { id: 'linear', label: 'Linear' },
                      { id: 'log', label: 'Log' },
                    ]}
                    onChange={setScale}
                  />
                  <div className="legend">
                    {view.overlays.map((l) => (
                      <span key={l.name}>
                        <i style={{ background: l.color }} />
                        {l.name}
                      </span>
                    ))}
                    {view.oscillator ? (
                      <span>
                        <i style={{ background: view.oscillator.lines[0].color }} />
                        {view.oscillator.name} (lower panel)
                      </span>
                    ) : null}
                    <span>
                      <i style={{ background: '#2BD48A' }} />
                      Entries
                    </span>
                    <span>
                      <i style={{ background: '#C9D1D9' }} />
                      Exits
                    </span>
                  </div>
                </div>
                <PriceChart
                  ref={chart}
                  candles={view.candles}
                  overlays={view.overlays}
                  oscillator={view.oscillator}
                  trades={result.bt.trades}
                  intraday={intraday}
                  log={log}
                  sync={sync}
                  fitKey={fitKey}
                />
              </section>

              <section className="card">
                <div className="card-head">
                  <h2>Equity and drawdown</h2>
                  <div className="legend">
                    <span>
                      <i style={{ background: '#C3F53C' }} />
                      Strategy
                    </span>
                    <span>
                      <i style={{ background: '#8B98A5' }} />
                      Buy &amp; hold
                    </span>
                    <span>
                      <i style={{ background: '#F2555A' }} />
                      Drawdown (lower panel)
                    </span>
                  </div>
                </div>
                <EquityChart
                  times={result.times}
                  equity={result.bt.equity}
                  benchmark={result.bt.benchmark}
                  drawdown={result.drawdown}
                  intraday={intraday}
                  sync={sync}
                  fitKey={fitKey}
                />
              </section>

              <section className="card">
                <div className="tabs" role="tablist">
                  {(
                    [
                      ['trades', `Trades (${result.bt.trades.length})`],
                      ['monthly', 'Monthly returns'],
                      ['optimizer', 'Optimizer'],
                      ['pine', 'Pine Script'],
                    ] as [Tab, string][]
                  ).map(([id, label]) => (
                    <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="tab-body">
                  {tab === 'trades' ? (
                    <TradesTable
                      trades={result.bt.trades}
                      intraday={intraday}
                      barHours={granularity / 3600}
                      fileName={`edgelab-${state.market}-${state.tf}-${strategy.id}`}
                      onSelect={(t) => {
                        chart.current?.focus(t.entryTime, t.exitTime);
                        document.getElementById('price-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                    />
                  ) : null}
                  {tab === 'monthly' ? <MonthlyTable rows={result.monthly} /> : null}
                  {tab === 'optimizer' ? (
                    <Optimizer
                      candles={candles}
                      strategy={strategy}
                      params={state.params}
                      settings={state.settings}
                      start={start}
                      end={end}
                      granularity={granularity}
                      onApply={(params) => {
                        update({ params });
                        setToast('Settings applied');
                      }}
                    />
                  ) : null}
                  {tab === 'pine' ? <PineExport code={pine} /> : null}
                </div>
              </section>
            </>
          )}
          <footer className="footer">
            <span>
              Market data from the{' '}
              <a href="https://docs.cdp.coinbase.com/exchange/reference/exchangerestapi_getproductcandles" target="_blank" rel="noreferrer">
                Coinbase Exchange API
              </a>
              . Charts by{' '}
              <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
                TradingView Lightweight Charts™
              </a>
              .
            </span>
            <span>A demo for research and education, not financial advice. Past results don&apos;t promise future ones.</span>
          </footer>
        </main>
      </div>
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
