import { sma } from './indicators';
import type { Signals } from './strategies';
import type { Candle, ExitReason, Settings, Trade } from './types';

export interface Backtest {
  start: number; // first candle index tested
  end: number; // last candle index tested
  trades: Trade[];
  equity: number[]; // account value at each close, start..end
  benchmark: number[]; // buy & hold over the same bars
  position: number[]; // 1 long, -1 short, 0 flat at each close
  fees: number;
  slippage: number; // what slippage cost compared with the quoted prices
}

type Order = 'long' | 'short' | 'flat' | null;

/**
 * Event-driven backtest without look-ahead: signals are read at a bar's close and filled at the next bar's open.
 * Stops and targets are checked inside each bar using its high and low. When a bar could have hit both,
 * the stop is assumed to come first, and a gap through a level fills at the open.
 */
export function runBacktest(candles: readonly Candle[], sig: Signals, s: Settings, start: number, end: number): Backtest {
  const fee = s.feePct / 100;
  const slip = s.slippagePct / 100;
  const size = s.sizePct / 100;
  const stopPct = s.stopPct / 100;
  const targetPct = s.takeProfitPct / 100;
  const trailPct = s.trailPct / 100;
  const trend =
    s.trendFilter > 0
      ? sma(
          candles.map((c) => c.close),
          s.trendFilter,
        )
      : null;

  let cash = s.capital;
  let side = 0 as 0 | 1 | -1; // changed inside enter/exit, so it is kept as the full union
  let qty = 0;
  let entryPrice = 0;
  let entryIndex = 0;
  let entryFee = 0;
  let extreme = 0; // best price since entry: highest for longs, lowest for shorts
  let fees = 0;
  let slippage = 0;
  let order: Order = null;
  const trades: Trade[] = [];
  const equity: number[] = [];
  const position: number[] = [];

  const enter = (dir: 1 | -1, i: number, price: number) => {
    if (cash <= 0) return; // nothing left to trade with
    const fill = dir === 1 ? price * (1 + slip) : price * (1 - slip);
    const notional = (cash * size) / (1 + fee);
    const f = notional * fee;
    cash += dir === 1 ? -(notional + f) : notional - f;
    side = dir;
    qty = notional / fill;
    entryPrice = fill;
    entryIndex = i;
    entryFee = f;
    extreme = fill;
    fees += f;
    slippage += qty * Math.abs(fill - price);
  };

  // `atOpen`: the exit happened at the bar's open (a full bar fewer held). `market`: pays slippage (limit orders don't).
  const exit = (i: number, price: number, reason: ExitReason, atOpen: boolean, market = true) => {
    const fill = market ? (side === 1 ? price * (1 - slip) : price * (1 + slip)) : price;
    const notional = qty * fill;
    const f = notional * fee;
    cash += side === 1 ? notional - f : -(notional + f);
    const gross = side === 1 ? (fill - entryPrice) * qty : (entryPrice - fill) * qty;
    const pnl = gross - entryFee - f;
    trades.push({
      side: side === 1 ? 'long' : 'short',
      entryIndex,
      exitIndex: i,
      entryTime: candles[entryIndex].time,
      exitTime: candles[i].time,
      entryPrice,
      exitPrice: fill,
      qty,
      pnl,
      pnlPct: pnl / (qty * entryPrice),
      fees: entryFee + f,
      bars: Math.max(1, i - entryIndex + (atOpen ? 0 : 1)),
      reason,
    });
    fees += f;
    slippage += qty * Math.abs(fill - price);
    side = 0;
    qty = 0;
  };

  const decide = (i: number): Order => {
    const close = candles[i].close;
    const longOk = !trend || close > trend[i];
    const shortOk = s.direction === 'both' && (!trend || close < trend[i]);
    if (side === 1) return sig.short[i] && shortOk ? 'short' : sig.exitLong[i] ? 'flat' : null;
    if (side === -1) return sig.long[i] && longOk ? 'long' : sig.exitShort[i] ? 'flat' : null;
    return sig.long[i] && longOk ? 'long' : sig.short[i] && shortOk ? 'short' : null;
  };

  for (let i = start; i <= end; i++) {
    const c = candles[i];

    // 1. Orders placed at the previous close fill at this open.
    if (order) {
      const reverse = (order === 'long' && side === -1) || (order === 'short' && side === 1);
      if (side !== 0 && (order === 'flat' || reverse)) exit(i, c.open, 'signal', true);
      if (side === 0 && order === 'long') enter(1, i, c.open);
      if (side === 0 && order === 'short') enter(-1, i, c.open);
      order = null;
    }

    // 2. Stops and targets inside the bar.
    if (side === 1) {
      const fixed = stopPct > 0 ? entryPrice * (1 - stopPct) : -Infinity;
      const trailing = trailPct > 0 ? extreme * (1 - trailPct) : -Infinity;
      const stop = Math.max(fixed, trailing);
      const target = targetPct > 0 ? entryPrice * (1 + targetPct) : Infinity;
      const why: ExitReason = trailing > fixed ? 'trailing-stop' : 'stop';
      const fresh = i === entryIndex; // filled at this open, so the open can't have gapped past a level
      if (!fresh && c.open <= stop) exit(i, c.open, why, true);
      else if (!fresh && c.open >= target) exit(i, c.open, 'take-profit', true, false);
      else if (c.low <= stop) exit(i, stop, why, false);
      else if (c.high >= target) exit(i, target, 'take-profit', false, false);
      else extreme = Math.max(extreme, c.high);
    } else if (side === -1) {
      const fixed = stopPct > 0 ? entryPrice * (1 + stopPct) : Infinity;
      const trailing = trailPct > 0 ? extreme * (1 + trailPct) : Infinity;
      const stop = Math.min(fixed, trailing);
      const target = targetPct > 0 ? entryPrice * (1 - targetPct) : -Infinity;
      const why: ExitReason = trailing < fixed ? 'trailing-stop' : 'stop';
      const fresh = i === entryIndex;
      if (!fresh && c.open >= stop) exit(i, c.open, why, true);
      else if (!fresh && c.open <= target) exit(i, c.open, 'take-profit', true, false);
      else if (c.high >= stop) exit(i, stop, why, false);
      else if (c.low <= target) exit(i, target, 'take-profit', false, false);
      else extreme = Math.min(extreme, c.low);
      // A short can lose more than the account. Like an exchange, close it when the account would hit zero.
      const wipeout = side === -1 ? cash / qty : Infinity;
      if (c.high >= wipeout) {
        exit(i, wipeout, 'liquidated', false, false);
        cash = Math.max(0, cash);
      }
    }

    // 3. Close out whatever is still open on the last bar.
    if (i === end && side !== 0) exit(i, c.close, 'end', false);

    // 4. Mark to market, then read this bar's signals for the next open.
    equity.push(side === 1 ? cash + qty * c.close : side === -1 ? cash - qty * c.close : cash);
    position.push(side);
    if (i < end) order = decide(i);
  }

  return { start, end, trades, equity, benchmark: buyAndHold(candles, s, start, end), position, fees, slippage };
}

/** Buy at the first open with the same costs, hold, and sell at the last close. */
export function buyAndHold(candles: readonly Candle[], s: Settings, start: number, end: number): number[] {
  const fee = s.feePct / 100;
  const slip = s.slippagePct / 100;
  const notional = s.capital / (1 + fee);
  const qty = notional / (candles[start].open * (1 + slip));
  const out: number[] = [];
  for (let i = start; i <= end; i++) {
    const value = qty * candles[i].close;
    out.push(i === end ? value * (1 - slip) * (1 - fee) : value);
  }
  return out;
}
