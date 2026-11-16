// Runs the real built-in AI model on everyday phrases. The model is fetched in CI (scripts/fetch-ai-model.sh); without
// it this test is skipped.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { describe, expect, it } from 'vitest';

import { readPhrase } from './english';
import { fillMeaning, MEANINGS, shape } from './meanings';

const DIR = resolve(__dirname, '../../public/models');
const has = existsSync(resolve(DIR, 'Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx'));

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
];

describe.skipIf(!has)('built-in AI model', () => {
  it('understands everyday phrases', async () => {
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.localModelPath = DIR + '/';
    const make = pipeline as unknown as (task: string, model: string, opts: Record<string, unknown>) => Promise<FeatureExtractionPipeline>;
    const embed = await make('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });
    const vec = async (t: string) => (await embed(shape(t), { pooling: 'mean', normalize: true })).data as Float32Array;
    const bank = await Promise.all(MEANINGS.map(([p]) => vec(p)));
    let ok = 0;
    for (const [text, want] of CASES) {
      const v = await vec(text);
      const scores = bank.map((b) => b.reduce((s, x, k) => s + x * v[k], 0));
      const best = scores.indexOf(Math.max(...scores));
      const read = readPhrase(fillMeaning(MEANINGS[best][1], text)) ?? '';
      const good = want.test(read);
      if (good) ok++;
      console.log(`${good ? 'OK' : 'X '} ${scores[best].toFixed(2)} "${text}" -> ${MEANINGS[best][0]} -> ${read}`);
    }
    expect(ok).toBeGreaterThanOrEqual(CASES.length - 1);
  }, 120000);
});
