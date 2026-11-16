import { Bell, BellOff, Play, Radio, Smartphone, Square, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { AssetIcon } from '../components/AssetPicker';
import { PriceChart } from '../components/PriceChart';
import { TradesTable } from '../components/Results';
import { Panel, Seg } from '../components/ui';
import { toast } from '../components/toast';
import { inputsOf } from '../lib/catalog';
import { isNative, seconds, type Timeframe } from '../lib/data/core';
import { liveSupported, startLive, type LiveStatus } from '../lib/data/live';
import { loadSeries, type Asset } from '../lib/data/sources';
import { runBacktest } from '../lib/engine';
import { dateTime, money, pct, price } from '../lib/format';
import { evaluate, type Strategy } from '../lib/rules';
import { loadPaper, savePaper, type PaperSession } from '../lib/state';
import type { Candle } from '../lib/types';

interface Props {
  strategy: Strategy;
  asset: Asset;
  tf: Timeframe;
}

const STARTS = [
  { id: 'now', label: 'From now', back: 0 },
  { id: 'week', label: 'From a week ago', back: 7 * 86400 },
  { id: 'month', label: 'From a month ago', back: 30 * 86400 },
];

export function LiveView({ strategy, asset, tf }: Props) {
  const [sessions, setSessions] = useState<PaperSession[]>(loadPaper);
  const [active, setActive] = useState<string | null>(() => loadPaper()[0]?.id ?? null);
  const [start, setStart] = useState('now');
  const supported = liveSupported(asset);
  const current = sessions.find((s) => s.id === active) ?? null;

  const begin = () => {
    const back = STARTS.find((s) => s.id === start)!.back;
    const g = seconds(tf);
    const at = Math.floor((Date.now() / 1000 - back) / g) * g;
    const s: PaperSession = { id: `p${Date.now()}`, asset, tf, strategy: structuredClone(strategy), startedAt: at, capital: strategy.costs.capital };
    const next = [s, ...sessions].slice(0, 12);
    setSessions(next);
    savePaper(next);
    setActive(s.id);
  };
  const remove = (id: string) => {
    const next = sessions.filter((s) => s.id !== id);
    setSessions(next);
    savePaper(next);
    if (active === id) setActive(next[0]?.id ?? null);
  };

  return (
    <div className="main-inner">
      <Panel
        title="Paper trading"
        sub="Runs your rules forward on live prices; no real orders"
        actions={
          <>
            <Seg label="Start" value={start} onChange={setStart} options={STARTS.map((s) => ({ id: s.id, label: s.label }))} />
            <button className="btn gold" onClick={begin} disabled={!supported}>
              <Play /> Start {strategy.name} on {asset.display} {tf}
            </button>
          </>
        }
      >
        {!supported ? (
          <div className="note warn">
            <Smartphone />
            <span>{asset.source === 'csv' ? 'A CSV file has no live feed.' : `${asset.display} streams live in the Android app. On the web, live paper trading works on every Coinbase and Binance pair.`}</span>
          </div>
        ) : null}
        {sessions.length ? (
          <div style={{ display: 'grid', gap: 2, marginTop: supported ? 0 : 12 }}>
            {sessions.map((s) => (
              <div key={s.id} className="result" aria-selected={s.id === active} style={{ cursor: 'pointer' }} onClick={() => setActive(s.id)}>
                <AssetIcon a={s.asset} />
                <span className="sym">
                  {s.asset.display} <span className="muted">{s.tf}</span>
                </span>
                <span className="name">
                  {s.strategy.name} · since {dateTime(s.startedAt, true)}
                </span>
                <button
                  className="icon-btn sm"
                  aria-label="Stop and delete this session"
                  title="Stop and delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(s.id);
                  }}
                >
                  <Trash2 />
                </button>
              </div>
            ))}
          </div>
        ) : supported ? (
          <p className="muted">Start a session to watch the strategy trade as new bars close. Sessions are kept on this device and pick up where they left off.</p>
        ) : null}
      </Panel>
      {current ? <SessionView key={current.id} s={current} /> : null}
    </div>
  );
}

function SessionView({ s }: { s: PaperSession }) {
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [forming, setForming] = useState<Candle | null>(null);
  const [status, setStatus] = useState<{ s: LiveStatus; d?: string }>({ s: 'connecting' });
  const [error, setError] = useState<string | null>(null);
  const [notify, setNotify] = useState(() => typeof Notification !== 'undefined' && Notification.permission === 'granted');
  const g = seconds(s.tf);
  const intraday = g < 86_400;

  useEffect(() => {
    let feed: { stop: () => void } | null = null;
    let alive = true;
    loadSeries(s.asset, s.tf, { refresh: true })
      .then((series) => {
        if (!alive) return;
        setCandles(series.candles.slice(-3000));
        feed = startLive(s.asset, s.tf, {
          onClosed: (bars) =>
            setCandles((prev) => {
              const base = prev ?? [];
              const first = bars[0].time;
              return [...base.filter((c) => c.time < first), ...bars].slice(-3000);
            }),
          onForming: setForming,
          onStatus: (st, d) => setStatus({ s: st, d }),
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
      feed?.stop();
    };
  }, [s]);

  const view = useMemo(() => {
    if (!candles?.length) return null;
    const sig = evaluate(s.strategy, inputsOf(candles));
    let startIdx = candles.findIndex((c) => c.time >= s.startedAt);
    if (startIdx < 0) startIdx = candles.length - 1;
    const from = Math.max(startIdx, sig.warmup);
    const bt = runBacktest(candles, sig, s.strategy, { start: Math.min(from, candles.length - 1), end: candles.length - 1, keepOpen: true });
    const last = candles.length - 1;
    const fl = sig.filter[last] === 1;
    const next =
      bt.open === null
        ? sig.longEntry[last] && fl && s.strategy.side !== 'short'
          ? 'Buy at the next open'
          : sig.shortEntry[last] && fl && s.strategy.side !== 'long'
            ? 'Short at the next open'
            : null
        : bt.open.side === 'long' && sig.longExit[last]
          ? 'Sell at the next open'
          : bt.open.side === 'short' && sig.shortExit[last]
            ? 'Cover at the next open'
            : null;
    return { sig, bt, next, shown: candles.slice(Math.max(0, startIdx - 200)) };
  }, [candles, s]);

  // Announce new trades and signals.
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (!view) return;
    const key = `${view.bt.trades.length}|${view.bt.open?.entryTime ?? ''}|${view.next ?? ''}`;
    if (seen.current !== null && seen.current !== key) {
      const msg = view.next ? `${s.asset.display}: ${view.next}` : view.bt.open ? `${s.asset.display}: in a ${view.bt.open.side} position` : `${s.asset.display}: position closed`;
      toast(msg);
      if (notify && typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('Edgelab', { body: msg });
    }
    seen.current = key;
  }, [view, notify, s.asset.display]);

  if (error) return <div className="note bad">{error}</div>;
  if (!view) return <div className="panel empty"><div className="spinner" /><p>Loading {s.asset.display} history…</p></div>;

  const mark = forming?.close ?? candles![candles!.length - 1].close;
  const realized = view.bt.trades.reduce((a, t) => a + t.pnl, 0);
  const open = view.bt.open;
  const unreal = open ? (open.side === 'long' ? (mark - open.entryPrice) * open.qty : (open.entryPrice - mark) * open.qty) : 0;
  const equity = s.capital + realized + unreal;

  return (
    <>
      <section className="panel hero">
        <div className="halo" />
        <div className="hero-top">
          <div className="hero-figure">
            <span className="label">
              {s.strategy.name} on {s.asset.display} {s.tf}
            </span>
            <span className="hero-num">{pct(equity / s.capital - 1, { sign: true, digits: 2 })}</span>
            <span className="hero-sub">
              {money(equity - s.capital, { sign: true })} since {dateTime(s.startedAt, true)}
            </span>
          </div>
          <div className="kpis">
            <div className="kpi">
              <span className="label">Feed</span>
              <span className="status">
                <span className={`dot ${status.s === 'live' ? 'live' : status.s === 'offline' ? 'off' : 'warn'}`} />
                {status.s === 'live' ? 'Live' : status.s === 'polling' ? 'Polling' : status.s === 'offline' ? 'Offline' : 'Connecting'}
              </span>
              <span className="small">{status.d ?? `price ${price(mark)}`}</span>
            </div>
            <div className="kpi">
              <span className="label">Position</span>
              <span className="value">{open ? (open.side === 'long' ? 'Long' : 'Short') : 'Flat'}</span>
              <span className="small">{open ? `${price(open.qty)} @ ${price(open.entryPrice)}` : (view.next ?? 'waiting for a signal')}</span>
            </div>
            <div className="kpi">
              <span className="label">Open P&amp;L</span>
              <span className={`value ${unreal >= 0 ? 'up' : 'down'}`}>{open ? money(unreal, { sign: true }) : '—'}</span>
              <span className="small">{open?.stop ? `stop ${price(open.stop)}` : 'no stop'}</span>
            </div>
            <div className="kpi">
              <span className="label">Closed trades</span>
              <span className="value">{view.bt.trades.length}</span>
              <span className="small">{money(realized, { sign: true })} realised</span>
            </div>
          </div>
        </div>
        <div className="toolbar" style={{ padding: '8px 0 14px' }}>
          {view.next ? (
            <span className="chip gold">
              <Radio /> {view.next}
            </span>
          ) : null}
          <span className="muted" style={{ fontSize: 12.5 }}>
            Signals are checked when each {s.tf} bar closes, the same way the backtest does.
          </span>
          <span className="grow" />
          {typeof Notification !== 'undefined' && !isNative() ? (
            <button
              className="btn sm"
              onClick={async () => {
                if (notify) return setNotify(false);
                const p = await Notification.requestPermission();
                setNotify(p === 'granted');
              }}
            >
              {notify ? <BellOff /> : <Bell />} {notify ? 'Mute alerts' : 'Alert me'}
            </button>
          ) : null}
        </div>
      </section>
      <Panel title="Live chart" sub="Dotted line: entry · red: stop · green: targets">
        <PriceChart candles={view.shown} plots={view.sig.plots.map((p) => ({ ...p, values: p.values.slice(-view.shown.length) }))} trades={view.bt.trades} open={open} forming={forming} intraday={intraday} log={false} fitKey={s.id} />
      </Panel>
      <Panel title="Paper trades">
        <TradesTable trades={view.bt.trades} granularity={g} />
      </Panel>
      <p className="muted" style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center' }}>
        <Square style={{ width: 12, height: 12 }} /> Paper trading only. Fees and slippage from the strategy settings are applied to every fill.
      </p>
    </>
  );
}
