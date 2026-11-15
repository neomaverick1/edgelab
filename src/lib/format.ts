const money0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const money = (v: number) => (Math.abs(v) >= 1000 ? money0 : money2).format(v);

export const signedMoney = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${money(Math.abs(v))}`;

/** 0.1234 → "+12.3%" (or without the sign). */
export function pct(v: number, opts: { sign?: boolean; digits?: number } = {}): string {
  if (!Number.isFinite(v)) return '—';
  const digits = opts.digits ?? (Math.abs(v) >= 10 ? 0 : 1);
  const s = Math.abs(v * 100).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const sign = v < 0 ? '−' : opts.sign && v > 0 ? '+' : '';
  return `${sign}${s}%`;
}

export function ratio(v: number, digits = 2): string {
  if (v === Infinity) return '∞';
  if (!Number.isFinite(v)) return '—';
  const s = Math.abs(v).toFixed(digits);
  return (v < 0 && Number(s) !== 0 ? '−' : '') + s;
}

/** Prices keep enough decimals to be useful from Bitcoin down to Dogecoin. */
export function price(v: number): string {
  const digits = v >= 1000 ? 2 : v >= 1 ? 3 : 5;
  return v.toLocaleString('en-US', { minimumFractionDigits: Math.min(digits, 2), maximumFractionDigits: digits });
}

const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const dayTime = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
});

export const date = (unix: number, withTime = false) => (withTime ? `${dayTime.format(unix * 1000)} UTC` : day.format(unix * 1000));

/** Unix seconds → "2024-03-01" (UTC). */
export const isoDay = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

/** "2024-03-01" → Unix seconds at 00:00 UTC. */
export const fromIsoDay = (s: string) => Date.parse(`${s}T00:00:00Z`) / 1000;

export function duration(days: number): string {
  if (days < 1) return `${Math.round(days * 24)} h`;
  if (days < 60) return `${Math.round(days)} days`;
  if (days < 730) return `${Math.round(days / 30.44)} months`;
  return `${(days / 365.25).toFixed(1)} years`;
}
