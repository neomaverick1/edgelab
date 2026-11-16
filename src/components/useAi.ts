import { useCallback, useEffect, useRef, useState } from 'react';

import { Capacitor } from '@capacitor/core';

import type { AiReply, AiRequest } from '../workers/ai.worker';

/** The phone apps carry the AI model inside the app; the website downloads it once. */
export const aiBuiltIn = () => Capacitor.isNativePlatform();

export type AiState = 'off' | 'loading' | 'ready' | 'error';

let worker: Worker | null = null;
let state: AiState = 'off';
let progress = 0;
let device = '';
let error = '';
let seq = 0;
const waiting = new Map<number, (text: string | null) => void>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/ai.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<AiReply>) => {
    const m = e.data;
    if (m.type === 'progress') progress = m.total ? m.loaded / m.total : 0;
    else if (m.type === 'ready') {
      state = 'ready';
      device = m.device;
      try {
        localStorage.setItem('edgelab-ai', '1');
      } catch {
        /* storage off */
      }
    } else if (m.type === 'rewrite') {
      waiting.get(m.id)?.(m.text);
      waiting.delete(m.id);
    } else if (m.type === 'error') {
      if (m.id !== undefined) {
        waiting.get(m.id)?.(null);
        waiting.delete(m.id);
      } else {
        state = 'error';
        error = m.message;
      }
    }
    emit();
  };
  return worker;
}

/** Download size shown before the first download: the GPU model is bigger. */
export const aiDownloadSize = () => ((navigator as Navigator & { gpu?: unknown }).gpu ? 'about 1.2 GB' : 'about 500 MB');

/** True once the model has been downloaded on this device before (it's kept in the browser cache). */
export function aiDownloaded() {
  if (aiBuiltIn()) return true;
  try {
    return localStorage.getItem('edgelab-ai') === '1';
  } catch {
    return false;
  }
}

/** The built-in AI, shared by every component. It downloads once and then runs offline. */
export function useAi() {
  const [, force] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    const l = () => mounted.current && force((n) => n + 1);
    listeners.add(l);
    return () => {
      mounted.current = false;
      listeners.delete(l);
    };
  }, []);
  const start = useCallback(() => {
    if (state === 'loading' || state === 'ready') return;
    state = 'loading';
    progress = 0;
    error = '';
    emit();
    getWorker().postMessage({ type: 'load', builtIn: aiBuiltIn() } satisfies AiRequest);
  }, []);
  const rewrite = useCallback(
    (text: string) =>
      new Promise<string | null>((resolve) => {
        const id = ++seq;
        waiting.set(id, resolve);
        getWorker().postMessage({ type: 'rewrite', id, text } satisfies AiRequest);
      }),
    [],
  );
  return { state, progress, device, error, start, rewrite };
}
