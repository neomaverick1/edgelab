import { X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { subscribeToasts } from './toast';

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="toggle" onClick={() => onChange(!on)} />;
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: ReactNode; disabled?: boolean; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={o.id === value} disabled={o.disabled} title={o.title} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A number box that only commits valid numbers, so typing "1." or "-" doesn't fight the user. */
export function NumberInput({ value, onChange, min, max, step = 1, width, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; width?: number; label: string }) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : String(value);
  const commit = (raw: string) => {
    const v = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(v)) return;
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    if (clamped !== value) onChange(clamped);
  };
  return (
    <input
      className="input num"
      inputMode="decimal"
      aria-label={label}
      style={width ? { width } : undefined}
      value={shown}
      step={step}
      onFocus={() => {
        setText(String(value));
        setFocused(true);
      }}
      onChange={(e) => {
        setText(e.target.value);
        commit(e.target.value);
      }}
      onBlur={() => {
        setFocused(false);
        commit(text);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const next = +(value + (e.key === 'ArrowUp' ? step : -step)).toFixed(6);
          const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next));
          onChange(clamped);
          setText(String(clamped));
        }
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function Modal({ title, onClose, children, wide, head }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; head?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    box.current?.querySelector<HTMLElement>('input, button:not(.icon-btn)')?.focus();
    return () => {
      window.removeEventListener('keydown', key);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={box}>
        {head ?? (
          <div className="modal-head">
            <h2>{title}</h2>
            <button className="icon-btn end" aria-label="Close" onClick={onClose}>
              <X />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => subscribeToasts(setMsg), []);
  return msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null;
}

export function Panel({ title, sub, actions, children, className, bodyClass }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`panel ${className ?? ''}`}>
      {title || actions ? (
        <div className="panel-head">
          {title ? <h2>{title}</h2> : null}
          {sub ? <span className="sub">{sub}</span> : null}
          {actions ? <div className="end">{actions}</div> : null}
        </div>
      ) : null}
      <div className={bodyClass ?? 'panel-body'}>{children}</div>
    </section>
  );
}

