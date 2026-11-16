import { ColorType, CrosshairMode, type ChartOptions, type DeepPartial, type IChartApi, type LogicalRange } from 'lightweight-charts';

export const THEME = {
  text: '#7c8292',
  grid: 'rgba(228, 231, 238, 0.7)',
  border: '#e4e7ee',
  up: '#0f9a6b',
  down: '#d2405a',
  gold: '#b4862b',
  goldGlow: 'rgba(217, 178, 90, 0.32)',
  ink: '#171a21',
  muted: '#9aa0ad',
};

/** Colours for indicator lines and compared runs. Gold is kept for the strategy's own equity. */
export const SERIES = ['#2f2a6b', '#0e8aa8', '#c0533a', '#7a4fc9', '#0f9a6b', '#c27c0e', '#d2405a', '#4a5568', '#1c7c54', '#a3389b'];

export function chartOptions(intraday: boolean): DeepPartial<ChartOptions> {
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: THEME.text,
      fontFamily: "'Manrope Variable', Manrope, system-ui, sans-serif",
      fontSize: 11,
      attributionLogo: true,
      panes: { separatorColor: THEME.border, separatorHoverColor: '#d9b25a', enableResize: true },
    },
    grid: { vertLines: { color: THEME.grid }, horzLines: { color: THEME.grid } },
    rightPriceScale: { borderColor: THEME.border },
    timeScale: { borderColor: THEME.border, timeVisible: intraday, secondsVisible: false, rightOffset: 4, minBarSpacing: 0.05 },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: '#b9bdc8', labelBackgroundColor: THEME.ink },
      horzLine: { color: '#b9bdc8', labelBackgroundColor: THEME.ink },
    },
    handleScale: { axisPressedMouseMove: { time: true, price: true } },
  };
}

/** Price labels that suit the market: "96,000" for Bitcoin, "152.40" for a stock, "1.08342" for EUR/USD. */
export function priceFormat(sample: number) {
  const digits = sample >= 1000 ? 0 : sample >= 20 ? 2 : sample >= 1 ? 4 : 6;
  const fmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return { type: 'custom' as const, minMove: 10 ** -Math.max(digits, 2), formatter: (p: number) => fmt.format(p) };
}

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
  return {
    add(chart: IChartApi) {
      charts.add(chart);
      const handler = (range: LogicalRange | null) => {
        if (busy || !range) return;
        busy = true;
        for (const c of charts) if (c !== chart) c.timeScale().setVisibleLogicalRange(range);
        busy = false;
      };
      chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
      return () => {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
        charts.delete(chart);
      };
    },
  };
}
export type Sync = ReturnType<typeof createSync>;
