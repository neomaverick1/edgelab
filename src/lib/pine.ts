// Writes any rule-builder strategy as a TradingView Pine Script v6 strategy with the same rules, exits and costs.
import { indicator, PINE_SOURCE } from './catalog';
import { instanceKey, operandLabel, type IndOperand, type Operand, type Rule, type RuleGroup, type Strategy } from './rules';

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(8)));

export function toPine(s: Strategy, title = s.name, fromDay = '2020-01-01'): string {
  const decl: string[] = [];
  const vars = new Map<string, { v: string; out: Record<string, string> }>();
  let counter = 0;

  const operand = (o: Operand): string => {
    if (o.kind === 'num') return fmt(o.v);
    const key = instanceKey(o);
    let entry = vars.get(key);
    if (!entry) {
      const def = indicator(o.id);
      const v = `${def.id.replace(/[^a-z]/g, '')}${++counter}_`;
      const src = PINE_SOURCE[o.src ?? def.source ?? 'close'];
      const res = def.pine(o.p, src, v);
      if (res.lines?.length) decl.push(`// ${operandLabel({ ...o, out: undefined, ago: 0 } as IndOperand)}`, ...res.lines);
      entry = { v, out: res.out };
      vars.set(key, entry);
    }
    const def = indicator(o.id);
    const expr = entry.out[o.out ?? def.outputs[0].key];
    return o.ago ? `${wrap(expr)}[${o.ago}]` : expr;
  };
  const wrap = (e: string) => (/^[\w.]+$/.test(e) ? e : `(${e})`);

  const ruleExpr = (r: Rule): string => {
    const a = operand(r.a);
    const b = operand(r.b);
    let e: string;
    switch (r.cmp) {
      case 'xup':
        e = `ta.crossover(${a}, ${b})`;
        break;
      case 'xdn':
        e = `ta.crossunder(${a}, ${b})`;
        break;
      case 'gt':
        e = `${a} > ${b}`;
        break;
      case 'lt':
        e = `${a} < ${b}`;
        break;
      case 'gte':
        e = `${a} >= ${b}`;
        break;
      case 'lte':
        e = `${a} <= ${b}`;
        break;
      case 'rising':
        e = `${wrap(a)} > ${wrap(a)}[${r.bars ?? 1}]`;
        break;
      case 'falling':
        e = `${wrap(a)} < ${wrap(a)}[${r.bars ?? 1}]`;
        break;
    }
    return r.within && r.within > 1 ? `(ta.barssince(${e}) < ${r.within})` : `(${e})`;
  };
  const groupExpr = (g: RuleGroup, empty: string): string => {
    if (!g.items.length) return empty;
    const parts = g.items.map((it) => (it.type === 'rule' ? ruleExpr(it) : `(${groupExpr(it, g.mode === 'all' ? 'true' : 'false')})`));
    return parts.join(g.mode === 'all' ? ' and ' : ' or ');
  };

  const long = s.side !== 'short';
  const short = s.side !== 'long';
  const conds = [
    `longEntry = ${long ? groupExpr(s.longEntry, 'false') : 'false'}`,
    `longExit = ${long ? groupExpr(s.longExit, 'false') : 'false'}`,
    `shortEntry = ${short ? groupExpr(s.shortEntry, 'false') : 'false'}`,
    `shortExit = ${short ? groupExpr(s.shortExit, 'false') : 'false'}`,
    `filterOk = ${groupExpr(s.filter, 'true')}`,
  ];

  const e = s.exits;
  const sz = s.sizing;
  const pyramiding = sz.scaleIn.on ? sz.scaleIn.max + 1 : 1;
  const qtyHeader =
    sz.mode === 'equity'
      ? `default_qty_type = strategy.percent_of_equity, default_qty_value = ${fmt(Math.min(sz.value, 100 * sz.leverage))}`
      : 'default_qty_type = strategy.fixed, default_qty_value = 1';

  const L: string[] = [];
  L.push('//@version=6');
  L.push(`// ${title}`);
  L.push('// Exported from Edgelab. Signals are read at the close and filled at the next open, as in the backtest.');
  L.push(
    `strategy(${JSON.stringify(title)}, overlay = true, initial_capital = ${fmt(s.costs.capital)}, ${qtyHeader}, commission_type = strategy.commission.percent, commission_value = ${fmt(s.costs.feePct)}, slippage = 0, pyramiding = ${pyramiding}, margin_long = ${fmt(100 / sz.leverage)}, margin_short = ${fmt(100 / sz.leverage)})`,
  );
  L.push('');
  L.push(`fromDate = input.time(timestamp("${fromDay || '2000-01-01'}T00:00:00"), "Start date")`);
  L.push('inWindow = time >= fromDate');
  L.push('');

  // Build conditions first so indicator declarations are collected.
  const condLines = conds;
  if (decl.length) {
    L.push('// Indicators');
    L.push(...decl);
    L.push('');
  }
  L.push('// Rules');
  L.push(...condLines);
  L.push('');

  // Exits and sizing
  const atrLen = Math.max(1, e.atrLength);
  L.push('// Risk');
  L.push(`atrNow = ta.atr(${atrLen})`);
  L.push('var float entryAtr = na');
  L.push('var int entryBar = na');
  L.push('var float extreme = na');
  L.push('var bool beArmed = false');
  L.push('var bool trailOn = false');
  L.push('newPos = strategy.position_size != 0 and (strategy.position_size[1] == 0 or math.sign(strategy.position_size) != math.sign(strategy.position_size[1]))');
  L.push('if newPos');
  L.push('    entryAtr := atrNow[1]');
  L.push('    entryBar := bar_index');
  L.push('    extreme := strategy.position_avg_price');
  L.push('    beArmed := false');
  L.push(`    trailOn := ${e.trail.on && e.trail.activate <= 0 ? 'true' : 'false'}`);
  L.push('isLong = strategy.position_size > 0');
  L.push('isShort = strategy.position_size < 0');
  L.push('avgPrice = strategy.position_avg_price');
  const stopDist = e.stop.on ? (e.stop.unit === 'pct' ? `avgPrice * ${fmt(e.stop.value / 100)}` : `entryAtr * ${fmt(e.stop.value)}`) : 'na';
  L.push(`stopDist = ${stopDist}`);
  L.push('dirSign = isLong ? 1 : -1');
  if (e.stop.on) L.push('fixedStop = avgPrice - dirSign * stopDist');
  if (e.trail.on) {
    const td = e.trail.unit === 'pct' ? `extreme * ${fmt(e.trail.value / 100)}` : `atrNow[1] * ${fmt(e.trail.value)}`;
    L.push(`trailStop = trailOn ? extreme - dirSign * ${td} : na`);
  }
  if (e.breakeven.on) {
    const need = e.breakeven.unit === 'pct' ? `avgPrice * ${fmt(e.breakeven.value / 100)}` : `stopDist * ${fmt(e.breakeven.value)}`;
    L.push(`beLevel = beArmed ? avgPrice : na`);
    L.push(`if strategy.position_size != 0 and not beArmed and (isLong ? high - avgPrice : avgPrice - low) >= ${need}`);
    L.push('    beArmed := true');
  }
  const parts = [e.stop.on ? 'fixedStop' : null, e.trail.on ? 'trailStop' : null, e.breakeven.on ? 'beLevel' : null].filter(Boolean) as string[];
  if (parts.length) {
    L.push('float stopLevel = na');
    for (const p of parts) L.push(`stopLevel := na(${p}) ? stopLevel : na(stopLevel) ? ${p} : isLong ? math.max(stopLevel, ${p}) : math.min(stopLevel, ${p})`);
  } else L.push('float stopLevel = na');

  // Entry size
  let qtyArg = '';
  if (sz.mode === 'risk') {
    const dist = e.stop.on ? (e.stop.unit === 'pct' ? `close * ${fmt(e.stop.value / 100)}` : `atrNow * ${fmt(e.stop.value)}`) : 'close';
    L.push(`riskQty = math.min(strategy.equity * ${fmt(sz.value / 100)} / ${dist}, strategy.equity * ${fmt(sz.leverage)} / close)`);
    qtyArg = ', qty = riskQty';
  } else if (sz.mode === 'cash') {
    L.push(`cashQty = math.min(${fmt(sz.value)}, strategy.equity * ${fmt(sz.leverage)}) / close`);
    qtyArg = ', qty = cashQty';
  }
  L.push('');
  L.push('// Orders');
  if (long) {
    L.push('if inWindow and longEntry and filterOk and strategy.position_size <= 0');
    L.push(`    strategy.entry("Long", strategy.long${qtyArg})`);
    if (sz.scaleIn.on)
      L.push(
        `if inWindow and longEntry and filterOk and strategy.position_size > 0 and strategy.opentrades < ${pyramiding}${sz.scaleIn.onlyInProfit ? ' and close > avgPrice' : ''}`,
        `    strategy.order("Long add", strategy.long, qty = math.abs(strategy.opentrades.size(0)) * ${fmt(sz.scaleIn.size / 100)})`,
      );
    L.push('if longExit and isLong');
    L.push('    strategy.close("Long", comment = "Exit signal")');
  }
  if (short) {
    L.push('if inWindow and shortEntry and filterOk and strategy.position_size >= 0');
    L.push(`    strategy.entry("Short", strategy.short${qtyArg})`);
    if (sz.scaleIn.on)
      L.push(
        `if inWindow and shortEntry and filterOk and strategy.position_size < 0 and strategy.opentrades < ${pyramiding}${sz.scaleIn.onlyInProfit ? ' and close < avgPrice' : ''}`,
        `    strategy.order("Short add", strategy.short, qty = math.abs(strategy.opentrades.size(0)) * ${fmt(sz.scaleIn.size / 100)})`,
      );
    L.push('if shortExit and isShort');
    L.push('    strategy.close("Short", comment = "Exit signal")');
  }
  if (e.time.on) {
    L.push(`if strategy.position_size != 0 and bar_index - entryBar + 1 >= ${e.time.bars}`);
    L.push('    strategy.close_all(comment = "Time exit")');
  }

  // Protective and profit orders
  const sideNames = [long ? ['Long', 'isLong'] : null, short ? ['Short', 'isShort'] : null].filter(Boolean) as [string, string][];
  const targets = e.targets.on ? e.targets.levels : [];
  for (const [name, cond] of sideNames) {
    if (!targets.length && !parts.length) continue;
    L.push(`if ${cond}`);
    if (targets.length) {
      targets.forEach((t, i) => {
        const d = t.unit === 'pct' ? `avgPrice * ${fmt(t.value / 100)}` : t.unit === 'atr' ? `entryAtr * ${fmt(t.value)}` : `stopDist * ${fmt(t.value)}`;
        const last = i === targets.length - 1;
        L.push(
          `    strategy.exit("${name} TP${i + 1}", "${name}", qty_percent = ${last ? 100 : fmt(t.size)}, limit = avgPrice + dirSign * ${d}, stop = stopLevel)`,
        );
      });
    } else L.push(`    strategy.exit("${name} stop", "${name}", stop = stopLevel)`);
  }
  if (e.trail.on || e.breakeven.on) {
    L.push('if strategy.position_size != 0');
    L.push('    extreme := isLong ? math.max(extreme, high) : math.min(extreme, low)');
    if (e.trail.on && e.trail.activate > 0) L.push(`    trailOn := trailOn or (isLong ? high / avgPrice - 1 : 1 - low / avgPrice) * 100 >= ${fmt(e.trail.activate)}`);
  }
  L.push('');
  L.push('plotshape(longEntry and filterOk, "Long signal", shape.triangleup, location.belowbar, color.new(color.teal, 0), size = size.tiny)');
  if (short) L.push('plotshape(shortEntry and filterOk, "Short signal", shape.triangledown, location.abovebar, color.new(color.red, 0), size = size.tiny)');
  L.push('plot(stopLevel, "Stop", color.new(color.red, 30), style = plot.style_linebr)');
  return L.join('\n') + '\n';
}
