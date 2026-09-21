/**
 * ice-trading-chart 的公开导出面。
 *
 * 分块：
 * - `./chart`     交易图表的装配（option 补齐 + 建图）
 * - `./axisView`  数值轴的视图控制（标尺双击自适应 / 标尺滚轮缩放）
 * - `./indicators` 技术指标（纯函数 + 叠加/副图 option）
 * - `./panes`      真副图（多实例 + 联动 + 横向对齐）
 * - `./drawing`    画线工具（SVG 覆盖层，按数据坐标持久化）
 * - `./orderBook`  盘口（买卖十档，独立组件）
 * - `./volume`     成交量（同图第二轴压底）
 * - `./project`    画布内坐标投影（HTML 外壳对齐用）
 * - `./readout`    光标 → 一根 K 线的读数
 */
export { createTradingChart, toTradingOption } from './chart';
export type { TradingChartExtras } from './chart';
export { computePriceRange, DEFAULT_PRICE_PADDING } from './axisRange';
export { applyValueAxisScale, beginValueAxisScale, resetAutoScale, zoomValueAxis } from './axisView';
export type { ValueAxisScale, ValueZoomOptions } from './axisView';
export {
  bollinger,
  closeSeries,
  createMacdPaneOption,
  createOverlaySeries,
  createRsiPaneOption,
  ema,
  macd,
  macdRange,
  rsi,
  seriesData,
  sma,
  stdev,
} from './indicators';
export {
  createPaneStack,
  fixedWidthAxisFormatter,
  DEFAULT_AXIS_LABEL_CHARS,
  PANE_FONT_FAMILY,
} from './panes';
export type { PaneSpec, PaneStack, PaneStackOptions } from './panes';
export { createDrawingLayer, DRAWING_KINDS } from './drawing';
export { createOrderBook } from './orderBook';
export type { OrderBook, OrderBookData, OrderBookLevel, OrderBookOptions } from './orderBook';
export type {
  Drawing,
  DrawingKind,
  DrawingLayer,
  DrawingLayerOptions,
  DrawingPoint,
} from './drawing';
export { formatPct, formatPrice, formatSigned, formatVolume } from './format';
export { readOhlc, hasOhlc, CANDLE_FIELDS } from './ohlc';
export { plotRect, priceToY, yToPrice, categoryToX, xToCategoryIndex } from './project';
export { createOhlcReadout } from './readout';
export { registerTradingSeries, CANDLESTICK_TYPE } from './register';
export { CandlestickSeries, DEFAULT_UP_COLOR, DEFAULT_DOWN_COLOR, resolveCandleStyle } from './series/CandlestickSeries';
export { createOhlcTooltipFormatter, DEFAULT_CANDLE_LABELS } from './tooltip';
export {
  buildVolumeSeries,
  collectVolumes,
  computeVolumeRange,
  readVolume,
  DEFAULT_VOLUME_BAR_WIDTH,
  DEFAULT_VOLUME_FIELD,
  DEFAULT_VOLUME_RATIO,
} from './volume';
export type { CandleLabels, OhlcTooltipOptions } from './tooltip';
export type { OhlcReading, OhlcReadout, OhlcReadoutOptions } from './readout';
export type { ResolvedCandleStyle } from './series/CandlestickSeries';
export type {
  CandleDatum,
  CandleFieldOptions,
  CandleStyle,
  Ohlc,
  PriceRange,
  PriceRangeOptions,
  TradingChartOption,
  TradingSeriesOption,
  VolumeOption,
} from './types';
