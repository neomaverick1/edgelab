import { FileUp, Search, Smartphone } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { isNative } from '../lib/data/core';
import { parseCsv } from '../lib/data/csv';
import { assetTitle, searchAssets } from '../lib/data/search';
import { registerCsv, SOURCE_LABEL, type Asset, type AssetKind } from '../lib/data/sources';
import { KIND_LETTER } from './toast';
import { Modal } from './ui';

const KINDS: { id: AssetKind | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'stock', label: 'Stocks' },
  { id: 'etf', label: 'ETFs' },
  { id: 'forex', label: 'Forex' },
  { id: 'future', label: 'Futures' },
  { id: 'index', label: 'Indexes' },
];

export function AssetIcon({ a }: { a: Asset }) {
  return (
    <span className="kind-dot" data-kind={a.kind} aria-hidden>
      {KIND_LETTER[a.kind]}
    </span>
  );
}

export function AssetPicker({ onPick, onClose, custom, onCustom }: { onPick: (a: Asset) => void; onClose: () => void; custom: Asset[]; onCustom: (a: Asset) => void }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<AssetKind | 'all'>('all');
  const [found, setFound] = useState<{ q: string; hits: Asset[] } | null>(null);
  const hits = useMemo(() => found?.hits ?? [], [found]);
  const busy = found?.q !== q;
  const [sel, setSel] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    const t = setTimeout(
      () =>
        searchAssets(q, custom).then((r) => {
          if (!live) return;
          setFound({ q, hits: r });
          setSel(0);
        }),
      q ? 140 : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, custom]);

  const shown = useMemo(() => (kind === 'all' ? hits : hits.filter((h) => h.kind === kind)), [hits, kind]);

  const upload = async (f: File) => {
    setErr(null);
    try {
      const r = parseCsv(await f.text());
      const a = registerCsv(f.name, r.candles, r.granularity);
      onCustom(a);
      onPick(a);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal
      title="Choose a market"
      onClose={onClose}
      head={
        <div className="search">
          <Search />
          <input
            autoFocus
            placeholder={isNative() ? 'Any ticker: AAPL, BTC, EURUSD, gold, Tesla…' : 'Search: BTC, AAPL, SPY, gold, EUR/USD…'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search markets"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((s) => Math.min(shown.length - 1, s + 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              }
              if (e.key === 'Enter' && shown[sel]) onPick(shown[sel]);
            }}
          />
          {busy ? <div className="spinner" /> : null}
        </div>
      }
    >
      <div className="filters">
        {KINDS.map((k) => (
          <button key={k.id} className={`chip${kind === k.id ? ' gold' : ''}`} style={{ border: 0 }} onClick={() => setKind(k.id)}>
            {k.label}
          </button>
        ))}
        <button className="chip" style={{ border: 0, marginLeft: 'auto' }} onClick={() => file.current?.click()}>
          <FileUp /> Upload CSV
        </button>
        <input ref={file} type="file" accept=".csv,.txt,text/csv" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </div>
      {err ? (
        <div className="note bad" style={{ margin: '10px 14px 0' }}>
          {err}
        </div>
      ) : null}
      <div className="results" role="listbox" aria-label="Markets">
        {!q ? <div className="muted" style={{ padding: '6px 10px', fontSize: 12.5, fontWeight: 650 }}>Popular</div> : null}
        {shown.map((a, i) => (
          <button key={a.id} className="result" role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => onPick(a)}>
            <AssetIcon a={a} />
            <span className="sym">{a.display}</span>
            <span className="name">{assetTitle(a)}</span>
            <span className="src">{SOURCE_LABEL[a.source]}</span>
          </button>
        ))}
        {!busy && !shown.length ? (
          <div className="empty">
            <h3>No match for “{q}”</h3>
            <p>{isNative() ? 'Check the ticker spelling, or upload a CSV.' : 'The web version covers every Coinbase and Binance pair plus 200 popular stocks, ETFs, forex pairs and futures. The Android app finds any ticker, or you can upload a CSV.'}</p>
          </div>
        ) : null}
      </div>
      {!isNative() ? (
        <div className="note" style={{ margin: '0 14px 14px' }}>
          <Smartphone />
          <span>
            Crypto is live from the exchanges. Stocks, forex and futures on the web come from a daily snapshot; the Android app pulls any ticker live on every timeframe. CSV files: date, open, high, low, close, volume{custom.length ? ` · ${custom.length} loaded (${custom.map((c) => c.display).join(', ')})` : ''}.
          </span>
        </div>
      ) : null}
    </Modal>
  );
}
