// What the built-in AI knows how to mean. Each entry is a way a trader might say something, and the rule it means,
// written the way the rule reader reads it. The AI matches what was typed to the closest of these by meaning (not by
// words), then fills in the trader's own numbers: {1} is the first number they typed, {1:2} falls back to 2 when they
// didn't give one.

export const MEANINGS: [string, string][] = [
  // stops: a move against the trade
  ['candle flips to N times the atr', 'stop loss {1:2} atr'],
  ['price moves N atr against me', 'stop loss {1:2} atr'],
  ['if it goes the wrong way by N atr', 'stop loss {1:2} atr'],
  ['give it N atr of room', 'stop loss {1:2} atr'],
  ['protect the trade N atr below entry', 'stop loss {1:2} atr'],
  ['if it drops N percent', 'stop loss {1:2}%'],
  ['if I lose N percent', 'stop loss {1:2}%'],
  ['cut my losses at N percent', 'stop loss {1:2}%'],
  ['if I am down N percent sell', 'stop loss {1:2}%'],
  ['bail if it falls N percent from where I bought', 'stop loss {1:2}%'],
  ['never lose more than N percent on a trade', 'stop loss {1:2}%'],
  ['get out if it tanks', 'stop loss 3%'],
  // targets: a move for the trade
  ['take the money when it is up N percent', 'take profit {1:5}%'],
  ['cash out after a N percent gain', 'take profit {1:5}%'],
  ['sell when I make N percent', 'take profit {1:5}%'],
  ['price runs N atr in my favor', 'take profit {1:3} atr'],
  ['target N times the atr', 'take profit {1:3} atr'],
  ['let it run to N atr', 'take profit {1:3} atr'],
  ['grab a quick profit', 'take profit 3%'],
  // trailing stops
  ['lock in profits with a N atr trail', 'trailing stop {1:3} atr'],
  ['trail it by N percent', 'trailing stop {1:5}%'],
  ['follow the price up with a stop N percent behind', 'trailing stop {1:5}%'],
  ['let winners run but protect gains', 'trailing stop 3 atr'],
  ['trail my stop N atr behind', 'trailing stop {1:3} atr'],
  ['keep the stop N percent under the price as it climbs', 'trailing stop {1:5}%'],
  ['move my stop up as it rises', 'trailing stop 3 atr'],
  // time
  ['hold it for N days', 'exit after {1:10} bars'],
  ['close the trade after N candles', 'exit after {1:10} bars'],
  ['get out if nothing happens after N bars', 'exit after {1:10} bars'],
  ['only keep it a week', 'exit after 5 bars'],
  ['close it after N days no matter what', 'exit after {1:10} bars'],

  // trend
  ['the trend is up', 'close is above sma 200'],
  ['the market is bullish', 'close is above sma 200'],
  ['it has been going up for a while', 'close is above sma 200'],
  ['the long term trend is healthy', 'close is above sma 200'],
  ['bull market', 'close is above sma 200'],
  ['it is in a strong uptrend', 'close is above sma 200'],
  ['prices keep climbing', 'close is above sma 200'],
  ['it is trending higher', 'close is above sma 200'],
  ['the price is rocketing', 'close is rising'],
  ['it is shooting up', 'close is rising'],
  ['it keeps going up and up', 'close is above sma 200'],
  ['the stock keeps rising', 'close is above sma 200'],
  ['buyers are in control', 'close is above sma 200'],
  ['the trend is down', 'close is below sma 200'],
  ['the market is bearish', 'close is below sma 200'],
  ['it has been falling for weeks', 'close is below sma 200'],
  ['bear market', 'close is below sma 200'],
  ['it is in a strong downtrend', 'close is below sma 200'],
  ['it keeps sliding lower', 'close is below sma 200'],
  ['it keeps going down and down', 'close is below sma 200'],
  ['sellers are in control', 'close is below sma 200'],
  ['price is going up right now', 'close is rising'],
  ['price ticks higher', 'close is rising'],
  ['price is dropping right now', 'close is falling'],
  ['price ticks lower', 'close is falling'],
  ['it is plunging', 'close is falling'],
  ['the whole market is crashing', 'close is below sma 200'],

  // strength and momentum
  ['the chart looks really strong', 'adx 14 is above 25'],
  ['the trend is strong', 'adx 14 is above 25'],
  ['there is a powerful move happening', 'adx 14 is above 25'],
  ['the market is choppy', 'adx 14 is below 20'],
  ['price is moving sideways', 'adx 14 is below 20'],
  ['the market is ranging with no direction', 'adx 14 is below 20'],
  ['momentum is picking up', 'roc 10 crosses above 0'],
  ['momentum turns bullish', 'roc 10 crosses above 0'],
  ['momentum is fading', 'roc 10 crosses below 0'],
  ['momentum turns bearish', 'roc 10 crosses below 0'],
  ['macd turns bullish', 'macd crosses above macd signal'],
  ['macd gives a buy signal', 'macd crosses above macd signal'],
  ['macd turns bearish', 'macd crosses below macd signal'],
  ['macd gives a sell signal', 'macd crosses below macd signal'],

  // stretched or cheap
  ['price is cheap', 'rsi 14 is below 30'],
  ['it has been beaten down', 'rsi 14 is below 30'],
  ['the stock is oversold', 'rsi 14 is below 30'],
  ['everyone is panic selling', 'rsi 14 is below 30'],
  ['people are dumping it hard', 'rsi 14 is below 30'],
  ['it got crushed', 'rsi 14 is below 30'],
  ['it is on sale', 'rsi 14 is below 30'],
  ['it is super cheap right now', 'rsi 14 is below 30'],
  ['it is a bargain', 'rsi 14 is below 30'],
  ['it is way too low', 'rsi 14 is below 30'],
  ['price is expensive', 'rsi 14 is above 70'],
  ['it is overextended', 'rsi 14 is above 70'],
  ['the rally is overheated', 'rsi 14 is above 70'],
  ['everyone is greedy and buying', 'rsi 14 is above 70'],
  ['it went up too fast', 'rsi 14 is above 70'],
  ['rsi recovers from oversold', 'rsi 14 crosses above 30'],
  ['rsi rolls over from overbought', 'rsi 14 crosses below 70'],
  ['rsi is above N', 'rsi 14 is above {1:50}'],
  ['rsi is below N', 'rsi 14 is below {1:50}'],

  // volume
  ['buyers are piling in', 'relative volume is above 1.5'],
  ['volume is surging', 'relative volume is above 1.5'],
  ['lots of people are trading it', 'relative volume is above 1.5'],
  ['heavy buying pressure', 'relative volume is above 1.5'],
  ['lots of shares are changing hands', 'relative volume is above 1.5'],
  ['trading activity is way up', 'relative volume is above 1.5'],
  ['big money is coming in', 'relative volume is above 2'],
  ['volume is N times normal', 'relative volume is above {1:2}'],
  ['volume dries up', 'relative volume is below 0.7'],
  ['nobody is trading it', 'relative volume is below 0.7'],
  ['it looks dead', 'relative volume is below 0.7'],
  ['there is no interest in it', 'relative volume is below 0.7'],

  // volatility
  ['volatility is high', 'atr is rising'],
  ['the market is getting wild', 'atr is rising'],
  ['volatility is low', 'atr is falling'],
  ['the market is quiet', 'atr is falling'],

  // levels
  ['price breaks out to a new N day high', 'close crosses above the {1:20} bar high'],
  ['it hits a new high', 'close crosses above the 20 bar high'],
  ['it is making fresh N day highs', 'close crosses above the {1:20} bar high'],
  ['highest price in N days', 'close crosses above the {1:20} bar high'],
  ['price breaks the top of the range', 'close crosses above the 20 bar high'],
  ['price makes a new N day low', 'close crosses below the {1:20} bar low'],
  ['it hits a new low', 'close crosses below the 20 bar low'],
  ['it is making fresh N day lows', 'close crosses below the {1:20} bar low'],
  ['lowest price in N days', 'close crosses below the {1:20} bar low'],
  ['price breaks the bottom of the range', 'close crosses below the 20 bar low'],
  ['price is at the bottom of its range', 'close is below the lower bollinger band'],
  ['price is stretched below normal', 'close is below the lower bollinger band'],
  ['price is at the top of its range', 'close is above the upper bollinger band'],
  ['price is stretched above normal', 'close is above the upper bollinger band'],

  // averages
  ['price is above the N day average', 'close is above sma {1:50}'],
  ['price is below the N day average', 'close is below sma {1:50}'],
  ['price climbs over the N ema', 'close crosses above ema {1:20}'],
  ['price slips under the N ema', 'close crosses below ema {1:20}'],
  ['price climbs over the N sma', 'close crosses above sma {1:50}'],
  ['price slips under the N sma', 'close crosses below sma {1:50}'],
  ['the short average crosses over the long one', 'ema 9 crosses above ema 21'],
  ['the short average crosses under the long one', 'ema 9 crosses below ema 21'],
  ['price dips to the average and bounces', 'low crosses below ema 20'],
];

/** The phrase with its numbers swapped for "N", which is how it's compared by meaning. */
export const shape = (text: string) => text.toLowerCase().replace(/\d+(?:\.\d+)?/g, 'N');

/** Fills a meaning's numbers from the ones the trader typed. */
export function fillMeaning(template: string, typed: string): string {
  const nums = typed.match(/\d+(?:\.\d+)?/g) ?? [];
  return template.replace(/\{(\d)(?::([\d.]+))?\}/g, (_m, i: string, fallback?: string) => nums[Number(i) - 1] ?? fallback ?? '');
}

// Meaning models know "tanking" and "flying" are both about price moving, but not always which way. So the AI also
// checks direction: when the trader's words clearly point up or down, only a meaning that goes the same way is used.
const UP_WORDS = /\b(up|higher|rise|rises|rising|rally|rallies|flying|fly|rocket\w*|moon\w*|soar\w*|surg\w*|jump\w*|climb\w*|gain\w*|profit\w*|green|bull\w*|spik\w*|boom\w*|pump\w*|rip\w*|crazy|huge|massive|heavy|explod\w*|lots|tons|expensive|overbought|top|highs?)\b/;
const DOWN_WORDS = /\b(down|lower|drop\w*|fall\w*|fell|tank\w*|crash\w*|plung\w*|dump\w*|sink\w*|sank|slid\w*|slip\w*|los[se]\w*|lost|red|bear\w*|cheap\w*|dead|dry|dries|quiet|thin|oversold|bottom|lows?|panic\w*|crush\w*)\b/;

type Way = 'up' | 'down' | null;
export function wayOfText(text: string): Way {
  const t = text.toLowerCase();
  const up = UP_WORDS.test(t);
  const down = DOWN_WORDS.test(t);
  return up === down ? null : up ? 'up' : 'down';
}
export function wayOfMeaning(template: string): Way {
  if (/^(trailing|exit after|adx|atr)\b/.test(template)) return null;
  if (/stop loss|below|falling|bar low/.test(template)) return 'down';
  if (/take profit|above|rising|bar high/.test(template)) return 'up';
  return null;
}

/** Picks the meaning for a phrase from its similarity to every meaning, or -1 when nothing is close enough. */
export function pickMeaning(scores: number[], text: string, threshold: number): number {
  const order = scores.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0]);
  const way = wayOfText(text);
  const ok = (i: number) => !way || wayOfMeaning(MEANINGS[i][1]) === way;
  const same = order.find(([s, i]) => s >= threshold && ok(i) && wayOfMeaning(MEANINGS[i][1]));
  if (same) return same[1];
  const any = order.find(([s, i]) => s >= threshold && ok(i));
  return any ? any[1] : -1;
}
