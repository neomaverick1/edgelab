// Runs the real built-in AI model on everyday phrases. The model is fetched in CI (scripts/fetch-ai-model.sh); without
// it this test is skipped.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { describe, expect, it } from 'vitest';

import { readPhrase } from './english';
import { fillMeaning, MEANINGS, pickMeaning, shape } from './meanings';

const DIR = resolve(__dirname, '../../public/models');
const MODELS = ['Xenova/bge-small-en-v1.5', 'Xenova/all-MiniLM-L6-v2'].filter((m) => existsSync(resolve(DIR, m, 'onnx/model_quantized.onnx')));
const has = MODELS.includes('Xenova/bge-small-en-v1.5');

const CASES: [string, RegExp][] = [
  ['the chart looks really strong', /ADX 14 is above/],
  ['buyers are piling in', /RelVol/],
  ['candle flips to 1.5 times the atr', /Stop loss 1.5 × ATR/],
  ['it is super cheap right now', /RSI 14 is below 30/],
  ['it went up way too much', /RSI 14 is above 70/],
  ['bail if it drops 4 percent', /Stop loss 4%/],
  ['cash in when I am up 10 percent', /Take profit 100% at 10%/],
  ['the market is flat and boring', /ADX 14 is below|ATR 14 is falling/],
  ['huge volume coming in', /RelVol/],
  ['the trend is pointing down', /below SMA 200|falling/],
  ['it is in a strong uptrend', /above SMA 200|ADX/],
  ['stock keeps going up and up', /above SMA 200|rising/],
  ['people are dumping it hard', /RSI 14 is below|falling|below SMA 200/],
  ['hold for 15 candles', /Time exit after 15 bars/],
  ['trail my stop 2 atr behind', /Trailing stop 2 × ATR/],
  // said differently from anything in MEANINGS
  ['the price is rocketing', /above SMA 200|rising|ADX/],
  ['it looks totally dead', /ADX 14 is below|ATR 14 is falling|RelVol 20 is below/],
  ['get me out after 8 bars', /Time exit after 8 bars/],
  ['sell half when I double my risk', /Take profit|Stop/],
  ['only if lots of shares are changing hands', /RelVol 20 is above/],
  ['when it is stupidly overbought', /RSI 14 is above 70/],
  ['if it crashes 6 percent get out', /Stop loss 6%/],
  ['it is making fresh 52 day highs', /above 52-bar high/],
  // a fresh set, never tuned against
  ['the thing is absolutely flying', /above SMA 200|rising|ADX/],
  ['volume went crazy', /RelVol 20 is above/],
  ["if I'm down 3 percent just sell", /Stop loss 3%/],
  ['bank the profit at 12 percent', /Take profit 100% at 12%/],
  ['price is way oversold', /RSI 14 is below 30/],
  ['the whole market is tanking', /below SMA 200|falling|RSI 14 is below/],
  ['after 20 days close it no matter what', /Time exit after 20 bars/],
  ['lowest close in 30 days', /below 30-bar low/],
];

describe.skipIf(!has)('built-in AI model', () => {
  it.each(MODELS)('%s understands everyday phrases', async (model) => {
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.localModelPath = DIR + '/';
    const make = pipeline as unknown as (task: string, model: string, opts: Record<string, unknown>) => Promise<FeatureExtractionPipeline>;
    const embed = await make('feature-extraction', model, { dtype: 'q8' });
    const vec = async (t: string) => (await embed(shape(t), { pooling: 'mean', normalize: true })).data as Float32Array;
    const bank = await Promise.all(MEANINGS.map(([p]) => vec(p)));
    let ok = 0;
    for (const [text, want] of CASES) {
      const v = await vec(text);
      const scores = bank.map((b) => b.reduce((s, x, k) => s + x * v[k], 0));
      const pick = pickMeaning(scores, text, model.includes('bge') ? 0.72 : 0.6);
      const best = pick >= 0 ? pick : scores.indexOf(Math.max(...scores));
      const read = pick >= 0 ? (readPhrase(fillMeaning(MEANINGS[best][1], text)) ?? '') : '(asks to say it another way)';
      const good = want.test(read);
      if (good) ok++;
      console.log(`${good ? 'OK' : 'X '} ${scores[best].toFixed(2)} "${text}" -> ${MEANINGS[best][0]} -> ${read}`);
    }
    console.log(`${model}: ${ok}/${CASES.length}`);
    if (model === MODELS[0]) expect(ok / CASES.length).toBeGreaterThanOrEqual(0.85);
  }, 120000);
});
