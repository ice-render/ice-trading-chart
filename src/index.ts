import { createChart } from '@damoqiongqiu/ice-chart';
import type { AxisOption, ChartOption, ICEChart, ICEChartOptions, SeriesOption, TooltipOption } from '@damoqiongqiu/ice-chart';
import { computePriceRange } from './axisRange';
import { CANDLESTICK_TYPE, registerTradingSeries } from './register';
import { createOhlcTooltipFormatter } from './tooltip';
import type { CandleLabels, OhlcTooltipOptions } from './tooltip';
import type { TradingChartOption, TradingSeriesOption } from './types';

/** `createTradingChart` 的第三参：本包自己的开关。 */
export interface TradingChartExtras {
  /** 价格轴范围（含影线）的留白比例，默认 0.06。 */
  pricePadding?: number;
  /** 提示框里四个价的行名。 */
  priceLabels?: CandleLabels;
  /**
   * 是否自动钉住价格轴范围，默认 `true`。
   *
   * 关掉就完全由 ice-chart 自动量程 —— 而它只看收盘价（`yField`），影线会被裁。
   * 只有当你要自己按可见窗口做「价格轴自适应」时才该关。
   */
  autoPriceRange?: boolean;
}

function isCandle(series: SeriesOption | undefined): series is TradingSeriesOption {
  return !!series && series.type === CANDLESTICK_TYPE;
}

/**
 * 把交易图表的 option 补齐成 ice-chart 能吃的形式。
 *
 * 四件事，都只填**没写**的字段：
 * 1. K 线系列的 `yField` 默认指向收盘价字段 —— 这样默认提示框的 `value`、序列化的数据契约
 *    都以收盘价为准。
 * 2. `xAxis` 默认 `category` —— 等宽 K 线、跳过非交易时段，正是行情图要的语义。
 * 3. `yAxis.min` / `max` 按**含影线的全量极值**钉住 —— ice-chart 的自动量程只看收盘价，
 *    不钉住影线就被裁（`min` / `max` 是公开选项，且显式写的那一侧不加自动留白，
 *    所以留白由 `computePriceRange` 给）。
 * 4. 装上 OHLC 提示框 formatter（用户自带 formatter 时不覆盖）。
 */
export function toTradingOption(option: TradingChartOption, extras: TradingChartExtras = {}): ChartOption {
  const seriesList = (option.series || []).map((series) => {
    if (!isCandle(series)) return series;
    const closeField = series.closeField || 'c';
    return { ...series, yField: series.yField || closeField };
  }) as TradingSeriesOption[];

  const next: ChartOption = { ...option, series: seriesList as SeriesOption[] };

  if (!next.xAxis) {
    next.xAxis = { type: 'category' };
  }

  if (extras.autoPriceRange !== false) {
    const range = computePriceRange(seriesList, { padding: extras.pricePadding });
    const axis = next.yAxis;
    if (range) {
      if (Array.isArray(axis)) {
        if (axis.length) next.yAxis = [withPriceRange(axis[0], range), ...axis.slice(1)];
      } else {
        next.yAxis = withPriceRange(axis, range);
      }
    }
  }

  const candleOption = seriesList.find(isCandle);
  if (candleOption && (!next.tooltip || !next.tooltip.formatter)) {
    const tooltip: TooltipOption = { trigger: 'item', ...(next.tooltip || {}) };
    const formatterOptions: OhlcTooltipOptions = { seriesOption: candleOption, labels: extras.priceLabels };
    // ice-chart 把 `tooltip.formatter` 的返回类型声明成了 `string | string[]`，
    // 而运行时支持的还有 `{ title?, rows? }`（`InteractionController` 里那三个分支）。
    // 这里按运行时的真实契约转型，不去动上游的类型声明。
    tooltip.formatter = createOhlcTooltipFormatter(formatterOptions) as unknown as TooltipOption['formatter'];
    next.tooltip = tooltip;
  }

  return next;
}

/** 只补没写的 min / max，用户显式给的那一侧不动。 */
function withPriceRange(axis: AxisOption | undefined, range: { min: number; max: number }): AxisOption {
  const merged: AxisOption = { ...(axis || {}) };
  if (merged.min === undefined) merged.min = range.min;
  if (merged.max === undefined) merged.max = range.max;
  return merged;
}

/**
 * 创建一张交易图表。
 *
 * 内部先注册 `candlestick` 系列（幂等），再按 `toTradingOption` 补齐 option，
 * 最后交给 ice-chart 的 `createChart`。返回的是标准的 `ICEChart` 实例 ——
 * 交互、联动、序列化全部沿用 ice-chart 的既有能力。
 */
export function createTradingChart(
  target: string | HTMLCanvasElement,
  option: TradingChartOption,
  extras: TradingChartExtras = {},
  chartOptions?: ICEChartOptions
): ICEChart {
  registerTradingSeries();
  return createChart(target, toTradingOption(option, extras) as ChartOption, chartOptions);
}

export { computePriceRange, DEFAULT_PRICE_PADDING } from './axisRange';
export { readOhlc, hasOhlc, CANDLE_FIELDS } from './ohlc';
export { registerTradingSeries, CANDLESTICK_TYPE } from './register';
export { CandlestickSeries, DEFAULT_UP_COLOR, DEFAULT_DOWN_COLOR } from './series/CandlestickSeries';
export { createOhlcTooltipFormatter, formatPrice, DEFAULT_CANDLE_LABELS } from './tooltip';
export type { CandleLabels, OhlcTooltipOptions } from './tooltip';
export type {
  CandleDatum,
  CandleFieldOptions,
  CandleStyle,
  Ohlc,
  PriceRange,
  PriceRangeOptions,
  TradingChartOption,
  TradingSeriesOption,
} from './types';
