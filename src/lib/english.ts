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
import SOURCE from './english.ts?raw';
import { WORDS } from './words';

export interface ParseResult {
  strategy: Strategy;
  understood: string[]; // short notes on what was read
  unknown: string[]; // fragments that couldn't be read
  questions: Question[]; // things that could mean two different strategies: the box asks instead of guessing
}

/** Something the reader won't guess: the box asks the trader, with choices. */
export interface Question {
  id: 'sell';
  text: string;
  options: { label: string; value: string }[];
}

export interface ReadOptions {
  sell?: 'exit' | 'short'; // what "sell when" means once the trader has said
  learned?: [string, string][]; // the trader's own corrections: their words -> what they mean
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

  // "sma 25 - 1.5 atr", "25 ema plus 2 atr": a moving average shifted by ATR
  const band = s.match(new RegExp(`^(.+?)\\s*(\\+|-|plus|minus)\\s*${NUM}\\s*(?:x\\s*)?(?:atr|average true range)(?:\\s*(\\d+))?$`));
  if (band) {
    const base = parseOperand(band[1]);
    if (base?.kind === 'ind' && (base.id === 'sma' || base.id === 'ema'))
      return ind(`${base.id}atr`, [base.p[0], +band[3], band[4] ? +band[4] : 14], {
        out: band[2] === '+' || band[2] === 'plus' ? 'upper' : 'lower',
        ...(base.src && base.src !== 'close' ? { src: base.src } : {}),
      });
    return null;
  }

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
  const hl =
    s.match(new RegExp(`^${NUM}${UNIT} (high|low|highest high|lowest low)$`)) ??
    s.match(new RegExp(`^(high|low|highest high|lowest low) (?:of |over )?(?:the )?(?:last )?${NUM}${UNIT}$`));
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
    params = paren[2]
      .split(/[,\s]+/)
      .filter(Boolean)
      .map(Number);
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
  name = name
    .replace(/^(?:a|an) /, '')
    .replace(/ line$/, (m) => (/macd|signal|supertrend/.test(name) ? m : ''))
    .trim();

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

const OVERSOLD: Record<string, [number, number]> = {
  rsi: [30, 70],
  stoch: [20, 80],
  stochrsi: [20, 80],
  mfi: [20, 80],
  cci: [-100, 100],
  willr: [-80, -20],
  zscore: [-2, 2],
};

const PATTERNS: [RegExp, string][] = [
  [/bullish engulfing/, 'bullEngulf'],
  [/bearish engulfing/, 'bearEngulf'],
  [/hammer/, 'hammer'],
  [/shooting star/, 'shootingStar'],
  [/inside (?:bar|candle|day)/, 'inside'],
  [/doji/, 'doji'],
];

type Node = Rule | RuleGroup;

/** True when words name the market itself rather than an indicator: "asset", "the stock", "usd/jpy", "nvda", "it". */
function isSubject(words: string): boolean {
  const w = words.trim().replace(/^(?:the|this|that|my|our|your)\s+/, '');
  if (!w || w.split(/\s+/).length > 4 || (/\d/.test(w.replace(/[a-z]+\/?[a-z]*/g, '')) && /\d/.test(w))) return false;
  if (parseOperand(w)) return false;
  return !/\b(?:rsi|macd|ema|sma|wma|hma|vwap|atr|adx|cci|mfi|roc|stoch|stochastic|bollinger|band|bands|volume|supertrend|sar|average|line|signal|histogram|high|low|open)\b/.test(
    w,
  );
}

/** Rewrites everyday trader phrasing into the forms below: "bitcoin hits the lower band" → "price crosses below lower band". */
function everyday(input: string): string {
  let s = input
    .replace(
      /^(?:the )?(?:price of )?(?:bitcoin|btc|ethereum|eth|the stock|the coin|the market|the asset|the pair|it'?s? price|the chart)(?: price)?\b/,
      'price',
    )
    .replace(/\b(?:normal|usual|avg|typical)\b(?: volume)?/g, 'average')
    .replace(/\baverage volume\b/g, 'average')
    .replace(/\s*>\s*/g, ' is above ')
    .replace(/\s*<\s*/g, ' is below ');
  // "touches / hits / tags / reaches" go toward whatever is named: down to a lower band or low, up to an upper band or high.
  s = s.replace(/\s(?:touches|touched|hits|tags|reaches|tests|wicks to|wicks into)\s(.+)$/, (_, target: string) =>
    /\b(?:lower|low|bottom|support|floor)\b/.test(target) ? ` crosses below ${target}` : ` crosses above ${target}`,
  );
  // More verbs for crossing.
  s = s
    .replace(
      /\s(?:rises|goes|gets|jumps|climbs|pops|moves back|gets back|goes back|crosses back|climbs back|rallies|breaks back)\s(?:back\s)?(above|over)\s/,
      ' crosses above ',
    )
    .replace(
      /\s(?:dips|goes|gets|slips|sinks|tanks|dumps|moves back|gets back|goes back|crosses back|drops back|falls back|breaks)\s(?:back\s)?(below|under)\s/,
      ' crosses below ',
    );
  return s.replace(/\s+/g, ' ').trim();
}

function condition(raw: string): Node | null {
  let s = raw
    .replace(/^(?:when|if|once|on|while|as soon as|and|then)\s+/, '')
    .replace(/^(?:a|an)\s+/, '')
    .replace(/\s+(?:happens|occurs|prints|forms|appears)$/, '')
    .trim();
  if (!s) return null;
  s = everyday(s);
  let m: RegExpMatchArray | null;

  if (/^golden cross$/.test(s)) return rule(ind('sma', [50]), 'xup', ind('sma', [200]));
  if (/^death cross$/.test(s)) return rule(ind('sma', [50]), 'xdn', ind('sma', [200]));

  for (const [re, out] of PATTERNS) if (re.test(s)) return rule(ind('pattern', [], { out }), 'gte', num(1));
  if ((m = s.match(/^(\d+) (?:green|up|higher|white|rising) (?:candles?|bars?|closes?|days?)(?: in a row)?$/)))
    return rule(ind('pattern', [], { out: 'upStreak' }), 'gte', num(+m[1]));
  if ((m = s.match(/^(\d+) (?:red|down|lower|black|falling) (?:candles?|bars?|closes?|days?)(?: in a row)?$/)))
    return rule(ind('pattern', [], { out: 'downStreak' }), 'gte', num(+m[1]));

  if ((m = s.match(/^(.+?) (?:is |gets |becomes |turns )?(oversold|overbought)$/))) {
    const a = parseOperand(m[1]);
    if (a?.kind === 'ind' && OVERSOLD[a.id])
      return rule(a, m[2] === 'oversold' ? 'lt' : 'gt', num(OVERSOLD[a.id][m[2] === 'oversold' ? 0 : 1]));
  }
  if ((m = s.match(/^(?:volume )?(?:is )?(?:a )?volume spike$|^volume spikes?$/))) return rule(ind('rvol'), 'gt', num(2));
  if ((m = s.match(/^volume (?:is )?(?:above|over|more than) (\d+(?:\.\d+)?) ?(?:x|times) (?:its |the )?(?:average|normal)/)))
    return rule(ind('rvol'), 'gt', num(+m[1]));
  if ((m = s.match(/^supertrend (?:is |turns |flips )?(up|bullish|green|down|bearish|red)$/))) {
    const up = /up|bullish|green/.test(m[1]);
    return rule(
      ind('supertrend', undefined, { out: 'dir' }),
      s.includes('turns') || s.includes('flips') ? (up ? 'xup' : 'xdn') : up ? 'gt' : 'lt',
      num(0),
    );
  }
  if ((m = s.match(/^(.+?) (?:is )?(above|below) (?:the )?(?:ichimoku )?cloud$/))) {
    const a = parseOperand(m[1]);
    if (a?.kind === 'ind') {
      const cmp: Cmp = m[2] === 'above' ? 'gt' : 'lt';
      return group('all', [
        rule(a, cmp, ind('ichimoku', undefined, { out: 'spanA' })),
        rule(a, cmp, ind('ichimoku', undefined, { out: 'spanB' })),
      ]);
    }
  }
  if ((m = s.match(/^(?:it'?s |on )?(?:a )?weekdays?$/)))
    return group('all', [rule(ind('weekday'), 'gte', num(1)), rule(ind('weekday'), 'lte', num(5))]);
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  if ((m = s.match(/^(?:it'?s |on )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?$/))) {
    const d = DAYS.indexOf(m[1]);
    return group('all', [rule(ind('weekday'), 'gte', num(d)), rule(ind('weekday'), 'lte', num(d))]);
  }
  if (
    (m = s.match(
      /^(?:the )?(.+?) (?:breaks|breaks out|closes|moves|pushes)( above| over| below| under)?(?: to)? (?:a )?new (\d+)[- ]?(?:day|bar|period|hour|week)? (high|low)$/,
    ))
  ) {
    const a = parseOperand(m[1]);
    if (a?.kind === 'ind')
      return rule(a, m[4] === 'high' ? 'xup' : 'xdn', ind('donchian', [+m[3]], { out: m[4] === 'high' ? 'upper' : 'lower' }));
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
  if (
    (m = s.match(
      /^(.+?) (?:is |has been |keeps )?(rising|falling|going up|going down|increasing|decreasing|turning up|turning down|sloping up|sloping down|up|down)(?: (?:for|over) (?:the )?(?:last )?(\d+) (?:bars?|days?|candles?|periods?))?$/,
    ))
  ) {
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
      const flipped: Record<Cmp, Cmp> = {
        gt: 'lt',
        lt: 'gt',
        gte: 'lte',
        lte: 'gte',
        xup: 'xdn',
        xdn: 'xup',
        rising: 'rising',
        falling: 'falling',
      };
      return rule(b, flipped[cmp], a, within ? { within } : {});
    }
    // "price crosses above ema" with no period on either side → the indicator's default
    if (a?.kind === 'ind' && b) return rule(a, cmp, b, within ? { within } : {});
    // "close is above 200 ema of high" etc. handled by parseOperand; left unknown → try implied price.
    // Anything else on the left that isn't an indicator is the thing being traded: "asset", "usd/jpy", "aapl", "my coin".
    if (!a && b && isSubject(left)) return rule(ind('price'), cmp, b, within ? { within } : {});
  }
  return null;
}

/** Drops brackets the read-back puts around groups, "(close crosses below sma 25)", but keeps "sma(25)". */
function unwrap(p: string): string {
  const count = (c: string) => p.split(c).length - 1;
  while (p.startsWith('(') && count('(') > count(')')) p = p.slice(1).trim();
  while (p.endsWith(')') && count(')') > count('(')) p = p.slice(0, -1).trim();
  if (p.startsWith('(') && p.endsWith(')') && count('(') === 1 && count(')') === 1) p = p.slice(1, -1).trim();
  return p;
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
      const p = unwrap(piece.replace('AND_', 'and').trim());
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
  [
    /\b(?:sell|exit(?: the)?(?: longs?| position| trade)?|close(?: the)?(?: longs?| position| trade)?|get out)(?: when| if| on| as soon as|:)\s*/g,
    'longExit',
  ],
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

  take(
    /\b(long only|longs only|only longs|short only|shorts only|only shorts|long and short|both (?:ways|directions|sides)|longs and shorts)\b/g,
    (m) => {
      s.side = /and|both/.test(m[1]) ? 'both' : /short/.test(m[1]) ? 'short' : 'long';
      notes.push(s.side === 'both' ? 'Trades long and short' : s.side === 'long' ? 'Long only' : 'Short only');
    },
  );
  take(
    new RegExp(
      `\\btrail(?:ing)?(?:[- ]stop)?(?: loss)?\\s*(?:at|of|=|:)?\\s*${NUM}\\s*${U}(?: (?:once|after|when) (?:up |in profit )?${NUM}\\s*%)?`,
      'g',
    ),
    (m) => {
      s.exits.trail = { on: true, unit: unit(m[2]) === 'atr' ? 'atr' : 'pct', value: +m[1], activate: m[3] ? +m[3] : 0 };
      notes.push(`Trailing stop ${m[1]}${unit(m[2]) === 'atr' ? ' × ATR' : '%'}${m[3] ? ` after +${m[3]}%` : ''}`);
    },
  );
  take(
    new RegExp(
      `\\b(?:move (?:the )?stop to )?break[- ]?even(?: stop)? (?:after|at|once|when (?:up|in profit))\\s*\\+?${NUM}\\s*(%|r\\b|percent)`,
      'g',
    ),
    (m) => {
      s.exits.breakeven = { on: true, unit: /r/.test(m[2]) ? 'r' : 'pct', value: +m[1] };
      notes.push(`Stop to breakeven after ${m[1]}${/r/.test(m[2]) ? 'R' : '%'}`);
    },
  );
  take(new RegExp(`\\b(?:stop(?:[- ]?loss)?|sl|stop out)\\s*(?:at|of|=|:)?\\s*${NUM}\\s*${U}`, 'g'), (m) => {
    const u = unit(m[2]);
    s.exits.stop = { on: true, unit: u === 'atr' ? 'atr' : 'pct', value: +m[1] };
    notes.push(`Stop loss ${m[1]}${u === 'atr' ? ' × ATR' : '%'}`);
  });
  // Ladders: "take half at 2% and the rest at 5%", "take 30% off at 1R, 30% at 2R, rest at 4R"
  const ladder: { size: number | null; value: number; unit: 'pct' | 'atr' | 'r' }[] = [];
  take(
    new RegExp(
      `\\b(?:take(?: profit)?|sell|scale out(?: of)?|close)?\\s*(half|a third|one third|a quarter|${NUM}\\s*%|the rest|rest|remainder|everything else)(?: of (?:the )?position)?(?: off)? at\\s*\\+?${NUM}\\s*${U}`,
      'g',
    ),
    (m) => {
      const word = m[1];
      const size = /half/.test(word)
        ? 50
        : /third/.test(word)
          ? 33.3
          : /quarter/.test(word)
            ? 25
            : /rest|remainder|else/.test(word)
              ? null
              : parseFloat(word);
      ladder.push({ size, value: +m[3], unit: unit(m[4]) });
    },
  );
  take(new RegExp(`\\b(?:take[- ]?profits?|tp|profit target|targets?)\\s*(?:at|of|=|:)?\\s*\\+?${NUM}\\s*${U}`, 'g'), (m) => {
    ladder.push({ size: null, value: +m[1], unit: unit(m[2]) });
  });
  if (ladder.length) {
    ladder.sort((a, b) => a.value - b.value);
    const fixed = ladder.reduce((a, l) => a + (l.size ?? 0), 0);
    const open = ladder.filter((l) => l.size === null).length;
    const levels = ladder.map((l) => ({
      unit: l.unit,
      value: l.value,
      size: Math.round((l.size ?? Math.max(0, 100 - fixed) / Math.max(1, open)) * 10) / 10,
    }));
    s.exits.targets = { on: true, levels };
    notes.push(
      `Take profit ${levels.map((l) => `${l.size}% at ${l.value}${l.unit === 'pct' ? '%' : l.unit === 'atr' ? ' × ATR' : 'R'}`).join(', ')}`,
    );
  }
  take(
    /\b(?:exit|close|sell|get out)?\s*(?:after|within|in)\s+(\d+)\s*(bars?|candles?|days?|hours?|periods?|weeks?)\b(?: if (?:nothing|it doesn't|no exit)[^,.]*)?/g,
    (m) => {
      s.exits.time = { on: true, bars: +m[1] };
      notes.push(`Time exit after ${m[1]} bars`);
    },
  );
  take(/\b(?:atr|atr length|atr period)\s*(?:of|=|:)?\s*(\d+)\b/g, (m) => {
    s.exits.atrLength = +m[1];
  });
  take(
    new RegExp(`\\brisk(?:ing)?\\s*${NUM}\\s*%(?: of (?:the )?(?:account|equity|capital))?(?: per trade| a trade| each trade)?`, 'g'),
    (m) => {
      s.sizing.mode = 'risk';
      s.sizing.value = +m[1];
      notes.push(`Risk ${m[1]}% of the account per trade`);
    },
  );
  take(
    new RegExp(
      `\\b(?:use|with|size|position size|invest|allocate)\\s*(?:of )?${NUM}\\s*% (?:of )?(?:the )?(?:equity|account|capital|balance|portfolio)`,
      'g',
    ),
    (m) => {
      s.sizing.mode = 'equity';
      s.sizing.value = +m[1];
      notes.push(`Use ${m[1]}% of the account per trade`);
    },
  );
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

/** Lower-cases and evens out punctuation. Parts the reader can't understand are reported in this form. */
export function normalizeEnglish(input: string): string {
  return ` ${input.toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'")} `
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/(\d)\.(?!\d)/g, '$1 ')
    .replace(/[;\n!]+|\.(?=\s|$)/g, ' , ')
    .replace(/\s+/g, ' ');
}

/**
 * Turns the many ways traders say things into the forms the reader knows, before anything is split up.
 * Each line is one family of phrasing; the tests in english-anything.test.ts hold real sentences for each.
 */
// Words the reader knows. A typed word that isn't one of these (or an everyday English word) is matched to the
// closest of these, so "bolinger", "stocastic", "abvoe", "crosess" and "avrage" still read.
const VOCAB = (
  'buy sell short long exit enter cover close closes closed open high low price volume when if and or above below over under ' +
  'crosses cross crossed rises falls drops dips touches hits breaks bounces rejects pulls back rising falling is are ' +
  'rsi macd ema sma wma hma vwap atr adx cci mfi roc stochastic stoch bollinger band bands upper lower middle supertrend parabolic sar ' +
  'ichimoku cloud keltner donchian channel williams momentum trend uptrend downtrend oversold overbought average moving simple exponential weighted ' +
  'histogram signal line stop loss take profit target trailing trail percent day days bar bars candle candles green red higher lower ' +
  'golden death breakout pullback bounce rejection gap gaps relative spike spikes strong weak positive negative bullish bearish then after ' +
  'stays trades period ema sma asset stock coin pair market bitcoin ethereum crypto risk position size half rest breakeven times row'
).split(' ');
const PLAIN = new Set(
  (
    "the a an of to in on at it its my is it's be by for with as from that this than then also both all any each every just only " +
    'i we you he she they me us hey hi hello yo okay thanks bitcoin btc eth stock stocks shares coin want would like should will can could please lets let get got goes go going went make makes made ' +
    'do does did not no yes more less most least much many few new old first last next same other some once whenever after before ' +
    'up down out into onto off again still while until till about around near far back time times row way'
  ).split(' '),
);
// Every word the reader itself uses (in its patterns and tables) counts as correct, so "fast", "slow", "dip",
// "flips" or "slopes" are never "corrected" into something else.
const KNOWN = new Set([
  ...VOCAB,
  ...PLAIN,
  ...WORDS.split(' '),
  ...(SOURCE.replace(/\/\/.*$/gm, '')
    .toLowerCase()
    .match(/[a-z]{3,}/g) ?? []),
]);
const VOCAB_SET = new Set(VOCAB);
const CANDIDATES = [...new Set([...VOCAB, ...PLAIN])].filter((w) => w.length >= 3);
function fixTypos(text: string): string {
  const dist = (a: string, b: string) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    return d[a.length][b.length];
  };
  return text.replace(/[a-z]{3,}/g, (w) => {
    if (KNOWN.has(w)) return w;
    const max = w.length <= 4 ? 1 : w.length <= 7 ? 2 : 3;
    // Closest word wins; on a tie, prefer one that starts with the same letter, then one the typed word is the start
    // of ("los" is "loss", not "low"), then the longer one.
    let best = '';
    let score = Infinity;
    for (const v of CANDIDATES) {
      if (Math.abs(v.length - w.length) > max) continue;
      const dd = dist(w, v);
      if (dd > max) continue;
      const sc = dd * 8 + (v[0] === w[0] ? 0 : 4) + (v.startsWith(w) ? 0 : 1) + (VOCAB_SET.has(v) ? 0 : 2) + (v.length >= w.length ? 0 : 1);
      if (sc < score) {
        score = sc;
        best = v;
      }
    }
    return best || w;
  });
}

function phrasebook(text: string): string {
  text = fixTypos(text);
  const R: [RegExp, string][] = [
    // greetings, requests and manners: "hey can you make me a strategy that buys when ..."
    [/^\s*(?:hey|hi|hello|yo|ok|okay|so|um|uh)\b[\s,!]*/g, ' '],
    [
      /^\s*(?:(?:can|could|would|will) you |please |pls |plz )*(?:make|build|create|write|give|set up|setup|code|design)(?: me| us)? (?:a |an |the )?(?:simple |basic |quick )?(?:strategy|strat|bot|system|algo|setup|rule|backtest)?\s*(?:that |which |to |where |so it |for )?/g,
      ' ',
    ],
    [/\s*\b(?:please|pls|plz|thanks|thank you|thx)\b[.!]?/g, ''],
    [/\b(buy|sell|short)s\b/g, '$1'],
    [/\bbuy low,? (?:and )?sell high\b/g, 'buy when rsi is below 30, sell when rsi is above 70'],
    // exits said as a move against or for the trade: "close trade if candle flips to 1.5 times the atr"
    [/\b(\d+(?:\.\d+)?) ?(?:times|x) (?:the )?(?:atrs?|average true range)\b/g, '$1 atr'],
    [
      /\b(?:close|exit|sell|get out|stop out|close out|cut|bail)(?: of)?(?: the| my| this)?(?: trade| position| it)? (?:if|when|once|as soon as) (?:the )?(?:candle|price|it|trade|position|market) (?:flips|moves|goes|drops|falls|turns|runs|swings|loses|is down|goes down|moves down)(?: back)?(?: against (?:me|you|it|us|the trade))?(?: (?:to|by))? (\d+(?:\.\d+)?) ?(atr|%)(?: against (?:me|you|it|us|the trade))?/g,
      'stop loss $1 $2',
    ],
    [
      /\b(?:close|exit|sell|get out|close out|cash out|take profit)(?: of)?(?: the| my| this)?(?: trade| position| it)? (?:if|when|once|as soon as) (?:the )?(?:candle|price|it|trade|position|market) (?:gains|rises|goes up|is up|climbs|moves up|runs|moves|goes|makes)(?: in my favou?r)?(?: (?:to|by))? (\d+(?:\.\d+)?) ?(atr|%)(?: in my favou?r)?/g,
      'take profit $1 $2',
    ],
    [/\bstop(?: loss)? (?:at|of|is|=) (?=\d)/g, 'stop loss '],
    [/\b(?:take profit|target|tp) (?:at|of|is|=) (?=\d)/g, 'take profit '],
    // filler and word numbers
    [/^\s*(?:i want to|i'd like to|i would like to|i wanna|i'll|i will|please|let's|lets|we|you should|should)\s+/g, ' '],
    [/\bzero\b/g, '0'],
    [/\bten\b/g, '10'],
    [/\btwenty\b/g, '20'],
    [/\bthirty\b/g, '30'],
    [/\bfifty\b/g, '50'],
    [/\bseventy\b/g, '70'],
    [/\beighty\b/g, '80'],
    [/\b(\d+) ?(sma|ema|wma|hma|ma)\b/g, '$1 $2'],
    [/\b(\d+) (?:ma|moving average)\b/g, '$1 sma'],
    // the order a trader says it in
    [/(^|, )\s*when (.+?),? (buy|sell|short|go long|go short)\s*(?=,|$)/g, '$1$3 when $2'],
    [/\b(?:enter|open|take|start|go)(?: into)? (?:a |an )?(long|short)(?: position| trade)?(?= when| if)/g, '$1'],
    [/\b(?:sell|close|exit|get out of|dump)(?: of)? (?:my|the|our|this) (?:position|trade|long|bag|shares?|coins?)(?= when| if)/g, 'sell'],
    [
      /\b(long|buy) above (the [^,]+?|[a-z]+ \d+), (short|sell) below (?:it|that)\b/g,
      'buy when price is above $2, short when price is below $2',
    ],
    [/(^|, )\s*(long|buy|short|sell) (above|below|over|under) /g, '$1$2 when price is $3 '],
    // "above it" means the average named earlier in the same sentence
    [
      /\b((?:sma|ema|wma|hma|ma) \d+|\d+ (?:sma|ema|wma|hma|ma|day sma|day ema)|vwap)\b([^,]*?) (above|below|over|under) (?:it|that)\b/g,
      '$1$2 $3 $1',
    ],
    // "rsi is over 50 and rising"
    [/\b((?:the )?[a-z%]+(?: \d+)?) is (above|below|over|under) (\d+(?:\.\d+)?) and (rising|falling)\b/g, '$1 is $2 $3 and $1 is $4'],
    // volume multiples
    [/\bvolume is (?:twice|double) (?:the )?(?:average|avg|normal)(?: volume)?\b/g, 'relative volume is above 2'],
    [/\bvolume is (\d+(?:\.\d+)?)x? (?:times )?(?:the )?(?:average|avg|normal)(?: volume)?\b/g, 'relative volume is above $1'],
    [/\bbreaks? (?:out )?(?:above |over )?(?=the |\d)/g, 'crosses above '],
    // sentence starts
    [
      /\b(buy|go long|long|enter long|sell|short|go short|exit|cover)( the dip)? (?:after(?! \d)|as soon as|once|whenever|every time)\b/g,
      '$1 when',
    ],
    [/\bbuy the dip\b/g, 'buy'],
    // what is being bought doesn't change the rule: "buy bitcoin when", "sell my shares if"
    [
      /\b(buy|sell|short)\s+(?!when\b|if\b|on\b|at\b|after\b|once\b|as\b|whenever\b|low\b|high\b|and\b|above\b|below\b|over\b|under\b)(?:the |some |my |more |all )?[a-z0-9]+\s+(?=when |if |once |whenever )/g,
      '$1 ',
    ],
    // "rsi ... sell when it goes over 70": "it" is the oscillator named earlier
    [
      /\b(rsi|stoch|stochastic|cci|mfi|williams %r|adx)\b(.*?\bwhen )(?:it|its|it's|it is)\b(?=\s+(?:is |goes |gets |crosses |moves |rises |drops |falls |climbs )?(?:back )?(?:above|over|under|below) \d)/g,
      '$1$2$1',
    ],
    // "above the 20 sma, sell when its below": below the same average
    [
      /\b((?:sma|ema|wma|hma|ma) \d+|\d+ (?:sma|ema|wma|hma|ma|day sma|day ema)|vwap)\b(.*?\bwhen )(?:it'?s|it is|price is|price's) (above|below|over|under)(?=\s*(?:,|$))/g,
      '$1$2price is $3 $1',
    ],
    [/\brsi (?:is |gets |goes )?(?:low|really low|very low)\b/g, 'rsi is below 30'],
    [/\brsi (?:is |gets |goes )?(?:high|really high|very high)\b/g, 'rsi is above 70'],
    [/\bbreaks? out (?:of|from|past|through) /g, 'crosses above '],
    [
      /\b(buy|go long|long|enter long|short|go short) after (?=\d+ (?:red|green|up|down|white|black|rising|falling|higher|lower) )/g,
      '$1 when ',
    ],
    [/\b(?:price |it |the price )?gaps? up\b/g, 'open is above the 1 bar high'],
    [/\b(?:price |it |the price )?gaps? down\b/g, 'open is below the 1 bar low'],
    [/\band (?=(?:sell|short|go short|exit|close|cover|take profit)\b)/g, ', '],
    // states
    [/\b(?:it'?s|it is|its) overbought\b/g, 'rsi is above 70'],
    [/\b(?:it'?s|it is|its) oversold\b/g, 'rsi is below 30'],
    [/\brsi (?:is |gets |goes |becomes )?oversold\b/g, 'rsi is below 30'],
    [/\brsi (?:is |gets |goes |becomes )?overbought\b/g, 'rsi is above 70'],
    [/ (?:in|during) an? (?:up ?trend|bull(?:ish)? (?:trend|market))\b/g, ' and close is above sma 200'],
    [/\b(?:the )?trend is (?:up|bullish)\b|\buptrend\b/g, 'close is above sma 200'],
    [/ (?:in|during) an? (?:down ?trend|bear(?:ish)? (?:trend|market))\b/g, ' and close is below sma 200'],
    [/\b(?:the )?trend is (?:down|bearish)\b|\bdowntrend\b/g, 'close is below sma 200'],
    [/\bmomentum is (?:strong|high)\b|\bstrong trend\b/g, 'adx 14 is above 25'],
    [/\bmomentum is (?:weak|low)\b/g, 'adx 14 is below 20'],
    [/\bmomentum (?:is|turns|goes) (?:positive|up|bullish)\b/g, 'roc 10 crosses above 0'],
    [/\bmomentum (?:is|turns|goes) (?:negative|down|bearish)\b/g, 'roc 10 crosses below 0'],
    [
      /\bmacd (?:turns|goes|flips|is|becomes) (?:positive|bullish|green)\b|\bmacd histogram (?:turns|flips|goes) (?:positive|green)\b/g,
      'macd histogram crosses above 0',
    ],
    [
      /\bmacd (?:turns|goes|flips|is|becomes) (?:negative|bearish|red)\b|\bmacd histogram (?:turns|flips|goes) (?:negative|red)\b/g,
      'macd histogram crosses below 0',
    ],
    // moves
    [/\b(?:slopes|is sloping|points|is pointing|angles|turns|curls) (?:up|upward|higher)\b/g, 'is rising'],
    [/\b(?:slopes|is sloping|points|is pointing|angles|turns|curls) (?:down|downward|lower)\b/g, 'is falling'],
    [/\b(price|close|it) (?:goes|moves|ticks|heads|is going|is moving) (?:up|higher)\b/g, 'close is rising'],
    [/\b(price|close|it) (?:goes|moves|ticks|heads|is going|is moving) (?:down|lower)\b/g, 'close is falling'],
    [/\b(?:the price |price |it )?makes? an? (?:higher|new) high\b/g, 'high is rising'],
    [/\b(?:the price |price |it )?makes? an? (?:lower|new) low\b/g, 'low is falling'],
    [/\b(?:pulls? back|retraces?|dips?) (?:to|into|toward|towards) /g, 'crosses below '],
    [/\b(?:bounces?|rebounds?) (?:off|from|of) /g, 'crosses above '],
    [/\b(?:rejects?|gets rejected (?:at|by|from)|fails at) /g, 'crosses below '],
    [/\bcross(?:es|ed)? (?:up)(?: (?:from )?(?:below|under))? (\d)/g, 'crosses above $1'],
    [/\bcross(?:es|ed)? (?:down)(?: (?:from )?(?:above|over))? (\d)/g, 'crosses below $1'],
    [/\bcross(?:es|ed)? up\b/g, 'crosses above'],
    [/\bcross(?:es|ed)? down\b/g, 'crosses below'],
    // "x crosses y" with no direction means crossing above
    [/\bcross(?:es|ed) (?!above|below|over|under|up|down|back)/g, 'crosses above '],
    // "A crosses B ... when it crosses back": the same two lines the other way
    [
      /\b((?:the )?(?:\d+ [a-z]+|[a-z]+ \d+)) crosses (above|below) ((?:the )?(?:\d+ [a-z]+|[a-z]+ \d+))(.*?\bwhen )(?:it|they) cross(?:es)? back(?: (?:above|below|over|under|up|down))?\b/g,
      (_m: string, a: string, d: string, b: string, mid: string) =>
        `${a} crosses ${d} ${b}${mid}${a} crosses ${d === 'above' ? 'below' : 'above'} ${b}`,
    ] as unknown as [RegExp, string],
    // fast and slow averages, bare "the 50" next to "the 200"
    [/\bfast (ema|sma|ma|moving average)\b/g, '$1 9'],
    [/\bslow (ema|sma|ma|moving average)\b/g, '$1 21'],
    [/\bthe (\d{1,3})(?: day| period| bar)?(?= crosses| is above| is below| and| ,|$| crosses)/g, 'sma $1'],
    [
      /(crosses (?:above|below)|is (?:above|below)) the (\d{1,3})(?: day| period| bar)?(?=\s*(?:,|$|\s(?:and|or|then|sell|buy)))/g,
      '$1 sma $2',
    ],
    // earlier bars
    [/\b(?:yesterday'?s|the previous|the prior|the last|previous|prior|last) (?:day'?s |candle'?s |bar'?s )?(high|low)\b/g, 'the 1 bar $1'],
    // risk
    [/\btrail(?:ing)? (?:the |my )?stop(?: loss)? (?:at|by|of)? ?/g, 'trailing stop '],
  ];
  for (const [re, to] of R) text = text.replace(re, to as string);
  return text.replace(/\s+/g, ' ');
}

/** Reads one condition on its own: the rules it makes, or null when it can't be read. */
/** Reads a short phrase from the AI: a condition, or an exit such as "stop loss 1.5 atr". */
export function readPhrase(text: string): string | null {
  const c = readCondition(text);
  if (c) return c;
  const r = parseEnglish(text);
  return r.unknown.length || !r.understood.length ? null : r.understood.join(', ');
}

/** The text the reader works on, after typos and everyday wording are fixed. */
export const prepareEnglish = (input: string, opts: ReadOptions = {}) =>
  phrasebook(normalizeEnglish(byTrade(plainSides(applyLearned(input.toLowerCase(), opts.learned)), opts).text));

export function readCondition(text: string): string | null {
  const r = parseEnglish(`Buy when ${text}.`);
  return r.unknown.length || !r.strategy.longEntry.items.length ? null : describeGroup(r.strategy.longEntry);
}

// How people describe a strategy in their own words, turned into the reader's forms before anything else:
//   "Buy side: when a candle closes above the 25-period moving average, it buys. It sells to close when a candle
//    closes back below the average, or when price drops 1.5 ATR below the average. Sell side: …"
// - "the 25-period moving average" is the 25 SMA, and "the average" later on means that same one
// - "Buy side:" / "Long side:" / "For shorts:" say which trade the next sentences are about
// - "when X, it buys" and "it buys when X" are entries; "it sells to close when X", "it closes the trade when X" exits
// - "price drops 1.5 ATR below the average" is a level: the average minus 1.5 ATR
const SUBJ = '(?:(?:it|we|i|you|the (?:bot|ea|algo|algorithm|strategy|system|robot|trader))\\s+)?(?:(?:will|should|would|then)\\s+)?';
const LONG_IN = '(?:buys?|buying|goes long|go long|enters? (?:a )?long(?: trade| position)?|opens? (?:a )?long(?: trade| position)?)';
const SHORT_IN = '(?:sells?(?! to close)|selling|shorts?|goes short|go short|sells? short|enters? (?:a )?short(?: trade| position)?|opens? (?:a )?short(?: trade| position)?)';
const LONG_OUT = '(?:sells? to close|sells? (?:it|the position|the trade|the buy|out)|closes? (?:the |its |my )?(?:buy|long))';
const SHORT_OUT = '(?:buys? to close|buys? (?:it )?back|covers?(?: the short)?|closes? (?:the |its |my )?(?:sell|short))';
const ANY_OUT = '(?:closes? (?:out )?(?:the |this |its |my )?(?:trade|position)|closes? (?:it|out)|exits?(?: (?:the |this |its |my )?(?:trade|position))?|gets? out|stops? out)';
const WHEN = '(?:when|if|once|as soon as|whenever)';

function plainSides(input: string): string {
  // Averages named with a period, then "the average" = the last one named.
  const MA: Record<string, string> = { simple: 'sma', exponential: 'ema', weighted: 'wma', '': 'sma' };
  let t = input
    .replace(
      /\b(\d+)(?:[- ](?:period|day|bar|candle|hour|minute|week)s?)?[- ](?:(simple|exponential|weighted) )?(?:moving average|ma)\b/g,
      (_m, n: string, kind = '') => `${MA[kind]} ${n}`,
    )
    .replace(/\b(?:(simple|exponential|weighted) )?moving average (?:of |over )?(?:the )?(?:last )?(\d+)(?: (?:periods?|days?|bars?|candles?))?\b/g, (_m, kind = '', n: string) => `${MA[kind]} ${n}`)
    .replace(/\b(?:closes|closed|closing|moves|goes|gets|crosses) back (above|below|over|under)\b/g, 'closes $1')
    .replace(/\b(\d+)[- ]?(?:(?:period|day|bar|candle|hour)s?[- ])?(sma|ema|wma|hma)\b/g, '$2 $1');
  let last = '';
  t = t.replace(
    /\b(?:sma|ema|wma|hma) \d+\b|\bthe (?:moving )?average(?! true)\b|\bthe (?:ma|mean|average line|moving average line)\b|\bthe (?:sma|ema|wma|hma)\b(?! ?\d)/g,
    (m) => {
      if (/^(?:sma|ema|wma|hma) /.test(m)) {
        last = m;
        return m;
      }
      // "the ema" after "the 20 ema": that one; "the average": the last average named
      const kind = m.match(/\b(sma|ema|wma|hma)$/)?.[1];
      if (kind && !last.startsWith(kind)) return m;
      return last || m;
    },
  );
  // "price drops 1.5 atr below the sma 25" -> a level the price is below
  t = t.replace(
    /\b(?:the )?(?:price|close|it|candle|a candle|the candle|market)\s+(?:drops|falls|moves|goes|gets|trades|closes|is|dips|sinks|slips|rises|climbs|pushes|runs|jumps|pops|extends)\s+(?:to |by |more than |over )?(\d+(?:\.\d+)?)\s*(?:x|times)?\s*(?:the )?(?:atrs?|average true ranges?)\s+(below|under|above|over|past|beyond)\s+((?:sma|ema) \d+)/g,
    (_m, k: string, dir: string, ma: string) => {
      const down = /below|under/.test(dir) || (/past|beyond/.test(dir) && /drops|falls|dips|sinks|slips/.test(_m));
      return `close is ${down ? 'below' : 'above'} ${ma} ${down ? '-' : '+'} ${k} atr`;
    },
  );

  // Sentences, with the side each one is about.
  const sentences = t.split(/(?<=[.!?;])\s+|\n+/).map((x) => x.trim());
  let side: 'long' | 'short' | null = null;
  const HEAD =
    /^(?:(?:on |for )?(?:the )?(buy|long|sell|short)(?:ing)?[- ]side|(?:for |on )?(longs|shorts|long trades|short trades|buys|sells|buying|selling|shorting|going long|going short))\s*[:,-]?\s*/;
  return sentences
    .map((raw) => {
      let x = raw;
      const h = x.match(HEAD);
      if (h && (h[1] || /[:,-]\s*$/.test(h[0]) || h[0].trim() !== x.trim())) {
        const w = h[1] ?? h[2];
        side = /^(?:buy|long|going long)/.test(w) ? 'long' : 'short';
        x = x.slice(h[0].length);
      }
      const end = x.match(/[.!?;]+$/)?.[0] ?? '';
      x = x.slice(0, x.length - end.length);
      const longIn = side === 'short' ? 'cover' : 'buy';
      const shortIn = side === 'long' ? 'exit long' : side === 'short' ? 'short' : 'sell';
      const anyOut = side === 'short' ? 'cover' : side === 'long' ? 'exit long' : null;
      const verb = (v: string) =>
        new RegExp(`^${LONG_OUT}$`).test(v)
          ? 'exit long'
          : new RegExp(`^${SHORT_OUT}$`).test(v)
            ? 'cover'
            : new RegExp(`^${ANY_OUT}$`).test(v)
              ? anyOut
              : new RegExp(`^${LONG_IN}$`).test(v)
                ? longIn
                : /short/.test(v)
                  ? 'short' // "short" always opens a short; only a plain "sell" depends on the side being described
                  : shortIn;
      const ACT = `(${LONG_OUT}|${SHORT_OUT}|${ANY_OUT}|${LONG_IN}|${SHORT_IN})`;
      // "when X, it buys" / "if X then we go short"
      x = x.replace(new RegExp(`(^|,\\s*)${WHEN}\\s+(.+?),?\\s+${SUBJ}${ACT}$`), (m, pre: string, cond: string, v: string) => {
        const to = verb(v);
        return to ? `${pre}${to} when ${cond}` : m;
      });
      // "it buys when X" / "it sells to close when X" / "the bot closes the trade if X"
      x = x.replace(new RegExp(`(^|,\\s*|\\band\\s+)${SUBJ}${ACT}\\s+${WHEN}\\b`, 'g'), (m, pre: string, v: string) => {
        const to = verb(v);
        return to ? `${pre}${to} when` : m;
      });
      return x + end;
    })
    .filter((x) => /[a-z]/.test(x))
    .join(' ');
}

// Reads a strategy one sentence at a time, keeping track of which trade each sentence is about, so an exit said after
// "buy when …" closes the buy and one said after "sell when …" closes that trade, never becoming another way in.
function byTrade(text: string, opts: ReadOptions): { text: string; questions: Question[] } {
  const questions: Question[] = [];
  const sentences = text
    .replace(/,?\s*(?:\band\s+)?(?<!\b(?:go|sell)\s)(?=\b(?:sell|buy|short|cover|go long|go short)\s+(?:when|if|once|as soon as)\b)/g, '. ')
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((x) => x.trim())
    .filter((x) => /[a-z]/.test(x));
  const ENTRY_LONG = /^(?:buy|go long|long|enter (?:a )?long|get in|enter)\b/;
  const ENTRY_SELL = /^(?:sell)\s+(?:when|if|on|once|as soon as)\b/;
  const ENTRY_SHORT = /^(?:short|go short|sell short|short sell|enter (?:a )?short|open (?:a )?short)\b/;
  // An exit said about THIS trade ("in the other direction", "the trade closes", "or when it closes below …"), not a general stop for every trade.
  const CLOSES_TRADE =
    /\b(?:the trade closes|close (?:the |this )?trade|the trade is closed|exits? the trade)\b|\bin the other direction\b|\bagainst (?:me|it|the trade)\b|\bthe other way\b|\bor (?:when|if|once) it closes\b/;
  const hasBuy = sentences.some((x) => ENTRY_LONG.test(x));
  // "sell when …" followed by its own exit is a second trade (a short), not the way out of the buy.
  const sellOwnsExit = sentences.some(
    (x, i) =>
      ENTRY_SELL.test(x) &&
      (CLOSES_TRADE.test(x.replace(ENTRY_SELL, '')) ||
        (sentences[i + 1] &&
          !ENTRY_LONG.test(sentences[i + 1]) &&
          !ENTRY_SELL.test(sentences[i + 1]) &&
          CLOSES_TRADE.test(sentences[i + 1]))),
  );
  const buyHasExit = sentences.some(
    (x, i) => ENTRY_LONG.test(x) && sentences[i + 1] && CLOSES_TRADE.test(sentences[i + 1]) && !ENTRY_SELL.test(sentences[i + 1]),
  );
  let sell = opts.sell;
  if (!sell && hasBuy && sentences.some((x) => ENTRY_SELL.test(x))) {
    if (sellOwnsExit || buyHasExit) sell = 'short';
    else
      questions.push({
        id: 'sell',
        text: 'When you say “sell”, do you mean close the buy, or open a short trade?',
        options: [
          { label: 'Close the buy', value: 'exit' },
          { label: 'Open a short', value: 'short' },
        ],
      });
  }
  let trade: 'long' | 'short' | null = null;
  const out = sentences.map((raw) => {
    let x = raw.replace(/[.!?;]+$/, '');
    // "sma closes above the 25 sma", "candle closes", "it closes": the price closing, not an average nobody named
    x = x.replace(
      /\b(?:the )?(?:sma|ema|ma|candle|bar|price|it|asset|stock|chart)\s+(?:closes|closed|close)\s+(above|below|over|under)\b/g,
      'close crosses $1',
    );
    if (ENTRY_LONG.test(x)) trade = 'long';
    else if (ENTRY_SHORT.test(x)) trade = 'short';
    else if (ENTRY_SELL.test(x)) {
      if (sell === 'short') {
        x = x.replace(/^sell\b/, 'short');
        trade = 'short';
      }
    }
    if (!trade) return x;
    const out = trade === 'long' ? 'sell' : 'cover';
    // the stop: "if it crosses 1.5 times the atr in the other direction (the trade closes)"
    x = x.replace(
      /\b(?:(?:exit|close(?: the trade)?|stop out|get out|sell|cover)\s+)?(?:if|when|once)\s+(?:it|price|the price|the candle|candle)\s+(?:crosses|moves|goes|runs|swings|flips|drops|falls|rises)\s+(\d+(?:\.\d+)?)\s*(?:times|x)?\s*(?:the\s+)?(atr|%|percent)\s+(?:in the other direction|the other way|against (?:me|it|the trade)|the wrong way)(?:,?\s*(?:then\s+)?the trade (?:closes|is closed|exits))?/g,
      (_m, n: string, u: string) => `, stop loss ${n} ${u === 'atr' ? 'atr' : '%'}, `,
    );
    // "… or when it closes below the 25 sma": a second way out of this trade
    x = x.replace(
      /\b(?:the trade closes\s+)?(?:,\s*)?or\s+(?:when|if|once)\s+(?:it\s+|price\s+|the price\s+)?close crosses\s+/g,
      `, ${out} when close crosses `,
    );
    x = x.replace(/\b(?:or\s+)?(?:when|if|once)\s+it\s+closes\s+(above|below|over|under)\s+/g, `${out} when close crosses $1 `);
    x = x.replace(/\bthe trade closes\b/g, '');
    return x;
  });
  return { text: out.join('. '), questions };
}

/** Puts the trader's own corrections in before reading: their words, swapped for what they told the box they mean. */
function applyLearned(text: string, learned: [string, string][] = []) {
  let t = text;
  for (const [from, to] of learned) if (from.trim()) t = t.split(from.toLowerCase()).join(to.toLowerCase());
  return t;
}

export function parseEnglish(input: string, base?: Strategy, opts: ReadOptions = {}): ParseResult {
  const s = base ? structuredClone(base) : blankStrategy('From English');
  s.longEntry = group();
  s.longExit = group();
  s.shortEntry = group();
  s.shortExit = group();
  s.filter = group();
  s.exits = {
    ...s.exits,
    stop: { ...s.exits.stop, on: false },
    trail: { ...s.exits.trail, on: false },
    targets: { ...s.exits.targets, on: false },
    time: { ...s.exits.time, on: false },
    breakeven: { ...s.exits.breakeven, on: false },
  };
  s.sizing.scaleIn.on = false;
  const understood: string[] = [];
  const unknown: string[] = [];

  const shaped = byTrade(plainSides(applyLearned(input.toLowerCase(), opts.learned)), opts);
  let text = phrasebook(normalizeEnglish(shaped.text));
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
  const heads = (['longEntry', 'longExit', 'shortEntry', 'shortExit', 'filter'] as const)
    .filter((sec) => s[sec].items.length)
    .map((sec) => `${SECTION_LABEL[sec]}: ${describeGroup(s[sec])}`);
  understood.unshift(...heads);
  return {
    strategy: s,
    understood: [...new Set(understood)],
    unknown: unknown.filter((u) => u && !/^(?:and|or|then|also)$/.test(u)),
    questions: shaped.questions,
  };
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
    if (r.a.out === 'upStreak' || r.a.out === 'downStreak')
      return `${formatNum(r.b.v)} ${r.a.out === 'upStreak' ? 'up' : 'down'} closes in a row`;
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
  if (e.trail.on)
    risk.push(`trailing stop ${u(e.trail.unit, e.trail.value)}${e.trail.activate > 0 ? ` once up ${formatNum(e.trail.activate)}%` : ''}`);
  if (e.targets.on) {
    if (e.targets.levels.length === 1) risk.push(`take profit ${u(e.targets.levels[0].unit, e.targets.levels[0].value)}`);
    else
      risk.push(
        e.targets.levels
          .map((l, i) => `${i === e.targets.levels.length - 1 ? 'the rest' : `${formatNum(l.size)}%`} at ${u(l.unit, l.value)}`)
          .join(', '),
      );
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
