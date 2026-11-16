import { useCallback, useEffect, useRef, useState } from 'react';

import type { LabRequest } from '../workers/lab.worker';

type Req = LabRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

/** Runs robustness jobs in a worker. Starting a new job cancels the one before it. */
export function useLab() {
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const [progress, setProgress] = useState<number | null>(null);

  const reset = () => {
    worker.current?.terminate();
    worker.current = new Worker(new URL('../workers/lab.worker.ts', import.meta.url), { type: 'module' });
  };
  useEffect(() => {
    reset();
    return () => worker.current?.terminate();
  }, []);

  const run = useCallback(<T,>(req: Req): Promise<T> => {
    if (progress !== null) reset();
    const id = ++seq.current;
    setProgress(0);
    return new Promise<T>((resolve, reject) => {
      const w = worker.current!;
      const onMsg = (ev: MessageEvent<{ id: number; progress?: number; result?: T; error?: string }>) => {
        if (ev.data.id !== id) return;
        if (ev.data.progress !== undefined) {
          setProgress(ev.data.progress);
          return;
        }
        w.removeEventListener('message', onMsg);
        setProgress(null);
        if (ev.data.error) reject(new Error(ev.data.error));
        else resolve(ev.data.result as T);
      };
      w.addEventListener('message', onMsg);
      w.postMessage({ ...req, id });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  return { run, progress, busy: progress !== null };
}
