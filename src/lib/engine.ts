// Event-driven backtest without look-ahead. Signals are read at a bar's close and filled at the next bar's open.
// Stops, trailing stops and take-profit levels are checked inside each bar from its high and low; when a bar could
// have hit both a stop and a target, the stop is assumed to come first. A gap through a level fills at the open.
import type { Signals, Strategy } from './rules';
import type { Candle, ExitFill, ExitReason, Trade } from './types';

export interface Backtest {
  start: number;
  end: number;
  trades: Trade[];
  equity: number[]; // account value at each close, start..end
  benchmark: number[]; // buy & hold over the same bars
  position: number[]; // 1 long, -1 short, 0 flat at each close
  fees: number;
  slippage: number;
  open: OpenPosition | null; // still open at the last bar (live paper trading keeps it open)
}

export interface OpenPosition {
  side: 'long' | 'short';
  qty: number;
  entryPrice: number;
  entryTime: number;
  stop: number | null;
  targets: number[];
  unrealized: number;
}

type Pending = { kind: 'enter'; dir: 1 | -1 } | { kind: 'exit'; reason: ExitReason } | { kind: 'reverse'; dir: 1 | -1 } | { kind: 'add' };

export interface RunOptions {
  start: number;
  end: number;
  keepOpen?: boolean; // leave the last position open instead of closing it on the final bar
}

const EPS = 1e-12;

export function runBacktest(candles: readonly Candle[], sig: Signals, s: Strategy, opts: RunOptions): Backtest {
  const { start, end } = opts;
  const fee = s.costs.feePct / 100;
  const slip = s.costs.slippagePct / 100;
  const ex = s.exits;
  const lev = Math.max(0.01, s.sizing.leverage);
  const atrAt = (i: number) => sig.atr[Math.max(0, i - 1)]; // the last closed bar's ATR: known at this bar's open

  let cash = s.costs.capital;
  let side = 0 as 0 | 1 | -1;
  let qty = 0;
  let avg = 0; // average entry price
  let entryIndex = 0;
  let entryEquity = 0;
  let firstNotional = 0;
  let firstFill = 0; // price of the first fill; the initial risk is measured from it
  let invested = 0;
  let tradeFees = 0;
  let tradeCash = 0; // cash flow of the current trade (entries negative for longs)
  let maxQty = 0;
  let adds = 0;
  let riskPerUnit = 0; // stop distance at entry, in price
  let atrEntry = 0;
  let extreme = 0;
  let trailOn = false;
  let beArmed = false;
  let targetsHit = 0;
  let fills: ExitFill[] = [];
  let worst = 0;
  let best = 0;
  let fees = 0;
  let slippage = 0;
  let pending: Pending | null = null;
  const trades: Trade[] = [];
  const equity: number[] = [];
  const position: number[] = [];

  const holding = () => side !== 0; // read through a function: exits inside a block change `side`
  const markValue = (price: number) => (side === 1 ? cash + qty * price : side === -1 ? cash - qty * price : cash);

  const stopDistance = (price: number, atrVal: number) =>
    ex.stop.on ? (ex.stop.unit === 'pct' ? (price * ex.stop.value) / 100 : atrVal * ex.stop.value) : 0;

  const buy = (dir: 1 | -1, price: number, notional: number) => {
    const fill = dir === 1 ? price * (1 + slip) : price * (1 - slip);
    const f = notional * fee;
    const q = notional / fill;
    cash += dir === 1 ? -(notional + f) : notional - f;
    tradeCash += dir === 1 ? -(notional + f) : notional - f;
    avg = (avg * qty + fill * q) / (qty + q);
    qty += q;
    maxQty = Math.max(maxQty, qty);
    invested += notional;
    tradeFees += f;
    fees += f;
    slippage += q * Math.abs(fill - price);
  };

  const enter = (dir: 1 | -1, i: number, price: number) => {
    const eq = cash;
    if (eq <= 0) return;
    const a = atrAt(i);
    const dist = stopDistance(price, a);
    let notional: number;
    if (s.sizing.mode === 'risk' && dist > 0) notional = ((eq * s.sizing.value) / 100) * (price / dist);
    else if (s.sizing.mode === 'cash') notional = s.sizing.value;
    else if (s.sizing.mode === 'risk') notional = eq;
    else notional = (eq * s.sizing.value) / 100;
    notional = Math.min(notional, eq * lev) / (1 + fee);
    if (!(notional > 0)) return;
    side = dir;
    qty = 0;
    avg = 0;
    entryIndex = i;
    entryEquity = eq;
    invested = 0;
    tradeFees = 0;
    tradeCash = 0;
    maxQty = 0;
    adds = 0;
    fills = [];
    targetsHit = 0;
    beArmed = false;
    atrEntry = a;
    buy(dir, price, notional);
    firstNotional = notional;
    firstFill = avg;
    riskPerUnit = dist;
    extreme = avg;
    trailOn = ex.trail.on && ex.trail.activate <= 0;
    worst = 0;
    best = 0;
  };

  const addTo = (price: number) => {
    const eq = markValue(price);
    const room = eq * lev - qty * price;
    const notional = Math.min((firstNotional * s.sizing.scaleIn.size) / 100, room) / (1 + fee);
    if (notional <= 0) return;
    buy(side as 1 | -1, price, notional);
    adds++;
  };

  /** Sells (or covers) `q` units at `price`. Market orders pay slippage; limit orders (targets) don't. */
  const reduce = (i: number, price: number, q: number, reason: ExitReason, market: boolean) => {
    q = Math.min(q, qty);
    const fill = market ? (side === 1 ? price * (1 - slip) : price * (1 + slip)) : price;
    const notional = q * fill;
    const f = notional * fee;
    cash += side === 1 ? notional - f : -(notional + f);
    tradeCash += side === 1 ? notional - f : -(notional + f);
    tradeFees += f;
    fees += f;
    slippage += q * Math.abs(fill - price);
    qty -= q;
    fills.push({ index: i, time: candles[i].time, price: fill, qty: q, reason });
    if (qty <= maxQty * 1e-9 + EPS) close(i, reason);
  };

  const close = (i: number, reason: ExitReason) => {
    const sold = fills.reduce((a, f) => a + f.qty, 0);
    const exitPrice = fills.reduce((a, f) => a + f.price * f.qty, 0) / (sold || 1);
    const pnl = tradeCash;
    const initialRisk = riskPerUnit > 0 ? riskPerUnit * (firstNotional / firstFill) : 0;
    trades.push({
      side: side === 1 ? 'long' : 'short',
      entryIndex,
      exitIndex: i,
      entryTime: candles[entryIndex].time,
      exitTime: candles[i].time,
      entryPrice: avg,
      exitPrice,
      qty: maxQty,
      adds,
      pnl,
      pnlPct: invested > 0 ? pnl / invested : 0,
      equityPct: entryEquity > 0 ? pnl / entryEquity : 0,
      r: initialRisk > 0 ? pnl / initialRisk : null,
      fees: tradeFees,
      bars: Math.max(1, i - entryIndex + 1),
      reason,
      fills,
      mae: worst,
      mfe: best,
    });
    side = 0;
    qty = 0;
    if (cash < 0 && Math.abs(cash) < 1e-6) cash = 0;
  };
  const exitAll = (i: number, price: number, reason: ExitReason, market = true) => reduce(i, price, qty, reason, market);

  /** Current protective level and what it is, for the side held. */
  const protect = (i: number): { level: number; reason: ExitReason } | null => {
    let level = side === 1 ? -Infinity : Infinity;
    let reason: ExitReason = 'stop';
    const better = (x: number) => (side === 1 ? x > level : x < level);
    if (ex.stop.on && riskPerUnit > 0) {
      const lv = side === 1 ? avg - riskPerUnit : avg + riskPerUnit;
      if (better(lv)) {
        level = lv;
        reason = 'stop';
      }
    }
    if (beArmed) {
      const lv = side === 1 ? avg * (1 + fee * 2) : avg * (1 - fee * 2);
      if (better(lv)) {
        level = lv;
        reason = 'breakeven';
      }
    }
    if (ex.trail.on && trailOn) {
      const d = ex.trail.unit === 'pct' ? (extreme * ex.trail.value) / 100 : atrAt(i) * ex.trail.value;
      const lv = side === 1 ? extreme - d : extreme + d;
      if (Number.isFinite(lv) && better(lv)) {
        level = lv;
        reason = 'trailing-stop';
      }
    }
    return Number.isFinite(level) ? { level, reason } : null;
  };

  const targetPrices = (): number[] => {
    if (!ex.targets.on) return [];
    return ex.targets.levels
      .map((l) => {
        const d = l.unit === 'pct' ? (avg * l.value) / 100 : l.unit === 'atr' ? atrEntry * l.value : riskPerUnit > 0 ? riskPerUnit * l.value : NaN;
        return side === 1 ? avg + d : avg - d;
      })
      .map((p, k) => ({ p, k }))
      .filter((x) => Number.isFinite(x.p))
      .sort((a, b) => (side === 1 ? a.p - b.p : b.p - a.p))
      .map((x) => x.p);
  };
  const targetSizes = (): number[] => {
    const lv = ex.targets.levels
      .map((l) => ({ l, d: l.unit === 'pct' ? (avg * l.value) / 100 : l.unit === 'atr' ? atrEntry * l.value : riskPerUnit * l.value }))
      .filter((x) => Number.isFinite(x.d) && (x.l.unit !== 'r' || riskPerUnit > 0))
      .sort((a, b) => a.d - b.d);
    return lv.map((x) => x.l.size);
  };

  for (let i = start; i <= end; i++) {
    const c = candles[i];

    // 1. Orders from the previous close fill at this open.
    if (pending) {
      const p = pending;
      pending = null;
      if (p.kind === 'exit' && side !== 0) exitAll(i, c.open, p.reason);
      else if (p.kind === 'reverse') {
        if (side !== 0) exitAll(i, c.open, 'reverse');
        enter(p.dir, i, c.open);
      } else if (p.kind === 'enter' && side === 0) {
        enter(p.dir, i, c.open);
      } else if (p.kind === 'add' && side !== 0) addTo(c.open);
    }

    // 2. Stops and targets inside the bar.
    if (side !== 0) {
      const fresh = i === entryIndex;
      const prot = protect(i);
      const tps = targetPrices();
      const sizes = targetSizes();
      const dir = side;
      const hitStop = (price: number) => (dir === 1 ? price <= prot!.level : price >= prot!.level);
      const hitTp = (price: number, tp: number) => (dir === 1 ? price >= tp : price <= tp);

      if (prot && !fresh && hitStop(c.open)) exitAll(i, c.open, prot.reason);
      else if (prot && hitStop(dir === 1 ? c.low : c.high)) exitAll(i, prot.level, prot.reason);
      if (holding()) {
        for (let k = targetsHit; k < tps.length && holding(); k++) {
          const tp = tps[k];
          const gap = !fresh && hitTp(c.open, tp);
          if (!gap && !hitTp(dir === 1 ? c.high : c.low, tp)) break;
          const last = k === tps.length - 1;
          const q = last ? qty : (maxQty * sizes[k]) / 100;
          targetsHit = k + 1;
          reduce(i, gap ? c.open : tp, q, 'take-profit', false);
        }
      }
      if (holding()) {
        // Liquidation: the account can't go below zero.
        const adverse = side === 1 ? c.low : c.high;
        if (markValue(adverse) <= 0) {
          const price = side === 1 ? -cash / qty : cash / qty;
          exitAll(i, price, 'liquidated', false);
          cash = Math.max(0, cash);
        }
      }
      if (holding()) {
        extreme = side === 1 ? Math.max(extreme, c.high) : Math.min(extreme, c.low);
        const move = side === 1 ? c.high / avg - 1 : 1 - c.low / avg;
        const against = side === 1 ? c.low / avg - 1 : 1 - c.high / avg;
        best = Math.max(best, move);
        worst = Math.min(worst, against);
        if (ex.trail.on && !trailOn && move * 100 >= ex.trail.activate) trailOn = true;
        if (ex.breakeven.on && !beArmed) {
          const need = ex.breakeven.unit === 'pct' ? ex.breakeven.value / 100 : riskPerUnit > 0 ? (ex.breakeven.value * riskPerUnit) / avg : Infinity;
          if (move >= need) beArmed = true;
        }
      }
    }

    // 3. The last bar closes whatever is still open (unless live trading keeps it running).
    if (i === end && side !== 0 && !opts.keepOpen) exitAll(i, c.close, 'end');

    // 4. Mark to market, then read this bar's signals for the next open.
    equity.push(markValue(c.close));
    position.push(side);
    if (i >= end) continue;
    const f = sig.filter[i] === 1;
    const wantLong = sig.longEntry[i] === 1 && f && s.side !== 'short';
    const wantShort = sig.shortEntry[i] === 1 && f && s.side !== 'long';
    if (side === 1) {
      if (wantShort) pending = { kind: 'reverse', dir: -1 };
      else if (sig.longExit[i]) pending = { kind: 'exit', reason: 'signal' };
      else if (ex.time.on && i - entryIndex + 1 >= ex.time.bars) pending = { kind: 'exit', reason: 'time' };
      else if (wantLong && s.sizing.scaleIn.on && adds < s.sizing.scaleIn.max && (!s.sizing.scaleIn.onlyInProfit || c.close > avg)) pending = { kind: 'add' };
    } else if (side === -1) {
      if (wantLong) pending = { kind: 'reverse', dir: 1 };
      else if (sig.shortExit[i]) pending = { kind: 'exit', reason: 'signal' };
      else if (ex.time.on && i - entryIndex + 1 >= ex.time.bars) pending = { kind: 'exit', reason: 'time' };
      else if (wantShort && s.sizing.scaleIn.on && adds < s.sizing.scaleIn.max && (!s.sizing.scaleIn.onlyInProfit || c.close < avg)) pending = { kind: 'add' };
    } else if (wantLong) pending = { kind: 'enter', dir: 1 };
    else if (wantShort) pending = { kind: 'enter', dir: -1 };
  }

  let open: OpenPosition | null = null;
  if (side !== 0) {
    const last = candles[end];
    const prot = protect(end + 1);
    open = {
      side: side === 1 ? 'long' : 'short',
      qty,
      entryPrice: avg,
      entryTime: candles[entryIndex].time,
      stop: prot?.level ?? null,
      targets: targetPrices().slice(targetsHit),
      unrealized: side === 1 ? (last.close - avg) * qty : (avg - last.close) * qty,
    };
  }

  return { start, end, trades, equity, benchmark: buyAndHold(candles, s, start, end), position, fees, slippage, open };
}

/** Buy at the first open with the same costs, hold, and sell at the last close. */
export function buyAndHold(candles: readonly Candle[], s: Strategy, start: number, end: number): number[] {
  const fee = s.costs.feePct / 100;
  const slip = s.costs.slippagePct / 100;
  const notional = s.costs.capital / (1 + fee);
  const q = notional / (candles[start].open * (1 + slip));
  const out: number[] = [];
  for (let i = start; i <= end; i++) {
    const value = q * candles[i].close;
    out.push(i === end ? value * (1 - slip) * (1 - fee) : value);
  }
  return out;
}
