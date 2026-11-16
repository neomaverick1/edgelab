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

describe('direction check', () => {
  it('reads which way a phrase points', async () => {
    const { wayOfText, wayOfMeaning } = await import('./meanings');
    expect(wayOfText("if I'm down 3 percent just sell")).toBe('down');
    expect(wayOfText('the thing is absolutely flying')).toBe('up');
    expect(wayOfText('the whole market is tanking')).toBe('down');
    expect(wayOfText('hold for 15 candles')).toBe(null);
    expect(wayOfMeaning('take profit 5%')).toBe('up');
    expect(wayOfMeaning('stop loss 2 atr')).toBe('down');
    expect(wayOfMeaning('adx 14 is above 25')).toBe(null);
  });
});
