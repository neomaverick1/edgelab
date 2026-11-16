// The session (market, timeframe, dates, strategy), shareable links and the strategy library on this device.
import { strFromU8, strToU8, unzlibSync, zlibSync } from 'fflate';

import type { Timeframe } from './data/core';
import type { Asset } from './data/sources';
import { STATIC_CRYPTO } from './data/search';
import { presetById } from './presets';
import type { Strategy } from './rules';

export interface Session {
  asset: Asset;
  tf: Timeframe;
  from: string; // YYYY-MM-DD, '' = all
  to: string; // YYYY-MM-DD, '' = latest
  strategy: Strategy;
}

export const DEFAULT_SESSION: Session = {
  asset: STATIC_CRYPTO[0],
  tf: '1d',
  from: '2020-01-01',
  to: '',
  strategy: structuredClone(presetById('ema-atr-trail')!.strategy),
};

const b64url = {
  encode(bytes: Uint8Array) {
    let s = '';
    bytes.forEach((b) => (s += String.fromCharCode(b)));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(text: string) {
    const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  },
};

export function encodeSession(s: Session): string {
  const asset = s.asset.source === 'csv' ? DEFAULT_SESSION.asset : s.asset;
  return b64url.encode(zlibSync(strToU8(JSON.stringify({ ...s, asset })), { level: 9 }));
}

export function decodeSession(text: string): Session | null {
  try {
    const raw = JSON.parse(strFromU8(unzlibSync(b64url.decode(text)))) as Session;
    if (raw?.strategy?.v !== 2 || !raw.asset?.id) return null;
    return raw;
  } catch {
    return null;
  }
}

// ---- local storage (may be unavailable: private windows, blocked storage)

const KEY_LAST = 'edgelab.session.v2';
const KEY_LIB = 'edgelab.library.v2';
const KEY_PAPER = 'edgelab.paper.v2';

const read = <T>(key: string): T | null => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: nothing else to do
  }
};

export const loadLastSession = () => read<Session>(KEY_LAST);
export const saveLastSession = (s: Session) => write(KEY_LAST, { ...s, asset: s.asset.source === 'csv' ? DEFAULT_SESSION.asset : s.asset });

export interface Saved {
  id: string;
  savedAt: number;
  strategy: Strategy;
}
export const loadLibrary = (): Saved[] => read<Saved[]>(KEY_LIB) ?? [];
export function saveToLibrary(strategy: Strategy): Saved[] {
  const lib = loadLibrary().filter((x) => x.strategy.name !== strategy.name);
  const next = [{ id: crypto.randomUUID?.() ?? String(Date.now()), savedAt: Date.now(), strategy: structuredClone(strategy) }, ...lib].slice(0, 60);
  write(KEY_LIB, next);
  return next;
}
export function removeFromLibrary(id: string): Saved[] {
  const next = loadLibrary().filter((x) => x.id !== id);
  write(KEY_LIB, next);
  return next;
}

export interface PaperSession {
  id: string;
  asset: Asset;
  tf: Timeframe;
  strategy: Strategy;
  startedAt: number; // unix seconds; trades before this are ignored
  capital: number;
}
export const loadPaper = () => read<PaperSession[]>(KEY_PAPER) ?? [];
export const savePaper = (list: PaperSession[]) => write(KEY_PAPER, list);
