import { ColorType, CrosshairMode, type DeepPartial, type IChartApi, type LogicalRange, type ChartOptions } from 'lightweight-charts';

export const THEME = {
  text: '#8B98A5',
  grid: 'rgba(31, 41, 51, 0.55)',
  border: '#1F2933',
  up: '#2BD48A',
  down: '#F2555A',
  accent: '#C3F53C',
  muted: '#5C6873',
  benchmark: '#8B98A5',
};

export function chartOptions(intraday: boolean): DeepPartial<ChartOptions> {
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: THEME.text,
      fontFamily: "'Inter Variable', Inter, system-ui, sans-serif",
      fontSize: 11,
      attributionLogo: true,
      panes: { separatorColor: THEME.border, separatorHoverColor: '#2A3642', enableResize: true },
    },
    grid: { vertLines: { color: THEME.grid }, horzLines: { color: THEME.grid } },
    rightPriceScale: { borderColor: THEME.border },
    timeScale: { borderColor: THEME.border, timeVisible: intraday, secondsVisible: false, rightOffset: 4, minBarSpacing: 0.05 },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: '#5C6873', labelBackgroundColor: '#1F2933' },
      horzLine: { color: '#5C6873', labelBackgroundColor: '#1F2933' },
    },
  };
}

/** Price labels that suit the market: "96,000" for Bitcoin, "152.40" for Solana, "0.18342" for Dogecoin. */
export function priceFormat(sample: number) {
  const digits = sample >= 1000 ? 0 : sample >= 1 ? 2 : 5;
  const fmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return { type: 'custom' as const, minMove: 10 ** -Math.max(digits, 2), formatter: (p: number) => fmt.format(p) };
}

/** Fits all bars once the chart has its size (autoSize measures it a frame or two after mounting). */
export function fitWhenSized(chart: IChartApi): () => void {
  let second = 0;
  const first = requestAnimationFrame(() => {
    second = requestAnimationFrame(() => chart.timeScale().fitContent());
  });
  return () => {
    cancelAnimationFrame(first);
    cancelAnimationFrame(second);
  };
}

/** Keeps charts that show the same bars scrolled and zoomed together. */
export function createSync() {
  const charts = new Set<IChartApi>();
  let busy = false;
  const follow = (source: IChartApi) => (range: LogicalRange | null) => {
    if (busy || !range) return;
    busy = true;
    for (const c of charts) if (c !== source) c.timeScale().setVisibleLogicalRange(range);
    busy = false;
  };
  return {
    add(chart: IChartApi) {
      charts.add(chart);
      const handler = follow(chart);
      chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
      return () => {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
        charts.delete(chart);
      };
    },
  };
}

export type Sync = ReturnType<typeof createSync>;
