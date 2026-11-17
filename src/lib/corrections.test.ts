import { describe, expect, it } from 'vitest';

import { describe as describeStrategy, parseEnglish } from './english';
import { addTo, fixPart, teaching } from './understand';

const RANDY =
  'Buy when sma closes above the 25 sma. If it crosses 1.5 times the atr in the other direction the trade closes or when it closes below the 25sma. Sell when sma closes below the 25 sma. If it crosses 1.5 times the atr in the other direction the trade closes or when it closes above the 25sma.';

describe('reads each trade with its own exits', () => {
  it('reads the long, its exits, the short and its exits exactly as said', () => {
    const r = parseEnglish(RANDY);
    expect(r.unknown).toEqual([]);
    expect(r.questions).toEqual([]);
    expect(describeStrategy(r.strategy)).toBe(
      'Buy when Close crosses above SMA 25. Sell when Close crosses below SMA 25. Short when Close crosses below SMA 25. Cover when Close crosses above SMA 25. Stop loss 1.5 ATR.',
    );
  });
  it('asks what “sell” means when it could be either, instead of guessing', () => {
    const r = parseEnglish('buy when rsi is under 30. sell when rsi is over 70');
    expect(r.questions.map((q) => q.id)).toEqual(['sell']);
    expect(
      describeStrategy(parseEnglish('buy when rsi is under 30. sell when rsi is over 70', undefined, { sell: 'short' }).strategy),
    ).toMatch(/Short when RSI 14 is above 70/);
  });
});

describe('corrections', () => {
  const start = parseEnglish('buy when rsi is under 30. sell when rsi is over 70. stop loss 2%').strategy;
  it('Fix replaces just that rule', () => {
    const { strategy } = fixPart(start, 'Sell when RSI 14 is above 70.', 'rsi crosses above 60');
    expect(describeStrategy(strategy)).toBe('Buy when RSI 14 is below 30. Sell when RSI 14 crosses above 60. Stop loss 2%.');
  });
  it('Fix on a stop changes the stop', () => {
    const { strategy } = fixPart(start, 'Stop loss 2%.', 'stop loss 1.5 atr');
    expect(describeStrategy(strategy)).toMatch(/Stop loss 1.5 ATR\.$/);
  });
  it('a reply adds or replaces the part it names', () => {
    const { strategy } = addTo(start, 'take profit 6%');
    expect(describeStrategy(strategy)).toMatch(/Stop loss 2%, take profit 6%/);
  });
  it('understands “X means Y”', () => {
    expect(teaching('sell means go short')).toEqual({ from: 'sell', to: 'go short' });
    expect(teaching('no, "the 25" means the 25 sma')).toEqual({ from: 'the 25', to: 'the 25 sma' });
    expect(teaching('buy when rsi is under 30')).toBeNull();
  });
  it('uses what the trader taught it', () => {
    const r = parseEnglish('buy when it pops', undefined, { learned: [['pops', 'crosses above the 20 ema']] });
    expect(describeStrategy(r.strategy)).toMatch(/Buy when Close crosses above EMA 20/);
  });
});
