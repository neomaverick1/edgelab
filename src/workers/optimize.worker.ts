/// <reference lib="webworker" />
import { optimize, type OptimizeRequest } from '../lib/optimizer';

// Runs the parameter grid off the main thread so the page stays responsive.
self.onmessage = (e: MessageEvent<{ id: number; req: OptimizeRequest }>) => {
  try {
    self.postMessage({ id: e.data.id, grid: optimize(e.data.req) });
  } catch (err) {
    self.postMessage({ id: e.data.id, error: err instanceof Error ? err.message : String(err) });
  }
};
