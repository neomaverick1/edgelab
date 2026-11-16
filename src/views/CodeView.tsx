import { Copy, Download, Link2, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import { Panel, Seg } from '../components/ui';
import { isNative } from '../lib/data/core';
import { toast } from '../components/toast';
import { describe } from '../lib/english';
import { toPine } from '../lib/pine';
import type { Strategy } from '../lib/rules';

const copy = async (text: string, what: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied`);
  } catch {
    toast('Copying is blocked here; select the text and copy it instead.');
  }
};

const download = (name: string, text: string, type = 'text/plain') => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

export function CodeView({ strategy, shareUrl, from, onImport }: { strategy: Strategy; shareUrl: string; from: string; onImport: (s: Strategy) => void }) {
  const [tab, setTab] = useState<'pine' | 'json'>('pine');
  const pine = useMemo(() => toPine(strategy, strategy.name, from), [strategy, from]);
  const json = useMemo(() => JSON.stringify(strategy, null, 2), [strategy]);
  const file = useRef<HTMLInputElement>(null);
  const slug = strategy.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'strategy';

  return (
    <div className="main-inner">
      <Panel title="In plain words">
        <p className="prose">{describe(strategy) || 'No rules yet.'}</p>
      </Panel>
      <Panel
        title="Take it with you"
        actions={
          <>
            <button className="btn" onClick={() => copy(shareUrl, 'Link')}>
              <Link2 /> Copy share link
            </button>
          </>
        }
      >
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <Seg
            label="Format"
            value={tab}
            onChange={setTab}
            options={[
              { id: 'pine', label: 'TradingView Pine Script' },
              { id: 'json', label: 'Edgelab file' },
            ]}
          />
          <span className="grow" />
          <button className="btn sm" onClick={() => copy(tab === 'pine' ? pine : json, tab === 'pine' ? 'Pine Script' : 'Strategy file')}>
            <Copy /> Copy
          </button>
          {!isNative() ? (
            <button className="btn sm" onClick={() => (tab === 'pine' ? download(`${slug}.pine`, pine) : download(`${slug}.edgelab.json`, json, 'application/json'))}>
              <Download /> Download
            </button>
          ) : null}
          {tab === 'json' ? (
            <>
              <button className="btn sm" onClick={() => file.current?.click()}>
                <Upload /> Open a file
              </button>
              <input
                ref={file}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    const s = JSON.parse(await f.text()) as Strategy;
                    if (s.v !== 2 || !s.longEntry) throw new Error();
                    onImport(s);
                    toast(`Opened “${s.name}”`);
                  } catch {
                    toast('That isn’t an Edgelab strategy file.');
                  }
                }}
              />
            </>
          ) : null}
        </div>
        {tab === 'pine' ? (
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
            Paste into TradingView’s Pine Editor and add it to a chart. Rules, stops, targets, sizing and costs carry over; fills follow TradingView’s broker emulator, so numbers can differ slightly.
          </p>
        ) : null}
        <pre className="code">{tab === 'pine' ? pine : json}</pre>
      </Panel>
    </div>
  );
}
