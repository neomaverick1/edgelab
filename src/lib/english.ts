// Plain-English strategies: turns "buy when RSI is under 30 and close is above the 200 EMA, stop 2 ATR, take
// profit 3%" into rules, and turns rules back into a sentence. Runs locally; no AI service involved.
import { hasIndicator, indicator, INDICATORS, type Source } from './catalog';
import {
  blankStrategy,
  CMPS,
  formatNum,
  group,
  ind,
  num,
  operandLabel,
  rule,
  type Cmp,
  type IndOperand,
  type Operand,
  type Rule,
  type RuleGroup,
  type Strategy,
} from './rules';

export interface ParseResult {
  strategy: Strategy;
  understood: string[]; // short notes on what was read
  unknown: string[]; // fragments that couldn't be read
}

type Section = 'longEntry' | 'longExit' | 'shortEntry' | 'shortExit' | 'filter';

// ---------------------------------------------------------------------------------------------------------------
// Operands

const NUM = '(-?\\d+(?:\\.\\d+)?)';
interface Name {
  re: RegExp;
  id: string;
  out?: string;
  src?: Source;
  fixed?: number[]; // parameters implied by the words (fast / slow ...)
}

// Order matters: longer, more specific names first.
const NAMES: Name[] = [
  { re: /^(?:macd )?signal(?: line)?$/, id: 'macd', out: 'signal' },
  { re: /^macd (?:histogram|hist)$|^histogram$/, id: 'macd', out: 'hist' },
  { re: /^macd(?: line)?$/, id: 'macd', out: 'line' },
  { re: /^stoch(?:astic)? rsi(?: %?k)?$|^stochrsi$/, id: 'stochrsi', out: 'k' },
  { re: /^stoch(?:astic)? rsi %?d$/, id: 'stochrsi', out: 'd' },
  { re: /^(?:stoch(?:astic)? )?%d$|^stoch(?:astic)? d$/, id: 'stoch', out: 'd' },
  { re: /^(?:stoch(?:astic)?(?: %?k)?|%k)$/, id: 'stoch', out: 'k' },
  { re: /^(?:upper (?:bollinger )?band|bollinger upper(?: band)?|upper bb|bb upper)$/, id: 'bb', out: 'upper' },
  { re: /^(?:lower (?:bollinger )?band|bollinger lower(?: band)?|lower bb|bb lower)$/, id: 'bb', out: 'lower' },
  { re: /^(?:middle (?:bollinger )?band|bollinger (?:middle|mid|basis)|bb (?:mid|middle)|basis)$/, id: 'bb', out: 'mid' },
  { re: /^(?:%b|percent b|bollinger %b)$/, id: 'bb', out: 'percentB' },
  { re: /^(?:bandwidth|bollinger (?:band)?width|bb width)$/, id: 'bb', out: 'bandwidth' },
  { re: /^(?:upper keltner(?: channel)?|keltner upper)$/, id: 'keltner', out: 'upper' },
  { re: /^(?:lower keltner(?: channel)?|keltner lower)$/, id: 'keltner', out: 'lower' },
  { re: /^(?:keltner (?:middle|mid))$/, id: 'keltner', out: 'mid' },
  { re: /^(?:\+di|plus di|di\+|positive di)$/, id: 'adx', out: 'plus' },
  { re: /^(?:-di|minus di|di-|negative di)$/, id: 'adx', out: 'minus' },
  { re: /^adx$/, id: 'adx', out: 'adx' },
  { re: /^aroon up$/, id: 'aroon', out: 'up' },
  { re: /^aroon down$/, id: 'aroon', out: 'down' },
  { re: /^(?:fast )(?:ema|exponential moving average)$/, id: 'ema', fixed: [9] },
  { re: /^(?:slow )(?:ema|exponential moving average)$/, id: 'ema', fixed: [21] },
  { re: /^(?:fast )(?:sma|ma|moving average|simple moving average)$/, id: 'sma', fixed: [50] },
  { re: /^(?:slow )(?:sma|ma|moving average|simple moving average)$/, id: 'sma', fixed: [200] },
  { re: /^(?:ema|exponential moving average|exp moving average)$/, id: 'ema' },
  { re: /^(?:sma|ma|moving average|simple moving average|day average|average)$/, id: 'sma' },
  { re: /^(?:wma|weighted moving average)$/, id: 'wma' },
  { re: /^(?:hma|hull(?: moving average)?)$/, id: 'hma' },
  { re: /^(?:dema|double ema)$/, id: 'dema' },
  { re: /^vwap$/, id: 'vwap' },
  { re: /^(?:rsi|relative strength(?: index)?)$/, id: 'rsi' },
  { re: /^(?:cci|commodity channel index)$/, id: 'cci' },
  { re: /^(?:roc|rate of change)$/, id: 'roc' },
  { re: /^(?:momentum|mom)$/, id: 'mom' },
  { re: /^(?:williams %r|williams r|%r|willr)$/, id: 'willr' },
  { re: /^(?:mfi|money flow(?: index)?)$/, id: 'mfi' },
  { re: /^(?:obv|on[- ]balance volume)$/, id: 'obv' },
  { re: /^(?:cmf|chaikin money flow)$/, id: 'cmf' },
  { re: /^(?:atr ?%|atr percent)$/, id: 'atrp' },
  { re: /^(?:atr|average true range)$/, id: 'atr' },
  { re: /^(?:supertrend(?: line)?)$/, id: 'supertrend', out: 'line' },
  { re: /^(?:supertrend direction)$/, id: 'supertrend', out: 'dir' },
  { re: /^(?:psar|parabolic sar|sar)$/, id: 'psar' },
  { re: /^(?:tenkan(?:[- ]sen)?|conversion line)$/, id: 'ichimoku', out: 'tenkan' },
  { re: /^(?:kijun(?:[- ]sen)?|base line)$/, id: 'ichimoku', out: 'kijun' },
  { re: /^(?:span a|senkou a|cloud top)$/, id: 'ichimoku', out: 'spanA' },
  { re: /^(?:span b|senkou b)$/, id: 'ichimoku', out: 'spanB' },
  { re: /^(?:z-?score)$/, id: 'zscore' },
  { re: /^(?:slope|regression slope|trend slope)$/, id: 'slope' },
  { re: /^(?:std ?dev|standard deviation)$/, id: 'stdev' },
  { re: /^(?:average volume|volume average|avg volume|volume ma|volume sma)$/, id: 'volsma' },
  { re: /^(?:relative volume|rvol|rel vol)$/, id: 'rvol' },
  { re: /^(?:% change|change|price change|percent change|return)$/, id: 'change' },
  { re: /^(?:volume)$/, id: 'volume' },
  { re: /^(?:hour|hour of day|the hour|time)$/, id: 'hour' },
  { re: /^(?:day of week|weekday|day)$/, id: 'weekday' },
  { re: /^(?:month)$/, id: 'month' },
  { re: /^(?:price|close|closing price|last price|the price|candle close|it)$/, id: 'price', src: 'close' },
  { re: /^(?:open|opening price)$/, id: 'price', src: 'open' },
  { re: /^(?:high|the high)$/, id: 'price', src: 'high' },
  { re: /^(?:low|the low)$/, id: 'price', src: 'low' },
];

const UNIT = '(?:[- ]?(?:day|days|bar|bars|period|periods|hour|hours|week|weeks|candle|candles|length))?';

function clean(s: string) {
  return s
    .replace(/\bthe\b|\bits\b|\bof the\b|\bvalue\b|\blevel\b|\bline's\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseOperand(raw: string): Operand | null {
  let s = clean(raw);
  if (!s) return null;
  if (new RegExp(`^${NUM}\\s*%?$`).test(s)) return num(parseFloat(s));

  let ago = 0;
  const agoM = s.match(/\s*,?\s*(\d+) (?:bars?|candles?|days?|periods?) ago$/);
  if (agoM) {
    ago = +agoM[1];
    s = s.slice(0, agoM.index).trim();
  }
  const prevM = s.match(/^(?:yesterday's|previous|prior|last bar's|the previous|previous bar's) (.*)$/);
  if (prevM) {
    ago = Math.max(ago, 1);
    s = prevM[1].trim();
  }
  const withAgo = (o: IndOperand): IndOperand => (ago ? { ...o, ago } : o);

  // "20-day high", "55 bar low", "highest high of 20 bars", "20 day highest close"
  const hl = s.match(new RegExp(`^${NUM}${UNIT} (high|low|highest high|lowest low)$`)) ?? s.match(new RegExp(`^(high|low|highest high|lowest low) (?:of |over )?(?:the )?(?:last )?${NUM}${UNIT}$`));
  if (hl) {
    const [n, word] = /^\d/.test(hl[1]) ? [+hl[1], hl[2]] : [+hl[2], hl[1]];
    return withAgo(ind('donchian', [n], { out: word.includes('high') ? 'upper' : 'lower' }));
  }
  const hs = s.match(new RegExp(`^(highest|lowest) (close|high|low|open)(?: (?:of|over) (?:the )?(?:last )?${NUM}${UNIT})?$`));
  if (hs) return withAgo(ind(hs[1], [hs[3] ? +hs[3] : 20], { src: hs[2] as Source }));

  // "<n> <name>", "<name> <n>", "<name>(a, b, c)", "<n>-day <name>", "<name> of high"
  let src: Source | undefined;
  const srcM = s.match(/ (?:of|on) (close|open|high|low|hl2|hlc3|ohlc4|volume)$/);
  if (srcM) {
    src = srcM[1] as Source;
    s = s.slice(0, srcM.index).trim();
  }
  let params: number[] = [];
  let name = s;
  const paren = s.match(/^(.*?)\s*\(([\d.,\s]+)\)$/);
  const mid = s.match(/^([a-z%+-][a-z%+ -]*?) (-?[\d.]+(?:\s*[,/]\s*[\d.]+)*) ([a-z%+-][a-z%+ -]*)$/);
  const lead = s.match(new RegExp(`^${NUM}${UNIT} (.*)$`));
  const trail = s.match(new RegExp(`^(.*?)[ -]${NUM}(?:\\s*[,/]\\s*${NUM})?(?:\\s*[,/]\\s*${NUM})?${UNIT}$`));
  if (paren) {
    name = paren[1].trim();
    params = paren[2].split(/[,\s]+/).filter(Boolean).map(Number);
  } else if (mid && !/^(?:bars?|days?|candles?|periods?|hours?)\b/.test(mid[3])) {
    name = `${mid[1].trim()} ${mid[3].trim()}`;
    params = mid[2].split(/\s*[,/]\s*/).map(Number);
  } else if (lead) {
    params = [+lead[1]];
    name = lead[2].trim();
  } else if (trail && !/^-?\d/.test(trail[1])) {
    name = trail[1].trim();
    params = [trail[2], trail[3], trail[4]].filter((x) => x !== undefined).map(Number);
  }
  name = name.replace(/^(?:a|an) /, '').replace(/ line$/, (m) => (/macd|signal|supertrend/.test(name) ? m : '')).trim();

  for (const n of NAMES) {
    if (!n.re.test(name)) continue;
    const def = indicator(n.id);
    const p = def.params.map((x, k) => params[k] ?? n.fixed?.[k] ?? x.def);
    const o: IndOperand = ind(n.id, p);
    if (n.out && def.outputs.length > 1) o.out = n.out;
    if (n.src) o.src = n.src;
    else if (src && def.source) o.src = src;
    return withAgo(o);
  }
  // "<short name> <output>", e.g. "bb upper band", "adx +di", "ichimoku span a", or just a short name.
  for (const def of INDICATORS) {
    const short = def.short.toLowerCase();
    if (name !== short && !name.startsWith(`${short} `)) continue;
    const rest = name.slice(short.length).trim();
    const outKey = rest ? def.outputs.find((o) => o.label.toLowerCase().replace(/\s*\(.*\)$/, '') === rest)?.key : def.outputs[0].key;
    if (!outKey) continue;
    const p = def.params.map((x, k) => params[k] ?? x.def);
    const o: IndOperand = ind(def.id, p);
    if (def.outputs.length > 1) o.out = outKey;
    if (src && def.source) o.src = src;
    return withAgo(o);
  }
  if (hasIndicator(name)) return withAgo(ind(name, params.length ? params : undefined));
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Conditions

const OVERSOLD: Record<string, [number, number]> = { rsi: [30, 70], stoch: [20, 80], stochrsi: [20, 80], mfi: [20, 80], cci: [-100, 100], willr: [-80, -20], zscore: [-2, 2] };

const PATTERNS: [RegExp, string][] = [
  [/bullish engulfing/, 'bullEngulf'],
  [/bearish engulfing/, 'bearEngulf'],
  [/hammer/, 'hammer'],
  [/shooting star/, 'shootingStar'],
  [/inside (?:bar|candle|day)/, 'inside'],
  [/doji/, 'doji'],
];

type Node = Rule | RuleGroup;

function condition(raw: string): Node | null {
  const s = raw
    .replace(/^(?:when|if|once|on|while|as soon as|and|then)\s+/, '')
    .replace(/^(?:a|an)\s+/, '')
    .replace(/\s+(?:happens|occurs|prints|forms|appears)$/, '')
    .trim();
  if (!s) return null;
  let m: RegExpMatchArray | null;

  if (/^golden cross$/.test(s)) return rule(ind('sma', [50]), 'xup', ind('sma', [200]));
  if (/^death cross$/.test(s)) return rule(ind('sma', [50]), 'xdn', ind('sma', [200]));

  for (const [re, out] of PATTERNS) if (re.test(s)) return rule(ind('pattern', [], { out }), 'gte', num(1));
  if ((m = s.match(/^(\d+) (?:green|up|higher|white|rising) (?:candles?|bars?|closes?|days?)(?: in a row)?$/))) return rule(ind('pattern', [], { out: 'upStreak' }), 'gte', num(+m[1]));
  if ((m = s.match(/^(\d+) (?:red|down|lower|black|falling) (?:candles?|bars?|closes?|days?)(?: in a row)?$/))) return rule(ind('pattern', [], { out: 'downStreak' }), 'gte', num(+m[1]));

  if ((m = s.match(/^(.+?) (?:is |gets |becomes |turns )?(oversold|overbought)$/))) {
    const a = parseOperand(m[1]);
    if (a?.kind === 'ind' && OVERSOLD[a.id]) return rule(a, m[2] === 'oversold' ? 'lt' : 'gt', num(OVERSOLD[a.id][m[2] === 'oversold' ? 0 : 1]));
  }
  if ((m = s.match(/^(?:volume )?(?:is )?(?:a )?volume spike$|^volume spikes?$/))) return rule(ind('rvol'), 'gt', num(2));
  if ((m = s.match(/^volume (?:is )?(?:above|over|more than) (\d+(?:\.\d+)?) ?(?:x|times) (?:its |the )?(?:average|normal)/))) return rule(ind('rvol'), 'gt', num(+m[1]));
  if ((m = s.match(/^supertrend (?:is |turns |flips )?(up|bullish|green|down|bearish|red)$/))) {
    const up = /up|bullish|green/.test(m[1]);
    return rule(ind('supertrend', undefined, { out: 'dir' }), s.includes('turns') || s.includes('flips') ? (up ? 'xup' : 'xdn') : up ? 'gt' : 'lt', num(0));
  }
  if ((m = s.match(/^(.+?) (?:is )?(above|below) (?:the )?(?:ichimoku )?cloud$/))) {
    const a = parseOperand(m[1]);
    if (a?.kind === 'ind') {
      const cmp: Cmp = m[2] === 'above' ? 'gt' : 'lt';
      return group('all', [rule(a, cmp, ind('ichimoku', undefined, { out: 'spanA' })), rule(a, cmp, ind('ichimoku', undefined, { out: 'spanB' }))]);
    }
  }
  if ((m = s.match(/^(?:it'?s |on )?(?:a )?weekdays?$/))) return group('all', [rule(ind('weekday'), 'gte', num(1)), rule(ind('weekday'), 'lte', num(5))]);
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  if ((m = s.match(/^(?:it'?s |on )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?$/))) {
    const d = DAYS.indexOf(m[1]);
    return group('all', [rule(ind('weekday'), 'gte', num(d)), rule(ind('weekday'), 'lte', num(d))]);
  }
  if ((m = s.match(/^(?:the )?(.+?) (?:breaks|breaks out|closes|moves|pushes)( above| over| below| under)?(?: to)? (?:a )?new (\d+)[- ]?(?:day|bar|period|hour|week)? (high|low)$/))) {
    const a = parseOperand(m[1]);
    if (a?.kind === 'ind') return rule(a, m[4] === 'high' ? 'xup' : 'xdn', ind('donchian', [+m[3]], { out: m[4] === 'high' ? 'upper' : 'lower' }));
  }
  if ((m = s.match(/^(?:a )?new (\d+)[- ]?(?:day|bar|period|hour|week)? (high|low)$/))) {
    return rule(ind('price'), m[2] === 'high' ? 'xup' : 'xdn', ind('donchian', [+m[1]], { out: m[2] === 'high' ? 'upper' : 'lower' }));
  }
  if ((m = s.match(/^(.+?) (?:turns|goes|flips|crosses) (positive|negative|green|red|bullish|bearish)$/))) {
    const a = parseOperand(m[1]);
    if (a?.kind === 'ind') return rule(a, /positive|green|bullish/.test(m[2]) ? 'xup' : 'xdn', num(0));
  }
  if ((m = s.match(/^(.+?) (?:is |stays |trades )?between (-?[\d.]+) and (-?[\d.]+)$/))) {
    const a = parseOperand(m[1]);
    if (a?.kind === 'ind') return group('all', [rule(a, 'gte', num(Math.min(+m[2], +m[3]))), rule(a, 'lte', num(Math.max(+m[2], +m[3])))]);
  }
  if ((m = s.match(/^(.+?) (?:is |has been |keeps )?(rising|falling|going up|going down|increasing|decreasing|turning up|turning down|sloping up|sloping down|up|down)(?: (?:for|over) (?:the )?(?:last )?(\d+) (?:bars?|days?|candles?|periods?))?$/))) {
    const a = parseOperand(m[1]);
    if (a?.kind === 'ind') return rule(a, /rising|up|increasing/.test(m[2]) ? 'rising' : 'falling', num(0), m[3] ? { bars: +m[3] } : {});
  }

  const COMPARE: [RegExp, Cmp][] = [
    [/\s+(?:crosses|crossed|cross|breaks|breaks out|closes|moves|pushes|cuts)\s+(?:above|over|up through|up)\s+/, 'xup'],
    [/\s+(?:crosses|crossed|cross|breaks|breaks down|closes|moves|drops|falls|cuts)\s+(?:below|under|down through|down)\s+/, 'xdn'],
    [/\s+(?:is |stays |closes |trades )?(?:at or above|>=|≥|at least)\s+/, 'gte'],
    [/\s+(?:is |stays |closes |trades )?(?:at or below|<=|≤|at most)\s+/, 'lte'],
    [/\s+(?:is |stays |closes |trades |holds )?(?:above|over|greater than|higher than|more than|exceeds|>|bigger than)\s+/, 'gt'],
    [/\s+(?:is |stays |closes |trades |holds )?(?:below|under|less than|lower than|<|smaller than|drops below|falls below)\s+/, 'lt'],
  ];
  for (const [re, cmp] of COMPARE) {
    const parts = s.split(re);
    if (parts.length !== 2) continue;
    const left = parts[0];
    let right = parts[1];
    let within: number | undefined;
    const w = right.match(/\s+(?:in|within) (?:the )?(?:last|past) (\d+) (?:bars?|candles?|days?|periods?)$/);
    if (w) {
      within = +w[1];
      right = right.slice(0, w.index);
    }
    const a = parseOperand(left);
    const b = parseOperand(right);
    // "rsi 14 crosses above 30" or "30 is below rsi" both work.
    if (a?.kind === 'num' && b?.kind === 'ind') {
      const flipped: Record<Cmp, Cmp> = { gt: 'lt', lt: 'gt', gte: 'lte', lte: 'gte', xup: 'xdn', xdn: 'xup', rising: 'rising', falling: 'falling' };
      return rule(b, flipped[cmp], a, within ? { within } : {});
    }
    // "price crosses above ema" with no period on either side → the indicator's default
    if (a?.kind === 'ind' && b) return rule(a, cmp, b, within ? { within } : {});
    // "close is above 200 ema of high" etc. handled by parseOperand; left unknown → try implied price.
    if (!a && b && /^(?:it|price|the price)$/.test(left.trim())) return rule(ind('price'), cmp, b);
  }
  return null;
}

/** Splits on "or" at the top and "and" inside, so "a and b or c" reads as (a and b) or c. */
function conditions(text: string): { node: RuleGroup | null; unknown: string[] } {
  const unknown: string[] = [];
  const ors = text.split(/\s+(?:or|\|\|)\s+/);
  const alts: RuleGroup[] = [];
  for (const alt of ors) {
    const items: Node[] = [];
    // keep "between X and Y" together
    const safe = alt.replace(/between (-?[\d.]+) and (-?[\d.]+)/g, 'between $1 AND_ $2');
    for (const piece of safe.split(/\s+(?:and|&&|&|but|while|with|plus)\s+|\s*,\s*/)) {
      const p = piece.replace('AND_', 'and').trim();
      if (!p) continue;
      const c = condition(p);
      if (c) items.push(c);
      else unknown.push(p);
    }
    if (items.length) alts.push(group('all', items));
  }
  if (!alts.length) return { node: null, unknown };
  if (alts.length === 1) return { node: alts[0], unknown };
  return { node: group('any', alts), unknown };
}

// ---------------------------------------------------------------------------------------------------------------
// Whole strategies

const SECTION_START: [RegExp, Section][] = [
  [/\b(?:only (?:trade|take trades|enter|buy|trade it)|trade only|filter)(?: when| if|:)\s*/g, 'filter'],
  [/\b(?:buy to cover|cover(?: the short)?|exit (?:the )?shorts?|close (?:the )?shorts?)(?: when| if| on|:)?\s+/g, 'shortExit'],
  [/\b(?:sell short|short sell|go short|enter (?:a )?short|open (?:a )?short|short)(?: when| if| on| as soon as|:)\s*/g, 'shortEntry'],
  [/\b(?:sell|exit(?: the)?(?: longs?| position| trade)?|close(?: the)?(?: longs?| position| trade)?|get out)(?: when| if| on| as soon as|:)\s*/g, 'longExit'],
  [/\b(?:buy|go long|enter (?:a )?long|open (?:a )?long|long|enter|get in)(?: when| if| on| as soon as| the| a|:)\s*/g, 'longEntry'],
];

function extractRisk(text: string, s: Strategy, notes: string[]): string {
  let t = text;
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    t = t.replace(re, (...args) => {
      fn(args as unknown as RegExpMatchArray);
      return ' , ';
    });
  };
  const unit = (u: string): 'pct' | 'atr' | 'r' => (/atr/.test(u) ? 'atr' : /^r\b|rr|risk/.test(u.trim()) ? 'r' : 'pct');
  const U = '(%|percent|x ?atrs?|atrs?|×\\s?atr|r\\b|rr\\b)';

  take(/\b(long only|longs only|only longs|short only|shorts only|only shorts|long and short|both (?:ways|directions|sides)|longs and shorts)\b/g, (m) => {
    s.side = /and|both/.test(m[1]) ? 'both' : /short/.test(m[1]) ? 'short' : 'long';
    notes.push(s.side === 'both' ? 'Trades long and short' : s.side === 'long' ? 'Long only' : 'Short only');
  });
  take(new RegExp(`\\btrail(?:ing)?(?:[- ]stop)?(?: loss)?\\s*(?:at|of|=|:)?\\s*${NUM}\\s*${U}(?: (?:once|after|when) (?:up |in profit )?${NUM}\\s*%)?`, 'g'), (m) => {
    s.exits.trail = { on: true, unit: unit(m[2]) === 'atr' ? 'atr' : 'pct', value: +m[1], activate: m[3] ? +m[3] : 0 };
    notes.push(`Trailing stop ${m[1]}${unit(m[2]) === 'atr' ? ' × ATR' : '%'}${m[3] ? ` after +${m[3]}%` : ''}`);
  });
  take(new RegExp(`\\b(?:move (?:the )?stop to )?break[- ]?even(?: stop)? (?:after|at|once|when (?:up|in profit))\\s*\\+?${NUM}\\s*(%|r\\b|percent)`, 'g'), (m) => {
    s.exits.breakeven = { on: true, unit: /r/.test(m[2]) ? 'r' : 'pct', value: +m[1] };
    notes.push(`Stop to breakeven after ${m[1]}${/r/.test(m[2]) ? 'R' : '%'}`);
  });
  take(new RegExp(`\\b(?:stop(?:[- ]?loss)?|sl|stop out)\\s*(?:at|of|=|:)?\\s*${NUM}\\s*${U}`, 'g'), (m) => {
    const u = unit(m[2]);
    s.exits.stop = { on: true, unit: u === 'atr' ? 'atr' : 'pct', value: +m[1] };
    notes.push(`Stop loss ${m[1]}${u === 'atr' ? ' × ATR' : '%'}`);
  });
  // Ladders: "take half at 2% and the rest at 5%", "take 30% off at 1R, 30% at 2R, rest at 4R"
  const ladder: { size: number | null; value: number; unit: 'pct' | 'atr' | 'r' }[] = [];
  take(new RegExp(`\\b(?:take(?: profit)?|sell|scale out(?: of)?|close)?\\s*(half|a third|one third|a quarter|${NUM}\\s*%|the rest|rest|remainder|everything else)(?: of (?:the )?position)?(?: off)? at\\s*\\+?${NUM}\\s*${U}`, 'g'), (m) => {
    const word = m[1];
    const size = /half/.test(word) ? 50 : /third/.test(word) ? 33.3 : /quarter/.test(word) ? 25 : /rest|remainder|else/.test(word) ? null : parseFloat(word);
    ladder.push({ size, value: +m[3], unit: unit(m[4]) });
  });
  take(new RegExp(`\\b(?:take[- ]?profits?|tp|profit target|targets?)\\s*(?:at|of|=|:)?\\s*\\+?${NUM}\\s*${U}`, 'g'), (m) => {
    ladder.push({ size: null, value: +m[1], unit: unit(m[2]) });
  });
  if (ladder.length) {
    ladder.sort((a, b) => a.value - b.value);
    const fixed = ladder.reduce((a, l) => a + (l.size ?? 0), 0);
    const open = ladder.filter((l) => l.size === null).length;
    const levels = ladder.map((l) => ({ unit: l.unit, value: l.value, size: Math.round((l.size ?? Math.max(0, 100 - fixed) / Math.max(1, open)) * 10) / 10 }));
    s.exits.targets = { on: true, levels };
    notes.push(`Take profit ${levels.map((l) => `${l.size}% at ${l.value}${l.unit === 'pct' ? '%' : l.unit === 'atr' ? ' × ATR' : 'R'}`).join(', ')}`);
  }
  take(/\b(?:exit|close|sell|get out)?\s*(?:after|within|in)\s+(\d+)\s*(bars?|candles?|days?|hours?|periods?|weeks?)\b(?: if (?:nothing|it doesn't|no exit)[^,.]*)?/g, (m) => {
    s.exits.time = { on: true, bars: +m[1] };
    notes.push(`Time exit after ${m[1]} bars`);
  });
  take(/\b(?:atr|atr length|atr period)\s*(?:of|=|:)?\s*(\d+)\b/g, (m) => {
    s.exits.atrLength = +m[1];
  });
  take(new RegExp(`\\brisk(?:ing)?\\s*${NUM}\\s*%(?: of (?:the )?(?:account|equity|capital))?(?: per trade| a trade| each trade)?`, 'g'), (m) => {
    s.sizing.mode = 'risk';
    s.sizing.value = +m[1];
    notes.push(`Risk ${m[1]}% of the account per trade`);
  });
  take(new RegExp(`\\b(?:use|with|size|position size|invest|allocate)\\s*(?:of )?${NUM}\\s*% (?:of )?(?:the )?(?:equity|account|capital|balance|portfolio)`, 'g'), (m) => {
    s.sizing.mode = 'equity';
    s.sizing.value = +m[1];
    notes.push(`Use ${m[1]}% of the account per trade`);
  });
  take(new RegExp(`\\b(?:${NUM}\\s*x\\s*leverage|leverage\\s*(?:of|=|:)?\\s*${NUM}\\s*x?)`, 'g'), (m) => {
    s.sizing.leverage = +(m[1] ?? m[2]);
    notes.push(`Leverage up to ${s.sizing.leverage}×`);
  });
  take(new RegExp(`\\b(?:fees?|commission)\\s*(?:of|=|:)?\\s*${NUM}\\s*%`, 'g'), (m) => {
    s.costs.feePct = +m[1];
    notes.push(`Fees ${m[1]}%`);
  });
  take(new RegExp(`\\bslippage\\s*(?:of|=|:)?\\s*${NUM}\\s*%`, 'g'), (m) => {
    s.costs.slippagePct = +m[1];
  });
  take(/\b(?:scale|pyramid|add)(?: in| to (?:the )?(?:position|winners))?\s*(?:up to\s*)?(\d+)\s*(?:more )?times?/g, (m) => {
    s.sizing.scaleIn = { on: true, max: +m[1], size: 50, onlyInProfit: true };
    notes.push(`Scale in up to ${m[1]} times`);
  });
  return t;
}

export function parseEnglish(input: string, base?: Strategy): ParseResult {
  const s = base ? structuredClone(base) : blankStrategy('From English');
  s.longEntry = group();
  s.longExit = group();
  s.shortEntry = group();
  s.shortExit = group();
  s.filter = group();
  s.exits = { ...s.exits, stop: { ...s.exits.stop, on: false }, trail: { ...s.exits.trail, on: false }, targets: { ...s.exits.targets, on: false }, time: { ...s.exits.time, on: false }, breakeven: { ...s.exits.breakeven, on: false } };
  s.sizing.scaleIn.on = false;
  const understood: string[] = [];
  const unknown: string[] = [];

  let text = ` ${input.toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'")} `
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/(\d)\.(?!\d)/g, '$1 ')
    .replace(/[;\n!]+|\.(?=\s|$)/g, ' , ')
    .replace(/\s+/g, ' ');
  text = extractRisk(text, s, understood);

  // Find section starts, then give each section the text up to the next one.
  const marks: { at: number; end: number; section: Section }[] = [];
  const taken: [number, number][] = [];
  for (const [re, section] of SECTION_START) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const at = m.index!;
      const end = at + m[0].length;
      if (taken.some(([a, b]) => at < b && end > a)) continue;
      taken.push([at, end]);
      marks.push({ at, end, section });
    }
  }
  marks.sort((a, b) => a.at - b.at);
  if (!marks.length && text.trim().replace(/[ ,]/g, '')) marks.push({ at: 0, end: 0, section: 'longEntry' });
  const before = text.slice(0, marks[0]?.at ?? text.length).replace(/[ ,]/g, '');
  if (before) unknown.push(text.slice(0, marks[0]?.at ?? text.length).replace(/^[ ,]+|[ ,]+$/g, ''));

  marks.forEach((m, k) => {
    const body = text
      .slice(m.end, marks[k + 1]?.at ?? text.length)
      .replace(/^[\s,]+|[\s,]+$/g, '')
      .replace(/\s*,\s*(and|or)\s+/g, ' $1 ');
    if (!body) return;
    const { node, unknown: u } = conditions(body);
    unknown.push(...u);
    if (!node) return;
    const target = s[m.section];
    target.items.push(...(node.mode === 'all' ? node.items : [node]));
    if (node.mode === 'any' && target.items.length === 1) {
      s[m.section] = node;
    }
  });

  const hasLong = s.longEntry.items.length > 0;
  const hasShort = s.shortEntry.items.length > 0;
  if (!understood.some((n) => /only|both|long and short/i.test(n))) s.side = hasLong && hasShort ? 'both' : hasShort ? 'short' : 'long';
  const heads = (['longEntry', 'longExit', 'shortEntry', 'shortExit', 'filter'] as const).filter((sec) => s[sec].items.length).map((sec) => `${SECTION_LABEL[sec]}: ${describeGroup(s[sec])}`);
  understood.unshift(...heads);
  return { strategy: s, understood, unknown: unknown.filter((u) => u && !/^(?:and|or|then|also)$/.test(u)) };
}

const SECTION_LABEL: Record<Section, string> = {
  longEntry: 'Buy when',
  longExit: 'Sell when',
  shortEntry: 'Short when',
  shortExit: 'Cover when',
  filter: 'Only trade when',
};

// ---------------------------------------------------------------------------------------------------------------
// Rules back into words

export function describeRule(r: Rule): string {
  const cmp = CMPS.find((c) => c.id === r.cmp)!;
  const a = operandLabel(r.a);
  if (cmp.unary) return `${a} ${cmp.word}${r.bars && r.bars > 1 ? ` over ${r.bars} bars` : ''}`;
  const within = r.within && r.within > 1 ? ` within the last ${r.within} bars` : '';
  if (r.a.id === 'pattern' && r.b.kind === 'num' && (r.cmp === 'gte' || r.cmp === 'gt')) {
    if (r.a.out === 'upStreak' || r.a.out === 'downStreak') return `${formatNum(r.b.v)} ${r.a.out === 'upStreak' ? 'up' : 'down'} closes in a row`;
    return `a ${a.toLowerCase()}${within}`;
  }
  return `${a} ${cmp.word} ${operandLabel(r.b)}${within}`;
}

export function describeGroup(g: RuleGroup): string {
  const parts = g.items.map((it) => (it.type === 'rule' ? describeRule(it) : `(${describeGroup(it)})`));
  return parts.join(g.mode === 'all' ? ' and ' : ' or ');
}

export function describe(s: Strategy): string {
  const lines: string[] = [];
  const long = s.side !== 'short';
  const short = s.side !== 'long';
  if (long && s.longEntry.items.length) lines.push(`Buy when ${describeGroup(s.longEntry)}.`);
  if (long && s.longExit.items.length) lines.push(`Sell when ${describeGroup(s.longExit)}.`);
  if (short && s.shortEntry.items.length) lines.push(`Short when ${describeGroup(s.shortEntry)}.`);
  if (short && s.shortExit.items.length) lines.push(`Cover when ${describeGroup(s.shortExit)}.`);
  if (s.filter.items.length) lines.push(`Only trade when ${describeGroup(s.filter)}.`);
  const e = s.exits;
  const u = (unit: string, v: number) => (unit === 'atr' ? `${formatNum(v)} ATR` : unit === 'r' ? `${formatNum(v)}R` : `${formatNum(v)}%`);
  const risk: string[] = [];
  if (e.stop.on) risk.push(`stop loss ${u(e.stop.unit, e.stop.value)}`);
  if (e.trail.on) risk.push(`trailing stop ${u(e.trail.unit, e.trail.value)}${e.trail.activate > 0 ? ` once up ${formatNum(e.trail.activate)}%` : ''}`);
  if (e.targets.on) {
    if (e.targets.levels.length === 1) risk.push(`take profit ${u(e.targets.levels[0].unit, e.targets.levels[0].value)}`);
    else risk.push(e.targets.levels.map((l, i) => `${i === e.targets.levels.length - 1 ? 'the rest' : `${formatNum(l.size)}%`} at ${u(l.unit, l.value)}`).join(', '));
  }
  if (e.breakeven.on) risk.push(`breakeven after ${u(e.breakeven.unit, e.breakeven.value)}`);
  if (e.time.on) risk.push(`exit after ${e.time.bars} bars`);
  if (s.sizing.mode === 'risk') risk.push(`risk ${formatNum(s.sizing.value)}% per trade`);
  else if (s.sizing.mode === 'equity' && s.sizing.value !== 100) risk.push(`use ${formatNum(s.sizing.value)}% of the account`);
  if (s.sizing.leverage > 1) risk.push(`${formatNum(s.sizing.leverage)}x leverage`);
  if (s.sizing.scaleIn.on) risk.push(`scale in up to ${s.sizing.scaleIn.max} times`);
  if (risk.length) lines.push(`${risk.join(', ').replace(/^\w/, (c) => c.toUpperCase())}.`);
  if (s.side === 'both' && !(s.longEntry.items.length && s.shortEntry.items.length)) lines.push('Long and short.');
  return lines.join(' ');
}
