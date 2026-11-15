import type { ReactNode } from 'react';

import { duration, money, pct, ratio, signedMoney } from '../lib/format';
import type { CurveStats, Stats } from '../lib/metrics';

function Stat({ label, value, sub, tone, lead }: { label: string; value: string; sub: ReactNode; tone?: 'up' | 'down'; lead?: boolean }) {
  return (
    <div className={`stat${lead ? ' lead' : ''}`}>
      <span className="label">{label}</span>
      <span className={`value ${tone ?? ''}`}>{value}</span>
      <span className="sub">{sub}</span>
    </div>
  );
}

const tone = (v: number) => (v > 0 ? 'up' : v < 0 ? 'down' : undefined);

function heldFor(bars: number, barHours: number): string {
  const hours = bars * barHours;
  return hours >= 48 ? `${Math.round(hours / 24)} days` : `${Math.round(hours)} h`;
}

export function StatGrid({ s, bench, barHours }: { s: Stats; bench: CurveStats; barHours: number }) {
  return (
    <div className="stats">
      <Stat
        lead
        label="Net profit"
        value={signedMoney(s.netProfit)}
        tone={tone(s.netProfit)}
        sub={
          <>
            {pct(s.returnPct, { sign: true })} · B&amp;H <b>{pct(bench.returnPct, { sign: true })}</b>
          </>
        }
      />
      <Stat
        label="Max drawdown"
        value={pct(s.maxDrawdown)}
        tone={s.maxDrawdown < 0 ? 'down' : undefined}
        sub={
          <>
            B&amp;H <b>{pct(bench.maxDrawdown)}</b> · longest {duration(s.maxDrawdownDays)}
          </>
        }
      />
      <Stat
        label="Sharpe ratio"
        value={ratio(s.sharpe)}
        sub={
          <>
            Sortino {ratio(s.sortino)} · B&amp;H <b>{ratio(bench.sharpe)}</b>
          </>
        }
      />
      <Stat
        label="CAGR"
        value={s.cagr === null ? '—' : pct(s.cagr, { sign: true })}
        tone={s.cagr === null ? undefined : tone(s.cagr)}
        sub={
          s.cagr === null ? (
            'needs 6+ months of data'
          ) : (
            <>
              B&amp;H <b>{bench.cagr === null ? '—' : pct(bench.cagr, { sign: true })}</b> · Calmar{' '}
              {s.calmar === null ? '—' : ratio(s.calmar)}
            </>
          )
        }
      />
      <Stat
        label="Trades"
        value={String(s.trades)}
        sub={s.trades ? `avg hold ${heldFor(s.avgBars, barHours)} · ${pct(s.exposure, { digits: 0 })} in market` : 'no trades yet'}
      />
      <Stat
        label="Win rate"
        value={s.trades ? pct(s.winRate, { digits: 0 }) : '—'}
        sub={s.trades ? `avg win ${pct(s.avgWin, { sign: true })} · avg loss ${pct(s.avgLoss, { sign: true })}` : '—'}
      />
      <Stat
        label="Profit factor"
        value={s.trades ? ratio(s.profitFactor) : '—'}
        sub={s.trades ? `expectancy ${signedMoney(s.expectancy)} per trade` : '—'}
      />
      <Stat label="Trading costs" value={money(s.fees + s.slippage)} sub={`fees ${money(s.fees)} · slippage ${money(s.slippage)}`} />
    </div>
  );
}
