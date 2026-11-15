import {
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

import { pct } from '../lib/format';
import type { Line, Signals } from '../lib/strategies';
import type { Candle, Trade } from '../lib/types';
import { chartOptions, fitWhenSized, priceFormat, THEME, type Sync } from './charts';

export interface PriceChartHandle {
  focus: (from: number, to: number) => void;
}

interface Props {
  candles: Candle[];
  overlays: Line[];
  oscillator?: Signals['oscillator'];
  trades: Trade[];
  intraday: boolean;
  log: boolean;
  sync: Sync;
  fitKey: string;
  ref?: Ref<PriceChartHandle>;
}

interface Api {
  chart: IChartApi;
  candles: ISeriesApi<'Candlestick'>;
  volume: ISeriesApi<'Histogram'>;
  markers: ISeriesMarkersPluginApi<Time>;
  extra: ISeriesApi<SeriesType>[];
}

const ts = (t: number) => t as UTCTimestamp;
const points = (candles: Candle[], values: number[]) =>
  candles.map((c, i) => (Number.isFinite(values[i]) ? { time: ts(c.time), value: values[i] } : { time: ts(c.time) }));

function markers(trades: Trade[], labels: boolean): SeriesMarker<Time>[] {
  const marks: SeriesMarker<Time>[] = [];
  for (const t of trades) {
    const long = t.side === 'long';
    marks.push({
      time: ts(t.entryTime),
      position: long ? 'belowBar' : 'aboveBar',
      shape: long ? 'arrowUp' : 'arrowDown',
      color: long ? THEME.up : THEME.down,
      text: labels ? (long ? 'Buy' : 'Short') : undefined,
    });
    marks.push({
      time: ts(t.exitTime),
      position: long ? 'aboveBar' : 'belowBar',
      shape: long ? 'arrowDown' : 'arrowUp',
      color: '#C9D1D9',
      text: labels ? `${long ? 'Sell' : 'Cover'} ${pct(t.pnlPct, { sign: true, digits: 0 })}` : undefined,
    });
  }
  return marks.sort((x, y) => (x.time as number) - (y.time as number));
}

/** Candles with the strategy's indicators, its trades as arrows, and RSI / MACD in a panel below when used. */
export function PriceChart({ candles, overlays, oscillator, trades, intraday, log, sync, fitKey, ref }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);

  useEffect(() => {
    const chart = createChart(box.current!, chartOptions(false));
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: THEME.up,
      downColor: THEME.down,
      wickUpColor: THEME.up,
      wickDownColor: THEME.down,
      borderVisible: false,
      priceLineVisible: false,
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.08, bottom: 0.17 } }); // candles stay above the volume bars
    api.current = { chart, candles: candleSeries, volume, markers: createSeriesMarkers(candleSeries, []), extra: [] };
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
    api.current?.chart.priceScale('right').applyOptions({ mode: log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
  }, [log]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    a.candles.applyOptions({ priceFormat: priceFormat(candles[candles.length - 1]?.close ?? 100) });
    a.candles.setData(candles.map((c) => ({ time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    a.volume.setData(
      candles.map((c) => ({
        time: ts(c.time),
        value: c.volume,
        color: c.close >= c.open ? 'rgba(43, 212, 138, 0.22)' : 'rgba(242, 85, 90, 0.22)',
      })),
    );
  }, [candles]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    for (const s of a.extra) a.chart.removeSeries(s);
    a.extra = [];
    while (a.chart.panes().length > 1) a.chart.removePane(a.chart.panes().length - 1);

    const fmt = priceFormat(candles[candles.length - 1]?.close ?? 100);
    for (const line of overlays) {
      const s = a.chart.addSeries(LineSeries, {
        color: line.color,
        lineWidth: 2,
        lineStyle: line.dashed ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        priceFormat: fmt,
      });
      s.setData(points(candles, line.values));
      a.extra.push(s);
    }

    if (oscillator) {
      if (oscillator.histogram) {
        const hist = a.chart.addSeries(
          HistogramSeries,
          { priceLineVisible: false, lastValueVisible: false, priceFormat: { type: 'price', precision: 2, minMove: 0.01 } },
          1,
        );
        hist.setData(
          candles.map((c, i) => {
            const v = oscillator.histogram![i];
            return Number.isFinite(v)
              ? { time: ts(c.time), value: v, color: v >= 0 ? 'rgba(43, 212, 138, 0.5)' : 'rgba(242, 85, 90, 0.5)' }
              : { time: ts(c.time) };
          }),
        );
        a.extra.push(hist);
      }
      oscillator.lines.forEach((line, k) => {
        const s = a.chart.addSeries(
          LineSeries,
          {
            color: line.color,
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: true,
            crosshairMarkerVisible: false,
            priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
          },
          1,
        );
        s.setData(points(candles, line.values));
        if (k === 0)
          for (const level of oscillator.levels ?? [])
            s.createPriceLine({
              price: level,
              color: '#5C6873',
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: '',
            });
        a.extra.push(s);
      });
      const panes = a.chart.panes();
      panes[0]?.setStretchFactor(3);
      panes[1]?.setStretchFactor(1);
    }
  }, [candles, overlays, oscillator]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    // Arrows always; their labels only once zoomed in far enough for them not to pile up.
    let labelled: boolean | null = null;
    const draw = () => {
      const range = a.chart.timeScale().getVisibleLogicalRange();
      const visible = range ? trades.filter((t) => t.exitIndex >= range.from && t.entryIndex <= range.to).length : trades.length;
      const bars = range ? range.to - range.from : Infinity;
      const labels = visible <= 14 && bars <= 400;
      if (labels !== labelled) {
        labelled = labels;
        a.markers.setMarkers(markers(trades, labels));
      }
    };
    draw();
    a.chart.timeScale().subscribeVisibleLogicalRangeChange(draw);
    return () => a.chart.timeScale().unsubscribeVisibleLogicalRangeChange(draw);
  }, [trades]);

  useEffect(() => {
    const chart = api.current?.chart;
    return chart ? fitWhenSized(chart) : undefined;
  }, [fitKey]);

  useImperativeHandle(
    ref,
    () => ({
      focus(from, to) {
        const a = api.current;
        if (!a || !candles.length) return;
        const i0 = Math.max(
          0,
          candles.findIndex((c) => c.time >= from),
        );
        const found = candles.findIndex((c) => c.time >= to);
        const i1 = found < 0 ? candles.length - 1 : found;
        const pad = Math.max(12, Math.round((i1 - i0) * 0.6));
        a.chart.timeScale().setVisibleLogicalRange({ from: i0 - pad, to: i1 + pad });
      },
    }),
    [candles],
  );

  return <div ref={box} className="chart" />;
}
