// The built-in AI: a small language model that runs on the device (WebGPU when the phone or browser has it,
// otherwise the CPU). It rewrites a condition the rule reader couldn't understand into words the reader knows.
import { env, pipeline, type TextGenerationPipeline } from '@huggingface/transformers';

// The larger model when the device has a GPU for it; a smaller one that still runs at a usable speed on the CPU.
export const AI_MODEL_GPU = 'onnx-community/Qwen2.5-1.5B-Instruct';
export const AI_MODEL_CPU = 'onnx-community/Qwen2.5-0.5B-Instruct';

export type AiRequest = { type: 'load' } | { type: 'rewrite'; id: number; text: string };
export type AiReply =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; device: string }
  | { type: 'rewrite'; id: number; text: string }
  | { type: 'error'; id?: number; message: string };

const SYSTEM = `Rewrite one trading condition into the strict form "<value> <comparison> <value>". Output only the rewritten condition, nothing else.
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
];

env.allowLocalModels = false;
let gen: Promise<TextGenerationPipeline> | null = null;
let device = 'wasm';

const post = (m: AiReply) => self.postMessage(m);

async function load() {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  const hasGpu = !!gpu && !!(await gpu.requestAdapter().catch(() => null));
  device = hasGpu ? 'webgpu' : 'wasm';
  const files = new Map<string, { loaded: number; total: number }>();
  const make = pipeline as unknown as (task: string, model: string, opts: Record<string, unknown>) => Promise<TextGenerationPipeline>;
  return await make('text-generation', hasGpu ? AI_MODEL_GPU : AI_MODEL_CPU, {
    device,
    dtype: hasGpu ? 'q4f16' : 'q4',
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
}

self.onmessage = async (e: MessageEvent<AiRequest>) => {
  const req = e.data;
  try {
    gen ??= load();
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
