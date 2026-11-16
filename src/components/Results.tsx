import { useEffect, useMemo, useRef, useState } from 'react';

import type { Backtest } from '../lib/engine';
import { dateTime, duration, money, pct, price, ratio, REASON_LABEL } from '../lib/format';
import { drawdowns, monthlyReturns, type Stats } from '../lib/metrics';
import type { Candle, Trade } from '../lib/types';
import { THEME } from './charts';
import { LinesChart } from './PriceChart';

export interface RunResult {
  candles: Candle[];
  granularity: number;
  bt: Backtest;
  stats: Stats;
  capital: number;
  key: string; // changes whenever the run changes
}

/** Counts quickly up to the new value when a run finishes (skipped with reduced motion). */
function useCountUp(target: number, key: string) {
  const [v, setV] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    const from = prev.current;
    prev.current = target;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !Number.isFinite(target) || !Number.isFinite(from)) {
      setV(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 650);
      const e = 1 - (1 - k) ** 3;
      setV(from + (target - from) * e);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return v;
}

export function Hero({ r, title }: { r: RunResult; title: string }) {
  const st = r.stats;
  const shown = useCountUp(st.returnPct, r.key);
  const intraday = r.granularity < 86_400;
  const times = useMemo(() => r.candles.slice(r.bt.start, r.bt.end + 1).map((c) => c.time), [r]);
  const lines = useMemo(
    () => [
      { id: 'eq', label: 'Strategy', color: THEME.gold, area: true, points: r.bt.equity.map((v, i) => ({ time: times[i], value: v })) },
      { id: 'bh', label: 'Buy & hold', color: '#9aa0ad', dashed: true, width: 1, points: r.bt.benchmark.map((v, i) => ({ time: times[i], value: v })) },
    ],
    [r, times],
  );
  const dd = useMemo(() => drawdowns(r.bt.equity, r.capital).map((v, i) => ({ time: times[i], value: v })), [r, times]);
  const from = times[0];
  const to = times[times.length - 1];
  return (
    <section className="panel hero" aria-label="Backtest result">
      <div key={r.key} className="halo flash" />
      <div className="hero-top">
        <div className="hero-figure">
          <span className="label">{title}</span>
          <span className={`hero-num ${st.returnPct >= 0 ? 'up' : 'down'}`}>{pct(shown, { sign: true, digits: Math.abs(st.returnPct) >= 10 ? 0 : 1 })}</span>
          <span className="hero-sub">
            {money(st.netProfit, { sign: true })} on {money(r.capital)} · buy & hold {pct(st.benchmarkReturn, { sign: true })}
          </span>
          <span className="hero-sub muted">
            {dateTime(from, intraday)} – {dateTime(to, intraday)}
          </span>
        </div>
        <div className="kpis">
          <Kpi label="Max drawdown" value={pct(st.maxDrawdown, { digits: 1 })} tone={st.maxDrawdown < -0.3 ? 'down' : undefined} small={`buy & hold ${pct(st.benchmarkDrawdown, { digits: 0 })}`} />
          <Kpi label="CAGR" value={st.cagr === null ? '—' : pct(st.cagr, { sign: true })} small={st.cagr === null ? 'under 6 months' : 'per year'} />
          <Kpi label="Sharpe" value={ratio(st.sharpe)} small={`Sortino ${ratio(st.sortino)}`} />
          <Kpi label="Profit factor" value={ratio(st.profitFactor)} small={`payoff ${ratio(st.payoff)}`} />
          <Kpi label="Trades" value={String(st.trades)} small={`${pct(st.exposure, { digits: 0 })} of the time in market`} />
          <Kpi label="Win rate" value={pct(st.winRate, { digits: 0 })} small={`avg ${pct(st.avgTrade, { sign: true })} per trade`} />
          <Kpi label="Calmar" value={ratio(st.calmar)} small="CAGR / max drawdown" />
          <Kpi label="Avg R" value={st.avgR === null ? '—' : `${st.avgR >= 0 ? '+' : ''}${st.avgR.toFixed(2)}R`} small={st.avgR === null ? 'set a stop to measure R' : 'per trade'} />
        </div>
      </div>
      <LinesChart className="hero-chart" lines={lines} drawdown={dd} intraday={intraday} height={300} fitKey={r.key} />
      <div className="legend">
        <span>
          <i style={{ background: THEME.gold }} />
          Strategy
        </span>
        <span>
          <i style={{ background: '#9aa0ad' }} />
          Buy & hold
        </span>
        <span>
          <i style={{ background: THEME.down }} />
          Drawdown
        </span>
      </div>
    </section>
  );
}

function Kpi({ label, value, small, tone }: { label: string; value: string; small?: string; tone?: 'up' | 'down' }) {
  return (
    <div className="kpi">
      <span className="label">{label}</span>
      <span className={`value${tone ? ` ${tone}` : ''}`}>{value}</span>
      {small ? <span className="small">{small}</span> : null}
    </div>
  );
}

export function StatsList({ st }: { st: Stats }) {
  const rows: [string, string][] = [
    ['Net profit', money(st.netProfit, { sign: true })],
    ['Return', pct(st.returnPct, { sign: true })],
    ['Buy & hold return', pct(st.benchmarkReturn, { sign: true })],
    ['CAGR', st.cagr === null ? '—' : pct(st.cagr, { sign: true })],
    ['Max drawdown', pct(st.maxDrawdown)],
    ['Longest drawdown', `${st.maxDrawdownDays} days`],
    ['Ulcer index', ratio(st.ulcer)],
    ['Sharpe ratio', ratio(st.sharpe)],
    ['Sortino ratio', ratio(st.sortino)],
    ['Calmar ratio', ratio(st.calmar)],
    ['Trades', String(st.trades)],
    ['Win rate', pct(st.winRate)],
    ['Profit factor', ratio(st.profitFactor)],
    ['Average trade', pct(st.avgTrade, { sign: true })],
    ['Average win', pct(st.avgWin, { sign: true })],
    ['Average loss', pct(st.avgLoss)],
    ['Best trade', pct(st.best, { sign: true })],
    ['Worst trade', pct(st.worst)],
    ['Expectancy', money(st.expectancy, { sign: true })],
    ['Average R', st.avgR === null ? '—' : st.avgR.toFixed(2)],
    ['Losing streak', `${st.maxLosingStreak} trades`],
    ['Time in market', pct(st.exposure)],
    ['Long trades', `${st.longs.trades} · ${pct(st.longs.winRate, { digits: 0 })} won · ${money(st.longs.pnl, { sign: true, compact: true })}`],
    ['Short trades', `${st.shorts.trades} · ${pct(st.shorts.winRate, { digits: 0 })} won · ${money(st.shorts.pnl, { sign: true, compact: true })}`],
    ['Fees paid', money(st.fees)],
    ['Slippage cost', money(st.slippage)],
  ];
  return (
    <div className="stats">
      {rows.map(([k, v]) => (
        <div className="row" key={k}>
          <span>{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}

export function ExitBreakdown({ st }: { st: Stats }) {
  const entries = Object.entries(st.exits).sort((a, b) => b[1]!.count - a[1]!.count);
  const max = Math.max(1, ...entries.map(([, e]) => Math.abs(e!.pnl)));
  if (!entries.length) return <p className="muted">No exits yet.</p>;
  return (
    <div className="bars">
      {entries.map(([reason, e]) => (
        <div className="bar-row" key={reason}>
          <span>
            {REASON_LABEL[reason]} <span className="muted">×{e!.count}</span>
          </span>
          <span className="track">
            <i style={{ width: `${(Math.abs(e!.pnl) / max) * 100}%`, background: e!.pnl >= 0 ? THEME.up : THEME.down }} />
          </span>
          <span className={`num ${e!.pnl >= 0 ? 'up' : 'down'}`} style={{ textAlign: 'right', fontWeight: 700 }}>
            {money(e!.pnl, { sign: true, compact: true })}
          </span>
        </div>
      ))}
    </div>
  );
}

export function TradesTable({ trades, granularity, onPick }: { trades: Trade[]; granularity: number; onPick?: (t: Trade) => void }) {
  const [page, setPage] = useState(0);
  const per = 50;
  const list = trades.slice().reverse();
  const shown = list.slice(page * per, page * per + per);
  const intraday = granularity < 86_400;
  if (!trades.length) return <p className="muted">No trades in this period. Loosen the entry rules or test a longer range.</p>;
  return (
    <>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Side</th>
              <th>Entry</th>
              <th className="r">Entry price</th>
              <th>Exit</th>
              <th className="r">Exit price</th>
              <th className="r">Return</th>
              <th className="r">P&amp;L</th>
              <th className="r">R</th>
              <th className="r">Held</th>
              <th>Closed by</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr key={`${t.entryTime}-${t.exitTime}-${t.side}`} className={onPick ? 'clickable' : undefined} onClick={() => onPick?.(t)}>
                <td>
                  <span className={`chip ${t.side === 'long' ? 'up' : 'down'}`}>{t.side === 'long' ? 'Long' : 'Short'}</span>
                  {t.adds ? <span className="muted"> +{t.adds}</span> : null}
                </td>
                <td>{dateTime(t.entryTime, intraday)}</td>
                <td className="r">{price(t.entryPrice)}</td>
                <td>{dateTime(t.exitTime, intraday)}</td>
                <td className="r">{price(t.exitPrice)}</td>
                <td className={`r ${t.pnl >= 0 ? 'up' : 'down'}`}>{pct(t.pnlPct, { sign: true })}</td>
                <td className={`r ${t.pnl >= 0 ? 'up' : 'down'}`}>{money(t.pnl, { sign: true })}</td>
                <td className="r">{t.r === null ? '—' : t.r.toFixed(2)}</td>
                <td className="r">{duration(t.bars, granularity)}</td>
                <td>{t.fills.length > 1 ? `${t.fills.length} exits · ` : ''}{REASON_LABEL[t.reason]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length > per ? (
        <div className="toolbar" style={{ marginTop: 10 }}>
          <span className="muted">
            {page * per + 1}–{Math.min(list.length, page * per + per)} of {list.length}, newest first
          </span>
          <span className="grow" />
          <button className="btn sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Newer
          </button>
          <button className="btn sm" disabled={(page + 1) * per >= list.length} onClick={() => setPage((p) => p + 1)}>
            Older
          </button>
        </div>
      ) : null}
    </>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function MonthlyTable({ r }: { r: RunResult }) {
  const rows = useMemo(() => {
    const times = r.candles.slice(r.bt.start, r.bt.end + 1).map((c) => c.time);
    return monthlyReturns(r.bt.equity, times, r.capital).reverse();
  }, [r]);
  const bg = (v: number | null) => {
    if (v === null) return undefined;
    const a = Math.min(0.85, Math.abs(v) * 3.2);
    return v >= 0 ? `rgba(15,154,107,${a * 0.5})` : `rgba(210,64,90,${a * 0.5})`;
  };
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Year</th>
            {MONTHS.map((m) => (
              <th key={m} className="r">
                {m}
              </th>
            ))}
            <th className="r">Year</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((y) => (
            <tr key={y.year}>
              <td style={{ fontWeight: 700 }}>{y.year}</td>
              {y.months.map((m, i) => (
                <td key={i} className="r month" style={{ background: bg(m) }}>
                  {m === null ? '' : pct(m, { digits: 1 })}
                </td>
              ))}
              <td className={`r ${y.total >= 0 ? 'up' : 'down'}`} style={{ fontWeight: 800 }}>
                {pct(y.total, { sign: true })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
