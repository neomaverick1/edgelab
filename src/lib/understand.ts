// The whole plain-English box in one step: the rule reader reads what it can, and anything left over goes to the
// built-in AI, piece by piece, so one odd clause never sinks the rest of a sentence.
import type { Strategy } from './rules';
import { parseEnglish, prepareEnglish, readPhrase, type ParseResult, type ReadOptions } from './english';

export type Rewrite = (text: string) => Promise<string | null>;

/** Splits a leftover part into the smallest pieces that could each be one rule. */
export function pieces(text: string): string[] {
  return text
    .split(/\s*(?:,|;|\.|\band then\b|\bthen\b|\bbut\b|\bplus\b|\balso\b|\band\b|\bor\b|\bwhile\b|\bas long as\b|\bprovided\b)\s*/)
    .map((p) => p.trim())
    .filter((p) => /[a-z]/.test(p) && p.split(' ').length >= 2);
}

/** Reads a sentence with the reader and the built-in AI together. */
export async function understand(
  value: string,
  strategy: Strategy | undefined,
  rewrite: Rewrite,
  opts: ReadOptions = {},
): Promise<ParseResult> {
  const first = parseEnglish(value, strategy, opts);
  if (!first.unknown.length) return first;
  let prepared = prepareEnglish(value, opts);
  for (const u of first.unknown) {
    // The whole leftover first; if the AI can't place it, each piece on its own, joined back with "and".
    const whole = await rewrite(u);
    let to = whole && readPhrase(whole) ? whole : null;
    if (!to) {
      const read: string[] = [];
      for (const p of pieces(u)) {
        const r = await rewrite(p);
        if (r && readPhrase(r)) read.push(r);
      }
      to = read.length ? read.join(' and ') : null;
    }
    if (to) prepared = prepared.includes(u) ? prepared.replace(u, to.toLowerCase()) : `${prepared}, ${to.toLowerCase()}`;
  }
  const r = parseEnglish(prepared, strategy, { ...opts, sell: opts.sell ?? (first.questions.length ? undefined : 'exit') });
  return { ...r, questions: first.questions };
}

// ---------------------------------------------------------------------------------------------------------------
// Corrections. The trader can fix any one rule by saying it again, or tell the box what a word means; the box
// remembers what they taught it on this device.

export type Part = 'longEntry' | 'longExit' | 'shortEntry' | 'shortExit' | 'filter' | 'risk';

/** Which part of the strategy a read-back sentence is about, and the words that start a new version of it. */
export function partOf(sentence: string): { part: Part; lead: string } {
  const t = sentence.toLowerCase();
  if (t.startsWith('buy when')) return { part: 'longEntry', lead: 'buy when ' };
  if (t.startsWith('sell when')) return { part: 'longExit', lead: 'sell when ' };
  if (t.startsWith('short when')) return { part: 'shortEntry', lead: 'short when ' };
  if (t.startsWith('cover when')) return { part: 'shortExit', lead: 'cover when ' };
  if (t.startsWith('only trade when') || t.startsWith('only when')) return { part: 'filter', lead: 'only trade when ' };
  return { part: 'risk', lead: '' };
}

const RISK_KINDS = ['stop', 'trail', 'targets', 'time', 'breakeven'] as const;
const riskKindsIn = (sentence: string) =>
  RISK_KINDS.filter((k) =>
    k === 'stop'
      ? /stop loss/i.test(sentence)
      : k === 'trail'
        ? /trailing/i.test(sentence)
        : k === 'targets'
          ? /take profit|target/i.test(sentence)
          : k === 'time'
            ? /exit after|time exit/i.test(sentence)
            : /breakeven/i.test(sentence),
  );

/** Replaces one part of the strategy with what the trader just said for it. */
export function fixPart(
  current: Strategy,
  sentence: string,
  said: string,
  opts: ReadOptions = {},
): { strategy: Strategy; read: ParseResult } {
  const { part, lead } = partOf(sentence);
  const startsOwn = /^\s*(buy|sell|short|cover|go long|go short|only)\b/i.test(said);
  const read = parseEnglish(startsOwn || part === 'risk' ? said : lead + said, undefined, { ...opts, sell: opts.sell ?? 'exit' });
  const next = structuredClone(current);
  if (part === 'risk') {
    for (const k of riskKindsIn(sentence)) (next.exits[k] as { on: boolean }).on = false;
    for (const k of RISK_KINDS)
      if ((read.strategy.exits[k] as { on: boolean }).on) (next.exits as unknown as Record<string, unknown>)[k] = read.strategy.exits[k];
  } else {
    next[part] = read.strategy[part].items.length ? read.strategy[part] : next[part];
    // said something that belongs elsewhere ("no, that's a short") -> it goes where it belongs
    for (const k of ['longEntry', 'longExit', 'shortEntry', 'shortExit', 'filter'] as const)
      if (k !== part && read.strategy[k].items.length) next[k] = read.strategy[k];
    if (!read.strategy[part].items.length && read.unknown.length === 0) next[part] = { ...next[part], items: [] };
  }
  next.side = next.longEntry.items.length && next.shortEntry.items.length ? 'both' : next.shortEntry.items.length ? 'short' : 'long';
  return { strategy: next, read };
}

/** "sell means go short", "the 25 means the 25 sma": a word and what the trader means by it. */
export function teaching(text: string): { from: string; to: string } | null {
  const m = text
    .trim()
    .match(
      /^(?:no[,.!]?\s*)?(?:by\s+)?["'“]?(.+?)["'”]?\s+(?:means|meant|=|should mean|is supposed to mean|i mean)\s+["'“]?(.+?)["'”]?[.!]?$/i,
    );
  return m ? { from: m[1].toLowerCase(), to: m[2].toLowerCase() } : null;
}

/** Adds what the trader said to the strategy: any part they named is replaced, the rest is kept. */
export function addTo(current: Strategy, said: string, opts: ReadOptions = {}): { strategy: Strategy; read: ParseResult } {
  const read = parseEnglish(said, undefined, { ...opts, sell: opts.sell ?? 'exit' });
  const next = structuredClone(current);
  for (const k of ['longEntry', 'longExit', 'shortEntry', 'shortExit', 'filter'] as const)
    if (read.strategy[k].items.length) next[k] = read.strategy[k];
  for (const k of RISK_KINDS)
    if ((read.strategy.exits[k] as { on: boolean }).on) (next.exits as unknown as Record<string, unknown>)[k] = read.strategy.exits[k];
  next.side = next.longEntry.items.length && next.shortEntry.items.length ? 'both' : next.shortEntry.items.length ? 'short' : 'long';
  return { strategy: next, read };
}

const LEARNED = 'edgelab-learned';
export function learned(): [string, string][] {
  try {
    return JSON.parse(localStorage.getItem(LEARNED) ?? '[]') as [string, string][];
  } catch {
    return [];
  }
}
export function learn(from: string, to: string) {
  const list = learned().filter(([f]) => f !== from);
  list.push([from, to]);
  try {
    localStorage.setItem(LEARNED, JSON.stringify(list));
  } catch {
    /* storage off: it works for this session only */
  }
  return list;
}
export function forget(from: string) {
  const list = learned().filter(([f]) => f !== from);
  try {
    localStorage.setItem(LEARNED, JSON.stringify(list));
  } catch {
    /* storage off */
  }
  return list;
}
