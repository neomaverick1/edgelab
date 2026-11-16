// The built-in AI: a small language model that runs on the device (WebGPU when the phone or browser has it,
// otherwise the CPU). It rewrites a condition the rule reader couldn't understand into words the reader knows.
import { env, pipeline, type TextGenerationPipeline } from '@huggingface/transformers';
import ortWasm from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url';

// The larger model when the device has a GPU for it; a smaller one that still runs at a usable speed on the CPU.
// The phone apps carry the small one inside the app (in /models), so it needs no download and no connection.
export const AI_MODEL_GPU = 'onnx-community/Qwen2.5-1.5B-Instruct';
export const AI_MODEL_CPU = 'onnx-community/Qwen2.5-0.5B-Instruct';

export type AiRequest = { type: 'load'; builtIn: boolean } | { type: 'rewrite'; id: number; text: string };
export type AiReply =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; device: string }
  | { type: 'rewrite'; id: number; text: string }
  | { type: 'error'; id?: number; message: string };

const SYSTEM = `Rewrite what a trader typed into the strict form below. Output only the rewritten text, nothing else.
A condition is "<value> <comparison> <value>". An exit is one of: "stop loss 2%", "stop loss 1.5 atr", "take profit 6%", "take profit 3 atr", "trailing stop 2 atr", "exit after 10 bars".
Comparisons: crosses above, crosses below, is above, is below, is rising, is falling.
Values: close, open, high, low, volume, a number, EMA 20, SMA 200, WMA 20, HMA 21, VWAP, RSI 14, ATR 14, ADX 14, CCI 20, MFI 14, ROC 10, Williams %R 14, Stochastic %K, Stochastic %D, MACD line, MACD signal, MACD histogram, upper Bollinger band, middle Bollinger band, lower Bollinger band, Supertrend, Parabolic SAR, the 20 bar high, the 20 bar low, relative volume.
Two conditions can be joined with "and".
Keep the subject on the left: "price is under X" means "close is below X", never "X is below close".
Keep every number the trader gave. Indicator lengths come right after the name: "the 9 ema" is "EMA 9".
Facts: price = close. The trend is up = close is above SMA 200. The trend is down = close is below SMA 200. Pulls back to X = low crosses below X. Bounces off X = close crosses above X. Volume is high or above normal = relative volume is above 1.5. Momentum turns negative = ROC 10 crosses below 0. Momentum turns positive = ROC 10 crosses above 0. Strong trend = ADX 14 is above 25. Weak trend or ranging = ADX 14 is below 20. Not overbought = RSI 14 is below 70. Not oversold = RSI 14 is above 30. Bullish EMAs stacked = EMA 9 is above EMA 21 and EMA 21 is above EMA 50.`;

const SHOTS: [string, string][] = [
  ['price is over the 50 day moving average', 'close is above SMA 50'],
  ['rsi comes up out of oversold', 'RSI 14 crosses above 30'],
  ['macd flips bullish', 'MACD line crosses above MACD signal'],
  ['price is under the 20 ema', 'close is below EMA 20'],
  ['stochastic crosses up from below 20', 'Stochastic %K crosses above 20'],
  ['candle flips to 1.5 times the atr', 'stop loss 1.5 atr'],
  ['it pops 5 percent', 'take profit 5%'],
  ['buyers are piling in', 'relative volume is above 1.5'],
];

// The AI engine ships with the app too, so it never reaches out to a CDN.
const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown } };
if (onnx.wasm) onnx.wasm.wasmPaths = { wasm: new URL(ortWasm, self.location.href).href };

let gen: Promise<TextGenerationPipeline> | null = null;
let device = 'wasm';

const post = (m: AiReply) => self.postMessage(m);

async function load(builtIn: boolean) {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  const hasGpu = !!gpu && !!(await gpu.requestAdapter().catch(() => null));
  device = hasGpu ? 'webgpu' : 'wasm';
  env.allowLocalModels = builtIn;
  env.allowRemoteModels = !builtIn;
  if (builtIn) env.localModelPath = new URL('/models/', self.location.origin).href;
  const model = builtIn ? AI_MODEL_CPU : hasGpu ? AI_MODEL_GPU : AI_MODEL_CPU;
  const dtype = builtIn ? 'q4' : hasGpu ? 'q4f16' : 'q4';
  const files = new Map<string, { loaded: number; total: number }>();
  const make = pipeline as unknown as (task: string, model: string, opts: Record<string, unknown>) => Promise<TextGenerationPipeline>;
  const opts = (dev: string) => ({
    device: dev,
    dtype,
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== 'progress' || !p.file) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      post({ type: 'progress', loaded, total });
    },
  });
  try {
    return await make('text-generation', model, opts(device));
  } catch (err) {
    if (device === 'wasm') throw err;
    device = 'wasm';
    return await make('text-generation', model, opts('wasm'));
  }
}

self.onmessage = async (e: MessageEvent<AiRequest>) => {
  const req = e.data;
  try {
    gen ??= load(req.type === 'load' ? req.builtIn : false);
    const g = await gen;
    if (req.type === 'load') {
      post({ type: 'ready', device });
      return;
    }
    const messages = [{ role: 'system', content: SYSTEM }];
    for (const [q, a] of SHOTS) messages.push({ role: 'user', content: q }, { role: 'assistant', content: a });
    messages.push({ role: 'user', content: req.text });
    const out = (await g(messages, { max_new_tokens: 48, do_sample: false })) as unknown as { generated_text: { content: string }[] }[];
    const text = out[0].generated_text.at(-1)!.content.trim().split('\n')[0].replace(/^["']|["'.]+$/g, '');
    post({ type: 'rewrite', id: req.id, text });
  } catch (err) {
    if (req.type === 'load') gen = null;
    post({ type: 'error', id: req.type === 'rewrite' ? req.id : undefined, message: err instanceof Error ? err.message : String(err) });
  }
};
