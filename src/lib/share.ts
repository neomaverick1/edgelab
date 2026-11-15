import type { Timeframe } from './data';
import { STRATEGIES, defaultParams, strategyById } from './strategies';
import type { Params, Settings } from './types';

export interface AppState {
  market: string;
  tf: Timeframe;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD, or '' for the latest candle
  strategy: string;
  params: Params;
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  capital: 10_000,
  sizePct: 100,
  feePct: 0.1,
  slippagePct: 0.05,
  stopPct: 0,
  takeProfitPct: 0,
  trailPct: 0,
  direction: 'long',
  trendFilter: 0,
};

export const DEFAULT_STATE: AppState = {
  market: 'BTC-USD',
  tf: '1d',
  from: '2020-01-01',
  to: '',
  strategy: 'ema-cross',
  params: defaultParams(strategyById('ema-cross')),
  settings: DEFAULT_SETTINGS,
};

const SETTING_KEYS: [keyof Settings, string][] = [
  ['capital', 'cap'],
  ['sizePct', 'size'],
  ['feePct', 'fee'],
  ['slippagePct', 'slip'],
  ['stopPct', 'sl'],
  ['takeProfitPct', 'tp'],
  ['trailPct', 'trail'],
  ['trendFilter', 'trend'],
];

/** The whole setup as a URL hash, so a backtest can be shared as a link. */
export function encodeState(s: AppState): string {
  const q = new URLSearchParams();
  q.set('m', s.market);
  q.set('tf', s.tf);
  q.set('from', s.from);
  if (s.to) q.set('to', s.to);
  q.set('s', s.strategy);
  q.set(
    'p',
    Object.entries(s.params)
      .map(([k, v]) => `${k}:${v}`)
      .join(','),
  );
  for (const [key, short] of SETTING_KEYS) q.set(short, String(s.settings[key]));
  q.set('dir', s.settings.direction);
  return q.toString();
}

const isDay = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export function decodeState(hash: string, markets: string[]): AppState {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  const strategy = STRATEGIES.find((x) => x.id === q.get('s')) ?? strategyById(DEFAULT_STATE.strategy);
  const params = defaultParams(strategy);
  for (const pair of (q.get('p') ?? '').split(',')) {
    const [k, raw] = pair.split(':');
    const def = strategy.params.find((d) => d.key === k);
    const v = Number(raw);
    if (def && Number.isFinite(v)) params[k] = Math.min(def.max, Math.max(def.min, v));
  }
  const settings: Settings = { ...DEFAULT_SETTINGS };
  for (const [key, short] of SETTING_KEYS) {
    const v = Number(q.get(short));
    if (q.has(short) && Number.isFinite(v) && v >= 0) (settings[key] as number) = v;
  }
  settings.sizePct = Math.min(100, Math.max(1, settings.sizePct));
  settings.capital = Math.max(100, settings.capital);
  settings.direction = q.get('dir') === 'both' ? 'both' : 'long';
  const market = q.get('m') ?? '';
  const tf = q.get('tf');
  const from = q.get('from');
  const to = q.get('to');
  return {
    market: markets.includes(market) ? market : DEFAULT_STATE.market,
    tf: tf === '6h' || tf === '1h' ? tf : '1d',
    from: isDay(from) ? from : DEFAULT_STATE.from,
    to: isDay(to) ? to : '',
    strategy: strategy.id,
    params,
    settings,
  };
}
