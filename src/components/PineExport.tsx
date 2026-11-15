import { useState, type ReactNode } from 'react';

import { Icon } from './ui';

const KEYWORDS = new Set(['if', 'else', 'var', 'and', 'or', 'not', 'true', 'false', 'na']);

/** Just enough highlighting to read the script: comments, strings, numbers and keywords. */
function highlight(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  const comment = line.indexOf('//');
  const code = comment >= 0 ? line.slice(0, comment) : line;
  const re = /("[^"]*")|(\b\d+(?:\.\d+)?\b)|(\b[a-z_]+\b)/g;
  let last = 0;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    if (m.index > last) out.push(code.slice(last, m.index));
    if (m[1])
      out.push(
        <span key={m.index} className="s">
          {m[1]}
        </span>,
      );
    else if (m[2])
      out.push(
        <span key={m.index} className="n">
          {m[2]}
        </span>,
      );
    else if (KEYWORDS.has(m[3]))
      out.push(
        <span key={m.index} className="k">
          {m[3]}
        </span>,
      );
    else out.push(m[3]);
    last = m.index + m[0].length;
  }
  out.push(code.slice(last));
  if (comment >= 0)
    out.push(
      <span key="c" className="c">
        {line.slice(comment)}
      </span>,
    );
  return out;
}

export function PineExport({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked: the code can still be selected by hand.
    }
  };
  return (
    <>
      <div className="toolbar">
        <span className="muted">
          The current strategy, settings and costs as a TradingView strategy. Paste it into the Pine Editor and add it to a chart.
        </span>
        <span className="spacer" />
        <button type="button" className="btn primary" onClick={copy}>
          <Icon name="copy" /> {copied ? 'Copied' : 'Copy Pine Script'}
        </button>
      </div>
      <pre className="code" aria-label="Pine Script">
        {code.split('\n').map((line, i) => (
          <div key={i}>{line ? highlight(line) : ' '}</div>
        ))}
      </pre>
    </>
  );
}
