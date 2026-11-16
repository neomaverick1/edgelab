import {
  AreaSeries,
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';

import type { OpenPosition } from '../lib/engine';
import { pct } from '../lib/format';
import type { Plot } from '../lib/rules';
import type { Candle, Trade } from '../lib/types';
import { chartOptions, fitWhenSized, priceFormat, SERIES, THEME, type Sync } from './charts';

export interface PriceChartHandle {
  focus: (from: number, to: number) => void;
}

interface Props {
  candles: Candle[];
  plots: Plot[];
  trades: Trade[];
  open?: OpenPosition | null;
  forming?: Candle | null;
  intraday: boolean;
  log: boolean;
  sync?: Sync;
  fitKey: string;
  ref?: Ref<PriceChartHandle>;
}

const ts = (t: number) => t as UTCTimestamp;
const points = (candles: Candle[], values: number[]) => candles.map((c, i) => (Number.isFinite(values[i]) ? { time: ts(c.time), value: values[i] } : { time: ts(c.time) }));

function markers(trades: Trade[], labels: boolean): SeriesMarker<Time>[] {
  const out: SeriesMarker<Time>[] = [];
  for (const t of trades) {
    const long = t.side === 'long';
    out.push({ time: ts(t.entryTime), position: long ? 'belowBar' : 'aboveBar', shape: long ? 'arrowUp' : 'arrowDown', color: long ? THEME.up : THEME.down, text: labels ? (long ? 'Buy' : 'Short') : undefined });
    const fills = t.fills.length > 1 ? t.fills : [{ time: t.exitTime }];
    fills.forEach((f, k) =>
      out.push({
        time: ts(f.time),
        position: long ? 'aboveBar' : 'belowBar',
        shape: 'circle',
        color: t.pnl >= 0 ? THEME.gold : THEME.muted,
        text: labels && k === fills.length - 1 ? pct(t.pnlPct, { sign: true, digits: 1 }) : undefined,
      }),
    );
  }
  return out.sort((x, y) => (x.time as number) - (y.time as number));
}

interface Api {
  chart: IChartApi;
  candles: ISeriesApi<'Candlestick'>;
  volume: ISeriesApi<'Histogram'>;
  markers: ISeriesMarkersPluginApi<Time>;
  extra: ISeriesApi<SeriesType>[];
  lines: ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>[];
}

/** Candles with every indicator the rules use, trade markers, and oscillators in panes below. */
export function PriceChart({ candles, plots, trades, open, forming, intraday, log, sync, fitKey, ref }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);

  useEffect(() => {
    const chart = createChart(box.current!, chartOptions(intraday));
    const cs = chart.addSeries(CandlestickSeries, {
      upColor: THEME.up,
      downColor: THEME.down,
      borderVisible: false,
      wickUpColor: THEME.up,
      wickDownColor: THEME.down,
    });
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    api.current = { chart, candles: cs, volume, markers: createSeriesMarkers(cs, []), extra: [], lines: [] };
    const unsync = sync?.add(chart);
    return () => {
      unsync?.();
      chart.remove();
      api.current = null;
    };
  }, [sync, intraday]);

  useImperativeHandle(ref, () => ({
    focus(from, to) {
      const a = api.current;
      if (!a) return;
      const i = candles.findIndex((c) => c.time >= from);
      const j = candles.findIndex((c) => c.time >= to);
      const pad = Math.max(10, Math.round((j - i) * 0.6));
      a.chart.timeScale().setVisibleLogicalRange({ from: i - pad, to: (j < 0 ? candles.length : j) + pad });
    },
  }));

  useEffect(() => {
    const a = api.current;
    if (!a || !candles.length) return;
    a.candles.applyOptions({ priceFormat: priceFormat(candles[candles.length - 1].close) });
    a.candles.setData(candles.map((c) => ({ time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    a.volume.setData(candles.map((c) => ({ time: ts(c.time), value: c.volume, color: c.close >= c.open ? 'rgba(15,154,107,0.18)' : 'rgba(210,64,90,0.18)' })));
    for (const s of a.extra) a.chart.removeSeries(s);
    a.extra = [];
    // remove empty panes left behind
    while (a.chart.panes().length > 1) a.chart.removePane(a.chart.panes().length - 1);

    const panes = new Map<string, number>();
    let color = 0;
    for (const p of plots) {
      let pane = 0;
      if (p.place === 'pane') {
        if (!panes.has(p.pane)) panes.set(p.pane, panes.size + 1);
        pane = panes.get(p.pane)!;
      }
      const c = SERIES[color++ % SERIES.length];
      const s = a.chart.addSeries(LineSeries, { color: c, lineWidth: p.place === 'overlay' ? 2 : 1, priceLineVisible: false, lastValueVisible: p.place === 'pane', crosshairMarkerVisible: false, title: '' }, pane);
      s.setData(points(candles, p.values));
      if (pane > 0 && p.levels)
        for (const lv of p.levels) s.createPriceLine({ price: lv, color: '#c7cbd4', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: '' });
      a.extra.push(s);
    }
    a.chart.panes().forEach((p, i) => i > 0 && p.setHeight(110));
    a.markers.setMarkers(markers(trades, trades.length <= 40));
    return fitWhenSized(a.chart);
    // fitKey decides when to reset the view; data changes alone keep the zoom
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, plots, trades, fitKey]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    for (const l of a.lines) a.candles.removePriceLine(l);
    a.lines = [];
    if (open) {
      a.lines.push(a.candles.createPriceLine({ price: open.entryPrice, color: THEME.ink, lineStyle: LineStyle.Dotted, lineWidth: 1, title: open.side === 'long' ? 'Long' : 'Short', axisLabelVisible: true }));
      if (open.stop) a.lines.push(a.candles.createPriceLine({ price: open.stop, color: THEME.down, lineStyle: LineStyle.Dashed, lineWidth: 1, title: 'Stop', axisLabelVisible: true }));
      open.targets.forEach((t, i) => a.lines.push(a.candles.createPriceLine({ price: t, color: THEME.up, lineStyle: LineStyle.Dashed, lineWidth: 1, title: `Target ${i + 1}`, axisLabelVisible: true })));
    }
  }, [open]);

  useEffect(() => {
    const a = api.current;
    if (!a || !forming) return;
    a.candles.update({ time: ts(forming.time), open: forming.open, high: forming.high, low: forming.low, close: forming.close });
  }, [forming]);

  useEffect(() => {
    api.current?.chart.priceScale('right').applyOptions({ mode: log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
  }, [log]);

  return <div className="chart-box" ref={box} />;
}

export interface Line {
  id: string;
  label: string;
  color: string;
  points: { time: number; value: number }[];
  dashed?: boolean;
  area?: boolean;
  width?: number;
}

/** Plain lines over time (equity curves, comparisons, walk-forward). The first `area` line gets the gold glow. */
export function LinesChart({ lines, intraday, height = 300, log, percent, drawdown, sync, fitKey, className }: { lines: Line[]; intraday: boolean; height?: number; log?: boolean; percent?: boolean; drawdown?: { time: number; value: number }[]; sync?: Sync; fitKey?: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  useEffect(() => {
    const chart = createChart(box.current!, chartOptions(intraday));
    chartRef.current = chart;
    const unsync = sync?.add(chart);
    return () => {
      unsync?.();
      chart.remove();
      chartRef.current = null;
    };
  }, [intraday, sync]);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const created: ISeriesApi<SeriesType>[] = [];
    const fmt = percent ? { type: 'custom' as const, minMove: 0.0001, formatter: (v: number) => `${(v * 100).toFixed(1)}%` } : { type: 'custom' as const, minMove: 0.01, formatter: (v: number) => `$${Math.round(v).toLocaleString('en-US')}` };
    for (const l of lines) {
      const data = l.points.map((p) => ({ time: ts(p.time), value: p.value }));
      if (l.area) {
        const s = chart.addSeries(AreaSeries, { lineColor: l.color, lineWidth: 2, topColor: THEME.goldGlow, bottomColor: 'rgba(217, 178, 90, 0)', priceLineVisible: false, lastValueVisible: true, priceFormat: fmt, crosshairMarkerBorderColor: '#fff', crosshairMarkerBackgroundColor: l.color });
        s.setData(data);
        created.push(s);
      } else {
        const s = chart.addSeries(LineSeries, { color: l.color, lineWidth: (l.width ?? 2) as 1 | 2 | 3 | 4, lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid, priceLineVisible: false, lastValueVisible: !l.dashed, crosshairMarkerVisible: !l.dashed, priceFormat: fmt });
        s.setData(data);
        created.push(s);
      }
    }
    if (drawdown) {
      const s = chart.addSeries(AreaSeries, { lineColor: THEME.down, lineWidth: 1, topColor: 'rgba(210,64,90,0.04)', bottomColor: 'rgba(210,64,90,0.28)', invertFilledArea: false, priceLineVisible: false, lastValueVisible: false, priceFormat: { type: 'custom', minMove: 0.0001, formatter: (v: number) => `${(v * 100).toFixed(1)}%` } }, 1);
      s.setData(drawdown.map((p) => ({ time: ts(p.time), value: p.value })));
      created.push(s);
      chart.panes()[1]?.setHeight(70);
    }
    chart.priceScale('right').applyOptions({ mode: log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
    const cancel = fitWhenSized(chart);
    return () => {
      cancel();
      if (chartRef.current !== chart) return; // the chart itself is gone (unmount)
      for (const s of created) chart.removeSeries(s);
      while (chart.panes().length > 1) chart.removePane(chart.panes().length - 1);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, drawdown, log, percent, fitKey]);
  return <div className={className} style={{ height, position: 'relative' }} ref={box} />;
}
