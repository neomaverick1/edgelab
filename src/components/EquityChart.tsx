import {
  AreaSeries,
  BaselineSeries,
  createChart,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef } from 'react';

import { chartOptions, fitWhenSized, THEME, type Sync } from './charts';

interface Props {
  times: number[];
  equity: number[];
  benchmark: number[];
  drawdown: number[]; // fractions, 0 or below
  intraday: boolean;
  sync: Sync;
  fitKey: string;
}

const compactMoney = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e4 ? `${(a / 1e3).toFixed(1)}k` : a.toFixed(0);
  return `${v < 0 ? '−' : ''}$${s}`;
};

/** Account value against buy & hold, with the drawdown underneath. */
export function EquityChart({ times, equity, benchmark, drawdown, intraday, sync, fitKey }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const api = useRef<{ chart: IChartApi; equity: ISeriesApi<'Area'>; bench: ISeriesApi<'Line'>; dd: ISeriesApi<'Baseline'> } | null>(null);

  useEffect(() => {
    const chart = createChart(box.current!, chartOptions(false));
    const money = { type: 'custom' as const, formatter: compactMoney, minMove: 1 };
    const bench = chart.addSeries(LineSeries, {
      color: THEME.benchmark,
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
      priceFormat: money,
      title: 'Buy & hold',
    });
    const eq = chart.addSeries(AreaSeries, {
      lineColor: THEME.accent,
      topColor: 'rgba(195, 245, 60, 0.20)',
      bottomColor: 'rgba(195, 245, 60, 0.0)',
      lineWidth: 2,
      priceLineVisible: false,
      priceFormat: money,
      title: 'Strategy',
    });
    const dd = chart.addSeries(
      BaselineSeries,
      {
        baseValue: { type: 'price', price: 0 },
        topLineColor: 'rgba(0,0,0,0)',
        topFillColor1: 'rgba(0,0,0,0)',
        topFillColor2: 'rgba(0,0,0,0)',
        bottomLineColor: THEME.down,
        bottomFillColor1: 'rgba(242, 85, 90, 0.05)',
        bottomFillColor2: 'rgba(242, 85, 90, 0.35)',
        lineWidth: 1,
        priceLineVisible: false,
        priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(1)}%`, minMove: 0.1 },
        title: 'Drawdown',
      },
      1,
    );
    chart.panes()[0]?.setStretchFactor(2.4);
    chart.panes()[1]?.setStretchFactor(1);
    api.current = { chart, equity: eq, bench, dd };
    const unsync = sync.add(chart);
    return () => {
      unsync();
      chart.remove();
      api.current = null;
    };
  }, [sync]);

  useEffect(() => {
    api.current?.chart.applyOptions({ timeScale: { timeVisible: intraday } });
  }, [intraday]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const t = (i: number) => times[i] as UTCTimestamp;
    a.equity.setData(equity.map((value, i) => ({ time: t(i), value })));
    a.bench.setData(benchmark.map((value, i) => ({ time: t(i), value })));
    a.dd.setData(drawdown.map((value, i) => ({ time: t(i), value: value * 100 })));
  }, [times, equity, benchmark, drawdown]);

  useEffect(() => {
    const chart = api.current?.chart;
    return chart ? fitWhenSized(chart) : undefined;
  }, [fitKey]);

  return <div ref={box} className="chart equity" />;
}
