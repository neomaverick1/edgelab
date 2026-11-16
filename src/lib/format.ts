export function pct(x: number | null | undefined, opts: { sign?: boolean; digits?: number } = {}): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  const digits = opts.digits ?? (Math.abs(x) >= 10 ? 0 : 1);
  const s = (x * 100).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${opts.sign && x > 0 ? '+' : ''}${s}%`;
}

export function money(x: number, opts: { sign?: boolean; compact?: boolean } = {}): string {
  if (!Number.isFinite(x)) return '—';
  const abs = Math.abs(x);
  const s = opts.compact && abs >= 10_000 ? `$${(abs / 1000).toLocaleString('en-US', { maximumFractionDigits: abs >= 1e6 ? 0 : 1 })}k` : `$${abs.toLocaleString('en-US', { maximumFractionDigits: abs >= 100 ? 0 : 2 })}`;
  return `${x < 0 ? '−' : opts.sign && x > 0 ? '+' : ''}${s}`;
}

export function ratio(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined) return '—';
  if (x === Infinity) return '∞';
  if (!Number.isFinite(x)) return '—';
  return x.toFixed(digits);
}

export function price(x: number): string {
  if (!Number.isFinite(x)) return '—';
  const d = x >= 1000 ? 2 : x >= 1 ? 2 : x >= 0.01 ? 4 : 6;
  return x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

const dateFmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
const dateTimeFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
export const date = (t: number) => dateFmt.format(t * 1000);
export const dateTime = (t: number, intraday: boolean) => (intraday ? `${dateTimeFmt.format(t * 1000)} UTC` : dateFmt.format(t * 1000));
export const isoDay = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

export function duration(bars: number, granularity: number): string {
  const sec = bars * granularity;
  if (sec >= 86_400 * 2) return `${Math.round(sec / 86_400)}d`;
  if (sec >= 3_600) return `${Math.round(sec / 3_600)}h`;
  return `${Math.round(sec / 60)}m`;
}

export const REASON_LABEL: Record<string, string> = {
  signal: 'Exit rule',
  stop: 'Stop loss',
  'trailing-stop': 'Trailing stop',
  breakeven: 'Breakeven stop',
  'take-profit': 'Take profit',
  time: 'Time exit',
  reverse: 'Reversed',
  liquidated: 'Liquidated',
  end: 'End of test',
};
