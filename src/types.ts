import type { ChartOption, SeriesOption } from '@damoqiongqiu/ice-chart';

/** 四个价，顺序固定为 [开, 收, 低, 高]（与惯例一致）。 */
export type Ohlc = [number, number, number, number];

/** 涨跌配色。红涨绿跌是默认值（国内习惯），国际习惯反过来就自己传。 */
export interface CandleStyle {
  upColor?: string;
  downColor?: string;
  borderWidth?: number;
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
