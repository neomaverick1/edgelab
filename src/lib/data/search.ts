// One search box for every market Edgelab can reach.
import { isNative } from './core';
import { binanceAssets, coinbaseAssets, yahooSearch, YAHOO_UNIVERSE, type Asset } from './sources';

let crypto: Promise<Asset[]> | null = null;

/** Every crypto pair on Coinbase and Binance, loaded once. */
export function cryptoAssets(): Promise<Asset[]> {
  crypto ??= Promise.allSettled([coinbaseAssets(), binanceAssets()]).then((r) => r.flatMap((x) => (x.status === 'fulfilled' ? x.value : [])));
  return crypto;
}

export const FEATURED: string[] = [
  'coinbase:BTC-USD',
  'coinbase:ETH-USD',
  'coinbase:SOL-USD',
  'yahoo:SPY',
  'yahoo:QQQ',
  'yahoo:AAPL',
  'yahoo:NVDA',
  'yahoo:TSLA',
  'yahoo:GC=F',
  'yahoo:EURUSD=X',
  'binance:BNBUSDT',
  'yahoo:^VIX',
];

export const STATIC_CRYPTO: Asset[] = [
  { id: 'coinbase:BTC-USD', source: 'coinbase', symbol: 'BTC-USD', name: 'Bitcoin / USD', kind: 'crypto', display: 'BTC/USD' },
  { id: 'coinbase:ETH-USD', source: 'coinbase', symbol: 'ETH-USD', name: 'Ethereum / USD', kind: 'crypto', display: 'ETH/USD' },
  { id: 'coinbase:SOL-USD', source: 'coinbase', symbol: 'SOL-USD', name: 'Solana / USD', kind: 'crypto', display: 'SOL/USD' },
  { id: 'coinbase:DOGE-USD', source: 'coinbase', symbol: 'DOGE-USD', name: 'Dogecoin / USD', kind: 'crypto', display: 'DOGE/USD' },
  { id: 'binance:BNBUSDT', source: 'binance', symbol: 'BNBUSDT', name: 'BNB / USDT', kind: 'crypto', display: 'BNB/USDT' },
];

const NAMES: Record<string, string> = { BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', DOGE: 'Dogecoin', XRP: 'XRP', ADA: 'Cardano', BNB: 'BNB', AVAX: 'Avalanche', LINK: 'Chainlink', LTC: 'Litecoin', DOT: 'Polkadot', MATIC: 'Polygon', POL: 'Polygon', SHIB: 'Shiba Inu', PEPE: 'Pepe', SUI: 'Sui', TRX: 'TRON', TON: 'Toncoin', NEAR: 'NEAR', APT: 'Aptos', ARB: 'Arbitrum', OP: 'Optimism', UNI: 'Uniswap', AAVE: 'Aave', XLM: 'Stellar', BCH: 'Bitcoin Cash', ATOM: 'Cosmos', HBAR: 'Hedera', ICP: 'Internet Computer', FIL: 'Filecoin', INJ: 'Injective', RNDR: 'Render', RENDER: 'Render', WIF: 'dogwifhat', BONK: 'Bonk', SEI: 'Sei', TIA: 'Celestia' };
export const cryptoName = (a: Asset) => {
  const base = a.display.split('/')[0];
  return NAMES[base] ? `${NAMES[base]} · ${a.display}` : a.display;
};

function rank(a: Asset, q: string): number {
  const sym = a.display.toLowerCase().replace(/[/^=]/g, '');
  const raw = a.symbol.toLowerCase();
  const name = (a.kind === 'crypto' ? cryptoName(a) : a.name).toLowerCase();
  const qq = q.replace(/[/\-^=\s]/g, '');
  let r = 0;
  if (raw === q || sym === qq) r = 100;
  else if (sym.startsWith(qq) || raw.startsWith(q)) r = 70 - sym.length;
  else if (name.startsWith(q)) r = 55;
  else if (name.includes(q)) r = 35;
  else if (sym.includes(qq)) r = 25;
  else return -1;
  // Prefer liquid quotes and well-known venues.
  if (a.kind === 'crypto') {
    if (/\/(USD|USDT)$/.test(a.display)) r += 8;
    if (/\/(USDC)$/.test(a.display)) r += 4;
    if (a.source === 'coinbase') r += 2;
  } else r += 6;
  return r;
}

export async function searchAssets(q: string, extra: Asset[] = []): Promise<Asset[]> {
  const query = q.trim().toLowerCase();
  const pool = [...extra, ...YAHOO_UNIVERSE, ...STATIC_CRYPTO];
  const cryptoList = await cryptoAssets().catch(() => []);
  pool.push(...cryptoList);
  const seen = new Set<string>();
  const unique = pool.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
  if (!query) return FEATURED.map((id) => unique.find((a) => a.id === id)).filter((a): a is Asset => !!a);
  let hits = unique
    .map((a) => ({ a, r: rank(a, query) }))
    .filter((x) => x.r >= 0)
    .sort((x, y) => y.r - x.r)
    .slice(0, 40)
    .map((x) => x.a);
  if (isNative() && query.length >= 1) {
    try {
      const remote = await yahooSearch(query);
      const ids = new Set(hits.map((h) => h.id));
      hits = [...hits.slice(0, 6), ...remote.filter((r) => !ids.has(r.id)), ...hits.slice(6)].slice(0, 40);
    } catch {
      // offline: local results only
    }
  }
  return hits;
}

export const assetTitle = (a: Asset) => (a.kind === 'crypto' ? cryptoName(a) : a.name);
