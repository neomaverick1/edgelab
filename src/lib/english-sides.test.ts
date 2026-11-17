// Strategies written the way a person explains them: a side at a time, "it buys", "it sells to close",
// "the average" meaning the one already named, and stops set as a distance from that average.
import { describe, expect, it } from 'vitest';

import { describe as describeStrategy, parseEnglish } from './english';

const MA_FLIP_SMA = [
  'Buy side: when a candle closes above the 25-period moving average, it buys. It sells to close when a candle closes back below the average, or when price drops 1.5 ATR below the average.',
  'Sell side: when a candle closes below the 25-period moving average, it sells. It buys to close when a candle closes back above the average, or when price rises 1.5 ATR above the average.',
].join('\n\n');

const EXPECT_SMA =
  'Buy when Close crosses above SMA 25. Sell when (Close crosses below SMA 25) or (Close is below SMA 25 - 1.5 ATR). ' +
  'Short when Close crosses below SMA 25. Cover when (Close crosses above SMA 25) or (Close is above SMA 25 + 1.5 ATR).';

const EXPECT_EMA = EXPECT_SMA.replace(/SMA 25/g, 'EMA 20');

describe('a strategy explained a side at a time', () => {
  it('reads both sides, both exits and the ATR distance from the average', () => {
    const r = parseEnglish(MA_FLIP_SMA);
    expect(r.unknown).toEqual([]);
    expect(r.questions).toEqual([]);
    expect(r.strategy.side).toBe('both');
    expect(describeStrategy(r.strategy)).toBe(EXPECT_SMA);
  });

  it.each([
    [
      'other words for the sides and the exits',
      'Long side: if the candle closes above the 20-period exponential moving average, we go long. We close the trade when it closes back under the EMA or when price moves 1.5 ATR under the EMA. ' +
        'Short side: if the candle closes below the 20-period exponential moving average, we go short. We close the trade when it closes back over the EMA or when price moves 1.5 ATR over the EMA.',
    ],
    [
      'no headings, "it buys when"',
      'It buys when a candle closes above the 20 EMA. It sells to close when a candle closes back below the EMA, or when price falls 1.5 times the ATR below the EMA. ' +
        'It sells short when a candle closes below the 20 EMA. It buys to close when a candle closes back above the EMA, or when price climbs 1.5 times the average true range above the EMA.',
    ],
    [
      'headings as "For longs:" and the bot as the subject',
      'For longs: when the candle closes above the 20 ema, the bot buys. The bot exits when a candle closes back below the average, or if price drops 1.5 ATR below the average.\n' +
        'For shorts: when the candle closes below the 20 ema, the bot sells. The bot exits when a candle closes back above the average, or if price rises 1.5 ATR above the average.',
    ],
  ])('%s', (_name, text) => {
    const r = parseEnglish(text);
    expect(r.unknown).toEqual([]);
    expect(r.questions).toEqual([]);
    expect(r.strategy.side).toBe('both');
    expect(describeStrategy(r.strategy)).toBe(EXPECT_EMA);
  });

  it('reads its own read-back the same way', () => {
    const r = parseEnglish(EXPECT_SMA);
    expect(r.unknown).toEqual([]);
    expect(describeStrategy(r.strategy)).toBe(EXPECT_SMA);
  });

  it('keeps a plain one-sided strategy as it was', () => {
    const r = parseEnglish('Buy side: when a candle closes above the 50 day moving average, it buys. It sells to close when a candle closes below the average.');
    expect(r.unknown).toEqual([]);
    expect(r.strategy.side).toBe('long');
    expect(describeStrategy(r.strategy)).toBe('Buy when Close crosses above SMA 50. Sell when Close crosses below SMA 50.');
  });
});
