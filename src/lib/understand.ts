// The whole plain-English box in one step: the rule reader reads what it can, and anything left over goes to the
// built-in AI, piece by piece, so one odd clause never sinks the rest of a sentence.
import type { Strategy } from './rules';
import { parseEnglish, prepareEnglish, readPhrase, type ParseResult } from './english';

export type Rewrite = (text: string) => Promise<string | null>;

/** Splits a leftover part into the smallest pieces that could each be one rule. */
export function pieces(text: string): string[] {
  return text
    .split(/\s*(?:,|;|\.|\band then\b|\bthen\b|\bbut\b|\bplus\b|\balso\b|\band\b|\bor\b|\bwhile\b|\bas long as\b|\bprovided\b)\s*/)
    .map((p) => p.trim())
    .filter((p) => /[a-z]/.test(p) && p.split(' ').length >= 2);
}

/** Reads a sentence with the reader and the built-in AI together. */
export async function understand(value: string, strategy: Strategy | undefined, rewrite: Rewrite): Promise<ParseResult> {
  const first = parseEnglish(value, strategy);
  if (!first.unknown.length) return first;
  let prepared = prepareEnglish(value);
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
  return parseEnglish(prepared, strategy);
}
