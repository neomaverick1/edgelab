// Live prices for paper trading: Binance and Coinbase over WebSockets, Yahoo Finance by polling in the app.
import type { Candle } from '../types';
import { getJson, isNative, seconds, tidy, type Timeframe } from './core';
import type { Asset } from './sources';

export type LiveStatus = 'connecting' | 'live' | 'polling' | 'offline';

export interface LiveHandlers {
  onClosed: (bars: Candle[]) => void; // finished bars (authoritative), oldest first
  onForming: (bar: Candle) => void; // the bar still in progress
  onStatus: (s: LiveStatus, detail?: string) => void;
}

export interface LiveFeed {
  stop: () => void;
}

export const liveSupported = (a: Asset) => a.source === 'binance' || a.source === 'coinbase' || (a.source === 'yahoo' && isNative());

export function startLive(asset: Asset, tf: Timeframe, h: LiveHandlers): LiveFeed {
  if (asset.source === 'binance') return binanceLive(asset.symbol, tf, h);
  if (asset.source === 'coinbase') return coinbaseLive(asset.symbol, tf, h);
  if (asset.source === 'yahoo' && isNative()) return yahooLive(asset.symbol, tf, h);
  h.onStatus('offline', 'Live data for this market needs the Android app.');
  return { stop() {} };
}

function binanceLive(symbol: string, tf: Timeframe, h: LiveHandlers): LiveFeed {
  let ws: WebSocket | null = null;
  let stopped = false;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const open = () => {
    h.onStatus('connecting');
    ws = new WebSocket(`wss://data-stream.binance.vision/ws/${symbol.toLowerCase()}@kline_${tf}`);
    ws.onopen = () => {
      retry = 0;
      h.onStatus('live');
    };
    ws.onmessage = (ev) => {
      const k = JSON.parse(ev.data as string).k as { t: number; o: string; h: string; l: string; c: string; v: string; x: boolean };
      if (!k) return;
      const bar = { time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v };
      if (k.x) h.onClosed([bar]);
      else h.onForming(bar);
    };
    ws.onclose = () => {
      if (stopped) return;
      h.onStatus('connecting', 'Reconnecting…');
      timer = setTimeout(open, Math.min(30_000, 1000 * 2 ** retry++));
    };
    ws.onerror = () => ws?.close();
  };
  open();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    },
  };
}

const CB = 'https://api.exchange.coinbase.com';
const CB_G = new Set([60, 300, 900, 3600, 21600, 86400]);

async function coinbaseRecent(symbol: string, g: number, after: number): Promise<Candle[]> {
  const base = CB_G.has(g) ? g : g >= 86400 ? 86400 : 3600;
  const rows = await getJson<[number, number, number, number, number, number][]>(`${CB}/products/${symbol}/candles?granularity=${base}`);
  let bars = tidy(rows.map(([t, low, high, open, close, volume]) => ({ time: t, open, high, low, close, volume })));
  if (base !== g) {
    const out = new Map<number, Candle>();
    const offset = g === 604_800 ? 4 * 86400 : 0;
    for (const c of bars) {
      const b = Math.floor((c.time - offset) / g) * g + offset;
      const cur = out.get(b);
      if (!cur) out.set(b, { ...c, time: b });
      else {
        cur.high = Math.max(cur.high, c.high);
        cur.low = Math.min(cur.low, c.low);
        cur.close = c.close;
        cur.volume += c.volume;
      }
    }
    bars = [...out.values()];
  }
  const now = Date.now() / 1000;
  return bars.filter((c) => c.time > after && c.time + g <= now);
}

function coinbaseLive(symbol: string, tf: Timeframe, h: LiveHandlers): LiveFeed {
  const g = seconds(tf);
  let ws: WebSocket | null = null;
  let stopped = false;
  let retry = 0;
  let forming: Candle | null = null;
  let lastClosed = 0;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let poll: ReturnType<typeof setInterval> | undefined;

  // Closed bars come from Coinbase's own candles a few seconds after the bucket ends, so they match the backtest.
  const settle = (attempt = 0) => {
    timers.push(
      setTimeout(async () => {
        try {
          const bars = await coinbaseRecent(symbol, g, lastClosed);
          if (bars.length) {
            lastClosed = bars[bars.length - 1].time;
            h.onClosed(bars);
          } else if (attempt < 4) settle(attempt + 1);
        } catch {
          if (attempt < 4) settle(attempt + 1);
        }
      }, 4000 * (attempt + 1)),
    );
  };

  const tick = (price: number, size: number, t: number) => {
    const bucket = Math.floor((t - (g === 604_800 ? 4 * 86400 : 0)) / g) * g + (g === 604_800 ? 4 * 86400 : 0);
    if (!forming || forming.time !== bucket) {
      if (forming && bucket > forming.time) settle();
      forming = { time: bucket, open: price, high: price, low: price, close: price, volume: 0 };
    }
    forming.high = Math.max(forming.high, price);
    forming.low = Math.min(forming.low, price);
    forming.close = price;
    forming.volume += size;
    h.onForming({ ...forming });
  };

  const open = () => {
    h.onStatus('connecting');
    ws = new WebSocket('wss://ws-feed.exchange.coinbase.com');
    ws.onopen = () => {
      retry = 0;
      ws!.send(JSON.stringify({ type: 'subscribe', product_ids: [symbol], channels: ['ticker'] }));
      h.onStatus('live');
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data as string) as { type: string; price?: string; last_size?: string; time?: string };
      if (m.type === 'ticker' && m.price) tick(+m.price, +(m.last_size ?? 0), m.time ? Date.parse(m.time) / 1000 : Date.now() / 1000);
    };
    ws.onclose = () => {
      if (stopped) return;
      h.onStatus('polling', 'Live feed dropped; checking every 10 seconds.');
      startPolling();
      timers.push(setTimeout(open, Math.min(60_000, 2000 * 2 ** retry++)));
    };
    ws.onerror = () => ws?.close();
  };
  const startPolling = () => {
    if (poll) return;
    poll = setInterval(async () => {
      try {
        const t = await getJson<{ price: string; time: string }>(`${CB}/products/${symbol}/ticker`);
        tick(+t.price, 0, Date.parse(t.time) / 1000);
      } catch {
        h.onStatus('offline', 'Can’t reach Coinbase right now.');
      }
    }, 10_000);
  };
  // Start the "last closed" marker at the current bucket so only newer bars are reported.
  lastClosed = Math.floor(Date.now() / 1000 / g) * g - g;
  open();
  return {
    stop() {
      stopped = true;
      timers.forEach(clearTimeout);
      timers = [];
      clearInterval(poll);
      ws?.close();
    },
  };
}

function yahooLive(symbol: string, tf: Timeframe, h: LiveHandlers): LiveFeed {
  const g = seconds(tf);
  const interval = { '5m': '5m', '15m': '15m', '1h': '60m', '4h': '60m', '1d': '1d', '1w': '1wk' }[tf];
  let lastClosed = Math.floor(Date.now() / 1000 / g) * g - g;
  let stopped = false;
  const run = async () => {
    try {
      type Y = { chart: { result: { timestamp: number[]; indicators: { quote: { open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] }[] } }[] } };
      const body = await getJson<Y>(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=5d`);
      const r = body.chart.result[0];
      const q = r.indicators.quote[0];
      let bars = tidy(r.timestamp.map((t, i) => ({ time: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] ?? 0 })));
      if (tf === '4h') {
        const m = new Map<number, Candle>();
        for (const c of bars) {
          const b = Math.floor(c.time / 14_400) * 14_400;
          const cur = m.get(b);
          if (!cur) m.set(b, { ...c, time: b });
          else Object.assign(cur, { high: Math.max(cur.high, c.high), low: Math.min(cur.low, c.low), close: c.close, volume: cur.volume + c.volume });
        }
        bars = [...m.values()];
      }
      const now = Date.now() / 1000;
      const span = Math.min(g, 86_400);
      const closed = bars.filter((c) => c.time > lastClosed && c.time + span <= now);
      if (closed.length) {
        lastClosed = closed[closed.length - 1].time;
        h.onClosed(closed);
      }
      const last = bars[bars.length - 1];
      if (last && last.time + span > now) h.onForming(last);
      h.onStatus('polling', 'Updates every 15 seconds');
    } catch {
      h.onStatus('offline', 'Can’t reach Yahoo Finance right now.');
    }
    if (!stopped) timer = setTimeout(run, 15_000);
  };
  let timer = setTimeout(run, 0);
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
