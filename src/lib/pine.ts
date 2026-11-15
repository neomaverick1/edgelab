import type { Strategy } from './strategies';
import type { Params, Settings } from './types';

const num = (v: number) => String(Number(v.toFixed(4)));

interface PineParts {
  inputs: string[];
  calc: string[];
  plots: string[];
  long: string;
  exitLong: string;
  short: string;
  exitShort: string;
  overlay: boolean;
}

function parts(strategy: Strategy, p: Params): PineParts {
  switch (strategy.id) {
    case 'sma-cross':
    case 'ema-cross': {
      const fn = strategy.id === 'sma-cross' ? 'ta.sma' : 'ta.ema';
      const tag = strategy.id === 'sma-cross' ? 'SMA' : 'EMA';
      return {
        inputs: [`fastLen = input.int(${p.fast}, "Fast ${tag}", minval = 1)`, `slowLen = input.int(${p.slow}, "Slow ${tag}", minval = 2)`],
        calc: [`fast = ${fn}(close, fastLen)`, `slow = ${fn}(close, slowLen)`],
        plots: [`plot(fast, "Fast ${tag}", color.orange)`, `plot(slow, "Slow ${tag}", color.blue)`],
        long: 'ta.crossover(fast, slow)',
        exitLong: 'ta.crossunder(fast, slow)',
        short: 'ta.crossunder(fast, slow)',
        exitShort: 'ta.crossover(fast, slow)',
        overlay: true,
      };
    }
    case 'rsi':
      return {
        inputs: [
          `rsiLen = input.int(${p.period}, "RSI length", minval = 2)`,
          `oversold = input.float(${num(p.oversold)}, "Oversold")`,
          `overbought = input.float(${num(p.overbought)}, "Overbought")`,
        ],
        calc: ['r = ta.rsi(close, rsiLen)'],
        plots: ['// Add the built-in RSI indicator to see the levels on the chart.'],
        long: 'ta.crossover(r, oversold)',
        exitLong: 'ta.crossover(r, overbought)',
        short: 'ta.crossunder(r, overbought)',
        exitShort: 'ta.crossunder(r, oversold)',
        overlay: true,
      };
    case 'bollinger':
      return {
        inputs: [
          `bbLen = input.int(${p.period}, "Length", minval = 2)`,
          `bbWidth = input.float(${num(p.width)}, "Band width (std dev)", step = 0.25)`,
        ],
        calc: ['[mid, upper, lower] = ta.bb(close, bbLen, bbWidth)'],
        plots: [
          'plot(upper, "Upper band", color.purple)',
          'plot(mid, "Middle band", color.gray)',
          'plot(lower, "Lower band", color.purple)',
        ],
        long: 'ta.crossover(close, lower)',
        exitLong: 'ta.crossover(close, mid)',
        short: 'ta.crossunder(close, upper)',
        exitShort: 'ta.crossunder(close, mid)',
        overlay: true,
      };
    case 'donchian':
      return {
        inputs: [
          `entryLen = input.int(${p.entry}, "Entry window", minval = 1)`,
          `exitLen = input.int(${p.exit}, "Exit window", minval = 1)`,
        ],
        calc: [
          '// Channels of the bars before this one, so a close can break out of them.',
          'entryHigh = ta.highest(high, entryLen)[1]',
          'entryLow = ta.lowest(low, entryLen)[1]',
          'exitHigh = ta.highest(high, exitLen)[1]',
          'exitLow = ta.lowest(low, exitLen)[1]',
        ],
        plots: ['plot(entryHigh, "Entry high", color.blue)', 'plot(exitLow, "Exit low", color.fuchsia)'],
        long: 'ta.crossover(close, entryHigh)',
        exitLong: 'ta.crossunder(close, exitLow)',
        short: 'ta.crossunder(close, entryLow)',
        exitShort: 'ta.crossover(close, exitHigh)',
        overlay: true,
      };
    default:
      return {
        inputs: [
          `fastLen = input.int(${p.fast}, "Fast EMA", minval = 1)`,
          `slowLen = input.int(${p.slow}, "Slow EMA", minval = 2)`,
          `signalLen = input.int(${p.signal}, "Signal", minval = 1)`,
        ],
        calc: ['[macdLine, signalLine, hist] = ta.macd(close, fastLen, slowLen, signalLen)'],
        plots: ['// Add the built-in MACD indicator to see the lines on the chart.'],
        long: 'ta.crossover(macdLine, signalLine)',
        exitLong: 'ta.crossunder(macdLine, signalLine)',
        short: 'ta.crossunder(macdLine, signalLine)',
        exitShort: 'ta.crossover(macdLine, signalLine)',
        overlay: true,
      };
  }
}

/** The same strategy as a TradingView Pine Script v6 strategy, ready to paste into the Pine Editor. */
export function pineScript(strategy: Strategy, p: Params, s: Settings, opts: { market: string; from: string; to: string | null }): string {
  const x = parts(strategy, p);
  const both = s.direction === 'both';
  const L: string[] = [];
  const blank = () => L.push('');

  L.push('//@version=6');
  L.push(
    `strategy("Edgelab: ${strategy.name}", overlay = ${x.overlay}, initial_capital = ${num(s.capital)}, default_qty_type = strategy.percent_of_equity, default_qty_value = ${num(s.sizePct)}, commission_type = strategy.commission.percent, commission_value = ${num(s.feePct)}, pyramiding = 0)`,
  );
  blank();
  L.push(`// Exported from Edgelab for ${opts.market}. ${strategy.rules.join(' ')}`);
  L.push('// Signals are read at the bar close and filled at the next open, the same as in Edgelab.');
  if (s.slippagePct > 0)
    L.push(`// Edgelab charged ${num(s.slippagePct)}% slippage per fill. In TradingView, set slippage (in ticks) under Properties.`);
  blank();
  L.push(`startTime = input.time(timestamp("${opts.from}T00:00:00"), "Start date")`);
  if (opts.to) L.push(`endTime = input.time(timestamp("${opts.to}T23:59:59"), "End date")`);
  L.push(`inWindow = time >= startTime${opts.to ? ' and time <= endTime' : ''}`);
  blank();
  L.push(...x.inputs);
  L.push(...x.calc);
  L.push(...x.plots);
  blank();

  if (s.trendFilter > 0) {
    L.push(`trendLen = input.int(${s.trendFilter}, "Trend filter SMA", minval = 2)`);
    L.push('trendSma = ta.sma(close, trendLen)');
    L.push('plot(trendSma, "Trend filter", color.gray)');
    L.push(`longOk = close > trendSma${both ? '\nshortOk = close < trendSma' : ''}`);
  } else {
    L.push(`longOk = true${both ? '\nshortOk = true' : ''}`);
  }
  blank();

  L.push(`longSignal = ${x.long}`);
  L.push(`exitLongSignal = ${x.exitLong}`);
  if (both) {
    L.push(`shortSignal = ${x.short}`);
    L.push(`exitShortSignal = ${x.exitShort}`);
  }
  blank();

  L.push('if inWindow');
  L.push('    if strategy.position_size > 0');
  if (both) {
    L.push('        if shortSignal and shortOk');
    L.push('            strategy.entry("Short", strategy.short)');
    L.push('        else if exitLongSignal');
    L.push('            strategy.close("Long")');
    L.push('    else if strategy.position_size < 0');
    L.push('        if longSignal and longOk');
    L.push('            strategy.entry("Long", strategy.long)');
    L.push('        else if exitShortSignal');
    L.push('            strategy.close("Short")');
    L.push('    else if longSignal and longOk');
    L.push('        strategy.entry("Long", strategy.long)');
    L.push('    else if shortSignal and shortOk');
    L.push('        strategy.entry("Short", strategy.short)');
  } else {
    L.push('        if exitLongSignal');
    L.push('            strategy.close("Long")');
    L.push('    else if longSignal and longOk');
    L.push('        strategy.entry("Long", strategy.long)');
  }
  if (opts.to) {
    blank();
    L.push('if time > endTime');
    L.push('    strategy.close_all()');
  }

  const stop = s.stopPct > 0;
  const target = s.takeProfitPct > 0;
  const trail = s.trailPct > 0;
  if (stop || target || trail) {
    blank();
    L.push('// Stops and targets. Before the entry fills, levels are based on the close; afterwards on the fill price.');
    if (stop) L.push(`stopPct = input.float(${num(s.stopPct)}, "Stop loss %", minval = 0, step = 0.5) / 100`);
    if (target) L.push(`targetPct = input.float(${num(s.takeProfitPct)}, "Take profit %", minval = 0, step = 0.5) / 100`);
    if (trail) L.push(`trailPct = input.float(${num(s.trailPct)}, "Trailing stop %", minval = 0, step = 0.5) / 100`);
    if (trail) {
      L.push('var float peak = na');
      L.push('peak := strategy.position_size > 0 ? math.max(nz(peak, strategy.position_avg_price), high) : na');
      if (both) {
        L.push('var float trough = na');
        L.push('trough := strategy.position_size < 0 ? math.min(nz(trough, strategy.position_avg_price), low) : na');
      }
    }
    const sides: { name: 'Long' | 'Short'; sign: 1 | -1 }[] = both
      ? [
          { name: 'Long', sign: 1 },
          { name: 'Short', sign: -1 },
        ]
      : [{ name: 'Long', sign: 1 }];
    for (const side of sides) {
      const isLong = side.sign === 1;
      const base = `${side.name.toLowerCase()}Base`;
      L.push(`${base} = strategy.position_size ${isLong ? '>' : '<'} 0 ? strategy.position_avg_price : close`);
      const levels: string[] = [];
      if (stop) levels.push(`${base} * (1 ${isLong ? '-' : '+'} stopPct)`);
      if (trail) levels.push(`nz(${isLong ? 'peak' : 'trough'}, ${base}) * (1 ${isLong ? '-' : '+'} trailPct)`);
      const args: string[] = [];
      if (levels.length) args.push(`stop = ${levels.length === 1 ? levels[0] : `math.${isLong ? 'max' : 'min'}(${levels.join(', ')})`}`);
      if (target) args.push(`limit = ${base} * (1 ${isLong ? '+' : '-'} targetPct)`);
      L.push(`strategy.exit("${side.name} exit", "${side.name}", ${args.join(', ')})`);
    }
  }

  return L.join('\n') + '\n';
}
