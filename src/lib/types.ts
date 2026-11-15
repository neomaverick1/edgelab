/** One price bar. `time` is when the bar opened, in Unix seconds (UTC). */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Params = Record<string, number>;

export type Direction = 'long' | 'both';

/** How trades are sized, protected and charged. Percentages are written as 0.1 for 0.1%. */
export interface Settings {
  capital: number;
  sizePct: number;
  feePct: number;
  slippagePct: number;
  stopPct: number; // 0 = off
  takeProfitPct: number; // 0 = off
  trailPct: number; // 0 = off
  direction: Direction;
  trendFilter: number; // SMA length, 0 = off
}

export type ExitReason = 'signal' | 'stop' | 'trailing-stop' | 'take-profit' | 'liquidated' | 'end';

export interface Trade {
  side: 'long' | 'short';
  entryIndex: number;
  exitIndex: number;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  pnl: number;
  pnlPct: number;
  fees: number;
  bars: number;
  reason: ExitReason;
}
