import type { DataPoint, ICEChart, InternalSeries } from '@damoqiongqiu/ice-chart';
import { readOhlc } from './ohlc';
import { readVolume } from './volume';
import { candleColumns } from './series/candleColumns';
import type { VolumeOption } from './types';

/** 一根 K 线的读数（抬头、提示框、价签都用同一份）。 */
export interface OhlcReading {
  /** 系列内下标。 */
  index: number;
  /** x 值（类目轴上是类目名）。 */
  xValue: unknown;
  open: number;
  high: number;
  low: number;
  close: number;
  /** 成交量；数据里没有或读不出时为 null。 */
  volume: number | null;
  /** 涨跌额（以**上一根收盘**为基准；第一根退化成「收 − 开」）。 */
  change: number;
  /** 涨跌幅（%）。 */
  changePct: number;
  /** 涨跌方向，价签与抬头配色都用它。 */
  rising: boolean;
}

export interface OhlcReadoutOptions {
  /** 读哪个系列，默认第一个 candlestick 系列。 */
  seriesId?: string;
  /** 成交量字段配置，与 `createTradingChart` 的 `volume` 保持一致。 */
  volume?: VolumeOption | false;
}

export interface OhlcReadout {
  /** 不传 index 时：有光标跟光标，没光标跟着最后一根。 */
  read(index?: number): OhlcReading | null;
  /** 订阅光标 / 数据变化；返回取消订阅的函数。 */
  subscribe(fn: (reading: OhlcReading | null) => void): () => void;
  dispose(): void;
}

/**
 * 光标 / 数据 → 一根 K 线的读数。
 *
 * 为什么单独做一个：图表外壳上的 OHLC 抬头需要「当前光标那一根」，而 ice-chart 没有
 * 十字光标位置事件（事件表里没有 `crosshair:change`）。可用的公开读数是
 * `chart.controller.hover`（item / axis 两种悬停态）与 `item:hover` / `item:leave` 事件 ——
 * 这里把它们收敛成一个稳定的取数入口，页面只消费 `read()`。
 */
export function createOhlcReadout(chart: ICEChart, options: OhlcReadoutOptions = {}): OhlcReadout {
  const volumeOption = options.volume === false ? null : options.volume || {};

  const findSeries = (): InternalSeries | null => {
    const series: InternalSeries[] = (chart.norm && chart.norm.series) || [];
    if (options.seriesId) {
      const byId = series.find((s) => s.id === options.seriesId);
      if (byId) return byId;
    }
    return series.find((s) => s.type === 'candlestick') || null;
  };

  const hoverIndex = (series: InternalSeries): number | null => {
    const hover: any = (chart as any).controller && (chart as any).controller.hover;
    if (!hover) return null;
    if (hover.kind === 'item' && hover.item && hover.item.series === series) {
      return hover.item.point.index;
    }
    if (hover.kind === 'axis' && hover.column && Array.isArray(hover.column.items)) {
      const hit = hover.column.items.find((item: any) => item.series === series);
      if (hit) return hit.point.index;
      // 列里没有这个系列（比如缩放到它不可见）时退回列下标
      return typeof hover.column.dataIndex === 'number' ? hover.column.dataIndex : null;
    }
    return null;
  };

  const build = (series: InternalSeries, index: number): OhlcReading | null => {
    /**
     * 读点走 ice-chart 的**统一访问器**（`pointCount` / `pointAt`），不直读 `series.points`：
     * K 线默认开列存（`virtual`）之后 `points` 是空的，直读会让抬头永远读不出东西。
     */
    const total = series.pointCount;
    if (!total) return null;
    const i = Math.max(0, Math.min(total - 1, index));
    const point = series.pointAt(i);
    if (!point) return null;
    const ohlc = readOhlc(point.raw, series.option as any);
    if (!ohlc) return null;
    const previous = i > 0 ? series.pointAt(i - 1) : null;
    const base = previous ? readOhlc(previous.raw, series.option as any) : null;
    const prevClose = base ? base[1] : ohlc[0];
    const change = ohlc[1] - prevClose;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;
    return {
      index: i,
      xValue: point.xValue,
      open: ohlc[0],
      high: ohlc[3],
      low: ohlc[2],
      close: ohlc[1],
      volume: volumeOption ? readVolume(point.raw, volumeOption) : null,
      change,
      changePct,
      rising: change >= 0,
    };
  };

  /**
   * 最后一根**读得出 K 线**的下标。
   *
   * 为什么不能直接用 `points.length - 1`：交易图表的渲染窗口尾巴上常常挂着
   * 「未来空位」（只有类目、没有 OHLC），视窗停在最新一根时最后那几个点就是空位 ——
   * 拿最后一个点当兜底会读不出 OHLC，`read()` 直接返回 null，页面的抬头 / 图例
   * 在**没有悬停**的时候就是空的（实测踩到）。
   *
   * 往前扫的结果按「点数」缓存：数据刷新（同一根更新）不动它，新增一根才失效。
   */
  let lastRealCache: { length: number; index: number } | null = null;
  const lastRealIndex = (series: InternalSeries): number => {
    // 同样走统一访问器；列存的「这一根读不读得出」直接查列（valid），不再逐根解析 raw
    const total = series.pointCount;
    if (!total) return 0;
    if (lastRealCache && lastRealCache.length === total) return lastRealCache.index;
    const columns = candleColumns(series.option.data, series.option as any);
    let index = total - 1;
    while (index > 0 && columns.valid[index] === 0) index--;
    lastRealCache = { length: total, index };
    return index;
  };

  const read = (index?: number): OhlcReading | null => {
    const series = findSeries();
    if (!series) return null;
    const target = index === undefined ? hoverIndex(series) : index;
    const fallback = lastRealIndex(series);
    return build(series, target === null || target === undefined ? fallback : target);
  };

  return {
    read,

    subscribe(fn: (reading: OhlcReading | null) => void): () => void {
      const emit = () => fn(read());
      const names = ['item:hover', 'item:leave', 'data:change'];
      for (const name of names) chart.on(name, emit);
      return () => {
        for (const name of names) chart.off(name, emit);
      };
    },

    dispose(): void {
      /* 订阅由 subscribe 返回的取消函数负责，这里留一个对称的出口 */
    },
  };
}
