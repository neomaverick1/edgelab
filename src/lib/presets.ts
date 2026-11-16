// A library of well-known systems, each built from ordinary rules, so every one can be opened and edited.
import { blankStrategy, group, ind, num, rule, type Strategy } from './rules';

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  style: 'Trend' | 'Mean reversion' | 'Breakout' | 'Momentum';
  strategy: Strategy;
}

const make = (name: string, edit: (s: Strategy) => void): Strategy => {
  const s = blankStrategy(name);
  edit(s);
  return s;
};

const close = () => ind('price');

export const PRESETS: Preset[] = [
  {
    id: 'golden-cross',
    name: 'Golden cross',
    style: 'Trend',
    blurb: 'Buy when the 50-day average crosses above the 200-day; sell on the death cross.',
    strategy: make('Golden cross', (s) => {
      s.longEntry = group('all', [rule(ind('sma', [50]), 'xup', ind('sma', [200]))]);
      s.longExit = group('all', [rule(ind('sma', [50]), 'xdn', ind('sma', [200]))]);
    }),
  },
  {
    id: 'ema-atr-trail',
    name: 'EMA cross + ATR trail',
    style: 'Trend',
    blurb: 'Fast EMA crosses the slow one; a 3 ATR trailing stop rides the move and an opposite cross closes it.',
    strategy: make('EMA cross + ATR trail', (s) => {
      s.longEntry = group('all', [rule(ind('ema', [9]), 'xup', ind('ema', [21]))]);
      s.longExit = group('all', [rule(ind('ema', [9]), 'xdn', ind('ema', [21]))]);
      s.exits.trail = { on: true, unit: 'atr', value: 3, activate: 0 };
    }),
  },
  {
    id: 'rsi-dip',
    name: 'RSI dip in an uptrend',
    style: 'Mean reversion',
    blurb: 'Buy oversold RSI only above the 200-day average, sell on the bounce, with a stop and a time limit.',
    strategy: make('RSI dip in an uptrend', (s) => {
      s.longEntry = group('all', [rule(ind('rsi', [14]), 'lt', num(30)), rule(close(), 'gt', ind('sma', [200]))]);
      s.longExit = group('all', [rule(ind('rsi', [14]), 'gt', num(60))]);
      s.exits.stop = { on: true, unit: 'pct', value: 8 };
      s.exits.time = { on: true, bars: 15 };
    }),
  },
  {
    id: 'connors-rsi2',
    name: 'Connors RSI-2',
    style: 'Mean reversion',
    blurb: 'Larry Connors’ classic: a 2-period RSI under 10 above the 200-day average, out above the 5-day average.',
    strategy: make('Connors RSI-2', (s) => {
      s.longEntry = group('all', [rule(ind('rsi', [2]), 'lt', num(10)), rule(close(), 'gt', ind('sma', [200]))]);
      s.longExit = group('all', [rule(close(), 'gt', ind('sma', [5]))]);
    }),
  },
  {
    id: 'bollinger-revert',
    name: 'Bollinger snap-back',
    style: 'Mean reversion',
    blurb: 'Buy a close back inside the lower band, take profit at the middle band, stop at 2 ATR.',
    strategy: make('Bollinger snap-back', (s) => {
      s.longEntry = group('all', [rule(close(), 'xup', ind('bb', [20, 2], { out: 'lower' }))]);
      s.longExit = group('all', [rule(close(), 'gt', ind('bb', [20, 2], { out: 'mid' }))]);
      s.exits.stop = { on: true, unit: 'atr', value: 2 };
    }),
  },
  {
    id: 'squeeze-breakout',
    name: 'Bollinger squeeze breakout',
    style: 'Breakout',
    blurb: 'After the bands squeeze tight, buy a close above the upper band and trail 2.5 ATR.',
    strategy: make('Bollinger squeeze breakout', (s) => {
      s.longEntry = group('all', [
        rule(close(), 'xup', ind('bb', [20, 2], { out: 'upper' })),
        rule(ind('bb', [20, 2], { out: 'bandwidth', ago: 1 }), 'lt', num(0.12), { within: 5 }),
      ]);
      s.exits.stop = { on: true, unit: 'atr', value: 2 };
      s.exits.trail = { on: true, unit: 'atr', value: 2.5, activate: 0 };
    }),
  },
  {
    id: 'turtle',
    name: 'Turtle breakout (long & short)',
    style: 'Breakout',
    blurb: 'The Turtle Traders’ 20-day breakout both ways, out on a 10-day break the other way, 2 ATR stop.',
    strategy: make('Turtle breakout', (s) => {
      s.side = 'both';
      s.longEntry = group('all', [rule(close(), 'xup', ind('donchian', [20], { out: 'upper' }))]);
      s.longExit = group('all', [rule(close(), 'xdn', ind('donchian', [10], { out: 'lower' }))]);
      s.shortEntry = group('all', [rule(close(), 'xdn', ind('donchian', [20], { out: 'lower' }))]);
      s.shortExit = group('all', [rule(close(), 'xup', ind('donchian', [10], { out: 'upper' }))]);
      s.exits.stop = { on: true, unit: 'atr', value: 2 };
      s.exits.atrLength = 20;
      s.sizing = { ...s.sizing, mode: 'risk', value: 2 };
    }),
  },
  {
    id: 'macd-trend',
    name: 'MACD with trend filter',
    style: 'Momentum',
    blurb: 'MACD crosses its signal line above the 200 EMA; out on the cross back.',
    strategy: make('MACD with trend filter', (s) => {
      s.longEntry = group('all', [rule(ind('macd', [12, 26, 9]), 'xup', ind('macd', [12, 26, 9], { out: 'signal' })), rule(close(), 'gt', ind('ema', [200]))]);
      s.longExit = group('all', [rule(ind('macd', [12, 26, 9]), 'xdn', ind('macd', [12, 26, 9], { out: 'signal' }))]);
    }),
  },
  {
    id: 'supertrend',
    name: 'Supertrend flip',
    style: 'Trend',
    blurb: 'Always in the market: long when Supertrend turns up, short when it turns down.',
    strategy: make('Supertrend flip', (s) => {
      s.side = 'both';
      s.longEntry = group('all', [rule(ind('supertrend', [10, 3], { out: 'dir' }), 'xup', num(0))]);
      s.shortEntry = group('all', [rule(ind('supertrend', [10, 3], { out: 'dir' }), 'xdn', num(0))]);
    }),
  },
  {
    id: 'ichimoku',
    name: 'Ichimoku cloud',
    style: 'Trend',
    blurb: 'Price above the cloud and Tenkan crossing above Kijun; out when price loses the Kijun.',
    strategy: make('Ichimoku cloud', (s) => {
      const ich = (out: string) => ind('ichimoku', [9, 26, 52], { out });
      s.longEntry = group('all', [rule(ich('tenkan'), 'xup', ich('kijun')), rule(close(), 'gt', ich('spanA')), rule(close(), 'gt', ich('spanB'))]);
      s.longExit = group('all', [rule(close(), 'xdn', ich('kijun'))]);
    }),
  },
  {
    id: 'adx-di',
    name: 'ADX trend strength',
    style: 'Trend',
    blurb: '+DI crosses above −DI while ADX shows a real trend; ATR trailing stop.',
    strategy: make('ADX trend strength', (s) => {
      s.longEntry = group('all', [rule(ind('adx', [14], { out: 'plus' }), 'xup', ind('adx', [14], { out: 'minus' })), rule(ind('adx', [14], { out: 'adx' }), 'gt', num(20))]);
      s.longExit = group('all', [rule(ind('adx', [14], { out: 'minus' }), 'xup', ind('adx', [14], { out: 'plus' }))]);
      s.exits.trail = { on: true, unit: 'atr', value: 3, activate: 0 };
    }),
  },
  {
    id: 'stoch-pullback',
    name: 'Stochastic pullback, 2 targets',
    style: 'Momentum',
    blurb: 'Buy a stochastic hook up in an uptrend. Half off at 1.5R, the rest at 3R, stop to breakeven at 1R.',
    strategy: make('Stochastic pullback', (s) => {
      s.longEntry = group('all', [rule(ind('stoch', [14, 3, 3]), 'xup', num(20)), rule(close(), 'gt', ind('ema', [50]))]);
      s.exits.stop = { on: true, unit: 'atr', value: 1.5 };
      s.exits.targets = {
        on: true,
        levels: [
          { unit: 'r', value: 1.5, size: 50 },
          { unit: 'r', value: 3, size: 50 },
        ],
      };
      s.exits.breakeven = { on: true, unit: 'r', value: 1 };
      s.exits.time = { on: true, bars: 30 };
      s.sizing = { ...s.sizing, mode: 'risk', value: 1, leverage: 3 };
    }),
  },
  {
    id: 'volume-breakout',
    name: 'Volume-confirmed breakout',
    style: 'Breakout',
    blurb: 'A new 55-bar high on 1.5× normal volume; trail 3 ATR, give it at most 40 bars.',
    strategy: make('Volume-confirmed breakout', (s) => {
      s.longEntry = group('all', [rule(close(), 'xup', ind('donchian', [55], { out: 'upper' })), rule(ind('rvol', [20]), 'gt', num(1.5))]);
      s.exits.trail = { on: true, unit: 'atr', value: 3, activate: 0 };
      s.exits.time = { on: true, bars: 40 };
    }),
  },
  {
    id: 'zscore-pairs',
    name: 'Z-score mean reversion',
    style: 'Mean reversion',
    blurb: 'Buy two standard deviations below the mean and short two above; out when price gets back to the mean.',
    strategy: make('Z-score mean reversion', (s) => {
      s.side = 'both';
      s.longEntry = group('all', [rule(ind('zscore', [20]), 'xup', num(-2))]);
      s.longExit = group('all', [rule(ind('zscore', [20]), 'gt', num(0))]);
      s.shortEntry = group('all', [rule(ind('zscore', [20]), 'xdn', num(2))]);
      s.shortExit = group('all', [rule(ind('zscore', [20]), 'lt', num(0))]);
      s.exits.stop = { on: true, unit: 'atr', value: 3 };
    }),
  },
  {
    id: 'hull-scalp',
    name: 'Hull + RSI momentum',
    style: 'Momentum',
    blurb: 'Hull average turning up with RSI above 50 and price over VWAP; scale in on strength.',
    strategy: make('Hull + RSI momentum', (s) => {
      s.longEntry = group('all', [rule(ind('hma', [55]), 'rising', num(0)), rule(ind('rsi', [14]), 'gt', num(50)), rule(close(), 'gt', ind('vwap', [24]))]);
      s.longExit = group('all', [rule(ind('hma', [55]), 'falling', num(0))]);
      s.exits.stop = { on: true, unit: 'atr', value: 2 };
      s.sizing = { ...s.sizing, value: 50, scaleIn: { on: true, max: 1, size: 100, onlyInProfit: true } };
    }),
  },
];

export const presetById = (id: string) => PRESETS.find((p) => p.id === id);

/** Sentences for the plain-English box to show what it can read. */
export const ENGLISH_EXAMPLES = [
  'Buy when RSI 14 is below 30 and close is above the 200 EMA. Sell when RSI crosses above 60. Stop loss 2 ATR, exit after 15 bars.',
  'Go long when the 20 EMA crosses above the 50 EMA and ADX is above 25. Short when the 20 EMA crosses below the 50 EMA. Trailing stop 3 ATR.',
  'Buy when price breaks above the 55 day high and relative volume is above 1.5. Take half at 2R and the rest at 5R, stop loss 1.5 ATR, breakeven after 1R, risk 1% per trade.',
  'Buy when a bullish engulfing appears and RSI is below 40 and price is above the cloud. Sell when close crosses below kijun. Stop 5%.',
  'Buy on a golden cross, sell on a death cross.',
];
