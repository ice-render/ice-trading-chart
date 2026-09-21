import type { ChartOption, SeriesOption } from '@damoqiongqiu/ice-chart';

/** 四个价，顺序固定为 [开, 收, 低, 高]（与惯例一致）。 */
export type Ohlc = [number, number, number, number];

/** 蜡烛样式。红涨绿跌是默认值（国内习惯），国际习惯反过来就自己传。 */
export interface CandleStyle {
  upColor?: string;
  downColor?: string;
  /** 影线与空心描边的线宽，**单位是 CSS 像素**，默认 1。 */
  borderWidth?: number;
  /** 阳线画空心（只描边不填充）。默认 false = 涨跌都实心。 */
  hollowUp?: boolean;
}

/** 数据项的字段名配置。 */
export interface CandleFieldOptions {
  /** 开盘价字段名，默认 `o`（数组数据项不受影响）。 */
  openField?: string;
  /** 收盘价字段名，默认 `c`。它同时也是默认的 `yField`（y 轴的宽松量程按它算）。 */
  closeField?: string;
  /** 最低价字段名，默认 `l`。 */
  lowField?: string;
  /** 最高价字段名，默认 `h`。 */
  highField?: string;
}

/**
 * K 线的数据项：`{ x, o, c, l, h }`。
 *
 * 字段名可用 `openField` / `closeField` / `lowField` / `highField` 改，
 * 也接受 `[open, close, low, high]` 数组形式的数据项。
 */
export interface CandleDatum {
  x?: string | number;
  o?: number;
  c?: number;
  l?: number;
  h?: number;
  [key: string]: unknown;
}

/**
 * 交易图表里系列自己的 option。
 *
 * `candle` 与四个字段名都是**本包自己的**扩展字段：ice-chart 不认识它们，
 * 但 `InternalSeries.option` 是原始 option 对象的引用，所以会原样到达系列组件与提示框。
 */
export interface TradingSeriesOption extends SeriesOption, CandleFieldOptions {
  /** 涨跌配色。 */
  candle?: CandleStyle;
}

export interface TradingChartOption extends Omit<ChartOption, 'series'> {
  series: TradingSeriesOption[];
  /**
   * 成交量副图。
   *
   * - 不写：**自动** —— 数据项里能读出成交量字段（默认 `v`）就加，读不出就什么都不加；
   * - 传对象：`{ field, ratio, upColor, downColor, axisIndex, barWidth }`；
   * - 传 `false`：明确不要。
   *
   * ice-chart 没有 pane 概念，所以成交量走**第二个 y 轴**：轴域钉成 `[0, ratio × 最大量]`，
   * 柱子自然落在绘图区底部 `1/ratio` 的带子里（默认 5 → 20%）。
   */
  volume?: VolumeOption | boolean;
}

/**
 * 成交量副图配置。
 *
 * 上界是 `ratio × 最大量` 而不是最大量本身 —— 这就是「把柱子压到底部 1/ratio」的全部数学。
 */
export interface VolumeOption {
  /** 数据项里的成交量字段名，默认 `v`（也认长名 `volume`）。 */
  field?: string;
  /** 高度比例分母：成交量占绘图区底部 `1/ratio`，默认 5（即 20%）。 */
  ratio?: number;
  /** 涨色，默认沿用 K 线的涨色。 */
  upColor?: string;
  /** 跌色，默认沿用 K 线的跌色。 */
  downColor?: string;
  /** 绑到哪个 y 轴，默认 1（价格轴是 0）。 */
  axisIndex?: number;
  /** 柱宽（占 band 的比例），默认 0.62。 */
  barWidth?: number;
}

/** 价格轴的显式范围。影线必须进量程，否则会被裁掉。 */
export interface PriceRange {
  min: number;
  max: number;
}

export interface PriceRangeOptions {
  /** 上下各留的比例，默认 0.06。 */
  padding?: number;
}
