import { pct } from '../lib/format';
import type { YearRow } from '../lib/metrics';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const heat = (v: number, scale = 0.25) => {
  const a = Math.min(0.55, (Math.abs(v) / scale) * 0.55);
  return v >= 0 ? `rgba(43, 212, 138, ${a})` : `rgba(242, 85, 90, ${a})`;
};

export function MonthlyTable({ rows }: { rows: YearRow[] }) {
  if (!rows.length) return null;
  return (
    <>
      <div className="toolbar">
        <span className="muted">Strategy return in each calendar month (UTC) and each year.</span>
      </div>
      <div className="table-wrap">
        <table className="data monthly">
          <thead>
            <tr>
              <th>Year</th>
              {MONTHS.map((m) => (
                <th key={m}>{m}</th>
              ))}
              <th>Year</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr key={r.year}>
                <td className="sans">{r.year}</td>
                {r.months.map((v, i) => (
                  <td key={i} className="cell" style={v === null ? undefined : { background: heat(v) }}>
                    {v === null ? '' : pct(v, { sign: true })}
                  </td>
                ))}
                <td style={{ background: heat(r.total, 1), fontWeight: 600 }}>{pct(r.total, { sign: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
