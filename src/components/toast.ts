// A tiny app-wide notice ("Saved", "Copied"), shown by <Toaster />.
let timer: ReturnType<typeof setTimeout> | undefined;
let listener: ((s: string | null) => void) | null = null;

export function toast(message: string) {
  listener?.(message);
  clearTimeout(timer);
  timer = setTimeout(() => listener?.(null), 2600);
}

export function subscribeToasts(fn: (s: string | null) => void) {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export const KIND_LETTER: Record<string, string> = { crypto: '₿', stock: 'S', etf: 'E', index: 'I', forex: '¤', future: 'F', custom: '↑' };
