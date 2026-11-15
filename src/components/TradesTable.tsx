import { date, money, pct, price, signedMoney } from '../lib/format';
import type { ExitReason, Trade } from '../lib/types';
import { Icon } from './ui';

const REASONS: Record<ExitReason, string> = {
  signal: 'Signal',
  stop: 'Stop loss',
  'trailing-stop': 'Trailing stop',
  'take-profit': 'Take profit',
  liquidated: 'Liquidated',
  end: 'End of test',
};

function held(t: Trade, intraday: boolean, barHours: number): string {
  if (!intraday) return `${t.bars} ${t.bars === 1 ? 'day' : 'days'}`;
  const hours = t.bars * barHours;
  return hours < 48 ? `${hours} h` : `${(hours / 24).toFixed(1)} d`;
}

function toCsv(trades: Trade[]): string {
  const head = [
    '#',
    'side',
    'entry_time_utc',
    'entry_price',
    'exit_time_utc',
    'exit_price',
    'quantity',
    'bars',
    'return_pct',
    'pnl_usd',
    'fees_usd',
    'exit_reason',
  ];
  const iso = (t: number) => new Date(t * 1000).toISOString();
  const rows = trades.map((t, i) =>
    [
      i + 1,
      t.side,
      iso(t.entryTime),
      t.entryPrice,
      iso(t.exitTime),
      t.exitPrice,
      t.qty,
      t.bars,
      (t.pnlPct * 100).toFixed(3),
      t.pnl.toFixed(2),
      t.fees.toFixed(2),
      t.reason,
    ].join(','),
  );
  return [head.join(','), ...rows].join('\n');
}

export function TradesTable({
  trades,
  intraday,
  barHours,
  onSelect,
  fileName,
}: {
  trades: Trade[];
  intraday: boolean;
  barHours: number;
  onSelect: (t: Trade) => void;
  fileName: string;
}) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([toCsv(trades)], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${fileName}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!trades.length) return <div className="empty">No trades in this period. Try a longer test period or different settings.</div>;

  return (
    <>
      <div className="toolbar">
        <span className="muted">{trades.length} trades · newest first · click a trade to see it on the chart</span>
        <span className="spacer" />
        <button type="button" className="btn" onClick={download}>
          <Icon name="download" /> Download CSV
        </button>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>#</th>
              <th className="left">Side</th>
              <th className="left">Entry</th>
              <th>Entry price</th>
              <th className="left">Exit</th>
              <th>Exit price</th>
              <th>Held</th>
              <th>Return</th>
              <th>P&amp;L</th>
              <th className="left">Exit reason</th>
            </tr>
          </thead>
          <tbody>
            {trades
              .map((t, i) => ({ t, n: i + 1 }))
              .reverse()
              .map(({ t, n }) => (
                <tr key={n} onClick={() => onSelect(t)} title="Show on the chart">
                  <td>{n}</td>
                  <td className="left">
                    <span className={`pill ${t.side}`}>{t.side === 'long' ? 'Long' : 'Short'}</span>
                  </td>
                  <td className="left sans">{date(t.entryTime, intraday)}</td>
                  <td>{price(t.entryPrice)}</td>
                  <td className="left sans">{date(t.exitTime, intraday)}</td>
                  <td>{price(t.exitPrice)}</td>
                  <td>{held(t, intraday, barHours)}</td>
                  <td className={t.pnlPct > 0 ? 'up' : 'down'}>{pct(t.pnlPct, { sign: true })}</td>
                  <td className={t.pnl > 0 ? 'up' : 'down'} title={`Fees ${money(t.fees)}`}>
                    {signedMoney(t.pnl)}
                  </td>
                  <td className="left sans muted">{REASONS[t.reason]}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
