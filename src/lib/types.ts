/** One price bar. `time` is when the bar opened, in Unix seconds (UTC). */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type ExitReason =
  | 'signal'
  | 'stop'
  | 'trailing-stop'
  | 'breakeven'
  | 'take-profit'
  | 'time'
  | 'reverse'
  | 'liquidated'
  | 'end';

/** One fill that closed part or all of a position. */
export interface ExitFill {
  index: number;
  time: number;
  price: number;
  qty: number;
  reason: ExitReason;
}

/** A position from its first entry to its last exit, including any scale-ins and partial exits. */
export interface Trade {
  side: 'long' | 'short';
  entryIndex: number;
  exitIndex: number;
  entryTime: number;
  exitTime: number;
  entryPrice: number; // average entry price
  exitPrice: number; // average exit price
  qty: number; // largest size held
  adds: number; // scale-ins after the first entry
  pnl: number; // after fees
  pnlPct: number; // pnl relative to the money put in
  equityPct: number; // pnl relative to the account when the trade opened
  r: number | null; // pnl in multiples of the initial risk, when a stop was set
  fees: number;
  bars: number;
  reason: ExitReason; // what closed the last part
  fills: ExitFill[];
  mae: number; // worst move against the trade, as a fraction of entry
  mfe: number; // best move in favour, as a fraction of entry
}
