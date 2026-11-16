import { describe, expect, it } from 'vitest';

import { readPhrase } from './english';
import { fillMeaning, MEANINGS } from './meanings';

describe('built-in AI meanings', () => {
  it('every meaning reads as a rule, with and without the trader’s numbers', () => {
    for (const [example, template] of MEANINGS) {
      expect(readPhrase(fillMeaning(template, example)), `${example} -> ${template}`).not.toBeNull();
      expect(readPhrase(fillMeaning(template, example.replace(/\bN\b/g, '7'))), template).not.toBeNull();
    }
  });
  it('keeps the trader’s numbers', () => {
    expect(fillMeaning('stop loss {1:2} atr', 'candle flips to 1.5 times the atr')).toBe('stop loss 1.5 atr');
    expect(fillMeaning('stop loss {1:2} atr', 'give it room')).toBe('stop loss 2 atr');
  });
});
