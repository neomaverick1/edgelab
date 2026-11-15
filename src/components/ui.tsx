import { useState, type CSSProperties, type ReactNode } from 'react';

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  small,
  label,
}: {
  value: T;
  options: { id: T; label: string; title?: string }[];
  onChange: (v: T) => void;
  small?: boolean;
  label: string;
}) {
  return (
    <div className={`segmented${small ? ' small' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={o.id === value} title={o.title} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A number box that only commits valid numbers, so typing "1." or clearing the box doesn't break the backtest. */
export function NumberBox({
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  label: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    const v = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
    setDraft(null);
  };
  return (
    <span className="num-input">
      <input
        type="number"
        inputMode="decimal"
        aria-label={label}
        value={draft ?? String(value)}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          setDraft(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(v) && v >= min && v <= max) onChange(v);
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
        }}
      />
      {suffix ? <span>{suffix}</span> : null}
    </span>
  );
}

export function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  const fill = `${((value - min) / (max - min)) * 100}%`;
  return (
    <div className="field">
      <div className="field-head">
        <label>{label}</label>
        <NumberBox value={value} onChange={onChange} min={min} max={max} step={step} suffix={suffix} label={label} />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={`${label} slider`}
        style={{ '--fill': fill } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-head">
        <label>{label}</label>
        {hint ? <span className="hint">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

const paths = {
  link: 'M10 14a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1 1M14 10a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1-1',
  refresh: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  download: 'M12 4v11m0 0-4-4m4 4 4-4M5 19h14',
  chevron: 'm6 9 6 6 6-6',
  play: 'M7 5v14l11-7z',
};

export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
