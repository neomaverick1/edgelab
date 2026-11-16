// The built-in AI: a small language-understanding model (about 21 MB) that ships inside the app and runs on the
// device. It works out what a phrase means by comparing it with every phrasing in MEANINGS, picks the closest one,
// and fills in the trader's own numbers. No download, no connection, nothing leaves the device.
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import ortWasm from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url';

import { fillMeaning, MEANINGS, shape } from '../lib/meanings';

export const AI_MODEL = 'Xenova/all-MiniLM-L6-v2';

export type AiRequest = { type: 'load' } | { type: 'rewrite'; id: number; text: string };
export type AiReply =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; device: string }
  | { type: 'rewrite'; id: number; text: string | null; score: number }
  | { type: 'error'; id?: number; message: string };

// How close a phrase has to be to a known meaning before the AI uses it (cosine similarity, 0 to 1).
const MATCH = 0.6;

// The model and the AI engine both come from the app itself.
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = new URL('models/', new URL('../', self.location.href)).href;
const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown } };
if (onnx.wasm) onnx.wasm.wasmPaths = { wasm: new URL(ortWasm, self.location.href).href };

const post = (m: AiReply) => self.postMessage(m);

type Ai = { embed: FeatureExtractionPipeline; bank: Float32Array[] };
let ai: Promise<Ai> | null = null;

async function vectors(embed: FeatureExtractionPipeline, texts: string[]) {
  const out = await embed(texts, { pooling: 'mean', normalize: true });
  const dim = out.dims[1];
  const data = out.data as Float32Array;
  return texts.map((_, i) => data.slice(i * dim, (i + 1) * dim));
}

async function load(): Promise<Ai> {
  const make = pipeline as unknown as (task: string, model: string, opts: Record<string, unknown>) => Promise<FeatureExtractionPipeline>;
  const embed = await make('feature-extraction', AI_MODEL, { device: 'wasm', dtype: 'q8' });
  const bank: Float32Array[] = [];
  for (let i = 0; i < MEANINGS.length; i += 32) bank.push(...(await vectors(embed, MEANINGS.slice(i, i + 32).map(([p]) => shape(p)))));
  return { embed, bank };
}

self.onmessage = async (e: MessageEvent<AiRequest>) => {
  const req = e.data;
  try {
    ai ??= load();
    const { embed, bank } = await ai;
    if (req.type === 'load') {
      post({ type: 'ready', device: 'wasm' });
      return;
    }
    const [v] = await vectors(embed, [shape(req.text)]);
    let best = -1;
    let score = -1;
    bank.forEach((b, i) => {
      let s = 0;
      for (let k = 0; k < b.length; k++) s += b[k] * v[k];
      if (s > score) {
        score = s;
        best = i;
      }
    });
    post({ type: 'rewrite', id: req.id, text: score >= MATCH ? fillMeaning(MEANINGS[best][1], req.text) : null, score });
  } catch (err) {
    if (req.type === 'load') ai = null;
    post({ type: 'error', id: req.type === 'rewrite' ? req.id : undefined, message: err instanceof Error ? err.message : String(err) });
  }
};
