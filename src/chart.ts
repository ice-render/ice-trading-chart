import { createChart } from '@damoqiongqiu/ice-chart';
import type { AxisOption, ChartOption, ICEChart, ICEChartOptions, SeriesOption, TooltipOption } from '@damoqiongqiu/ice-chart';
import { computePriceRange } from './axisRange';
import { resolveDpr } from './device';
import { formatPrice } from './format';
import { DEFAULT_NUMBER_FORMAT } from './messages';
import type { TerminalMessages, TerminalNumberFormat, TerminalVolumeFormat } from './messages';
import { CANDLESTICK_TYPE, registerTradingSeries } from './register';
import { createOhlcTooltipFormatter } from './tooltip';
import type { CandleLabels, OhlcTooltipOptions } from './tooltip';
import { buildVolumeSeries, collectVolumes, computeVolumeRange, volumeAxisIndexOf } from './volume';
import type { TradingChartOption, TradingSeriesOption, VolumeOption } from './types';

/** `createTradingChart` 的第三参：本包自己的开关。 */
export interface TradingChartExtras {
  /** 价格轴范围（含影线）的留白比例，默认 0.06。 */
  pricePadding?: number;
  /** 提示框里四个价（与量）的行名。 */
  priceLabels?: CandleLabels;
  /**
   * 报价的**小数位**（价格轴刻度 + 提示框里的四个价），例如 `2` → `42300.00`。
   *
   * 不给就保持引擎原来的自适应写法（整数刻度就写整数、最多 6 位小数、去尾随 0）。
   * 给了就**固定位数、不去尾随 0** —— 价格轴要的是一列对齐的报价，
   * `42300` 和 `42300.5` 混在一起反而难读。用户自己写了 `yAxis.formatter` 时不覆盖。
   */
  pricePrecision?: number;
  /**
   * 文案目录（'zh' / 'en' 预设或自定义片段）：提示框的行名从它取。
   *
   * 库自己渲染的文案都在这里，见 `src/messages.ts`；应用自己的界面文案不归库管。
   */
  messages?: Partial<TerminalMessages> | 'zh' | 'en';
  /**
   * 数字格式化（价格轴刻度 + 提示框）；要按 locale 走就传 `createIntlNumberFormat('de-DE')`。
   */
  numberFormat?: TerminalNumberFormat;
  /** 成交量格式化（提示框里的量）。 */
  volumeFormat?: TerminalVolumeFormat;
  /**
   * 是否自动钉住价格轴范围，默认 `true`。
   *
   * 关掉就完全由 ice-chart 自动量程 —— 而它只看收盘价（`yField`），影线会被裁。
   * 只有当你要自己按可见窗口做「价格轴自适应」时才该关。
   */
  autoPriceRange?: boolean;
  /** 是否自动配成交量副图，默认 `true`。关掉相当于把 option 里的 `volume` 当不存在。 */
  autoVolume?: boolean;
  /**
   * 设备像素比。**不传就用 `window.devicePixelRatio`**（上限 3）。
   *
   * 引擎的 dpr 默认是 1，不传的话高分屏上画布是 1x 位图被浏览器放大，整张图发虚。
   * 传 1 可以退回旧行为（比如截图对比或低端设备省显存）。
   */
  dpr?: number;
}

function isCandle(series: SeriesOption | undefined): series is TradingSeriesOption {
  // `renderAs` 也算 K 线：换了渲染类型（线 / 面积）之后，交易语义还得按 K 线走
  return !!series && (series.type === CANDLESTICK_TYPE || !!(series as TradingSeriesOption).renderAs);
}

/** 按 `renderAs` 把 K 线系列换成引擎内置的折线 / 面积（语义不动）。 */
function renderSeriesList(seriesList: TradingSeriesOption[]): SeriesOption[] {
  return seriesList.map((series) => {
    if (!isCandle(series)) return series as SeriesOption;
    const renderAs = series.renderAs;
    /**
     * K 线（**最终仍是 candlestick**）默认开列存：ice-chart 0.30 起 `virtual` 对自定义系列
     * 也成立 —— 不建「每根一个 `DataPoint`」的数组（10 万根省 5~6MB、100 万根省 50MB 量级），
     * 原始数据仍按引用保留（提示框的 `params.data`、本包自己的字段解析都照旧），
     * 像素缓存也照旧。用户显式写 `virtual: false` 时不覆盖。
     *
     * `renderAs: 'line'/'area'` **不加**这个默认：那会把系列变成引擎内置的数值列系列，
     * 而类目轴（时间字符串）不吃数值列那条路（会显式报错）—— 要列存得用户自己声明。
     */
    if (!renderAs || renderAs === CANDLESTICK_TYPE) {
      return { ...series, virtual: series.virtual !== false } as SeriesOption;
    }
    return { ...series, type: renderAs } as SeriesOption;
  });
}

/** 只补没写的 min / max，用户显式给的那一侧不动。 */
function withPriceRange(axis: AxisOption | undefined, range: { min: number; max: number }): AxisOption {
  const merged: AxisOption = { ...(axis || {}) };
  if (merged.min === undefined) merged.min = range.min;
  if (merged.max === undefined) merged.max = range.max;
  return merged;
}

/**
 * 把交易图表的 option 补齐成 ice-chart 能吃的形式。
 *
 * 六件事，都只填**没写**的字段：
 * 1. K 线系列的 `yField` 默认指向收盘价字段。
 * 2. `xAxis` 默认 `category` —— 等宽 K 线、跳过非交易时段。
 * 3. `yAxis.min` / `max` 按**含影线的全量极值**钉住（ice-chart 的自动量程只看收盘价）。
 * 4. **成交量副图**：数据里读得出量就加一个绑到第二 y 轴的 `bar` 系列，并把该轴钉成
 *    `[0, ratio×最大量]` 且 `show:false`、`nice:false` —— 柱子落在底部 `1/ratio`，
 *    隐藏的轴不占横向空间（`layout.ts` 里 `show:false` 直接 `offset = 0`）。
 * 5. 装上 OHLC（+量）提示框 formatter（用户自带 formatter 时不覆盖）。
 * 6. 用户自己声明的其余 y 轴原样保留。
 */
export function toTradingOption(option: TradingChartOption, extras: TradingChartExtras = {}): ChartOption {
  const seriesList = (option.series || []).map((series) => {
    if (!isCandle(series)) return series;
    const closeField = series.closeField || 'c';
    return { ...series, yField: series.yField || closeField };
  }) as TradingSeriesOption[];

  const next: ChartOption = { ...option, series: renderSeriesList(seriesList) };
  delete (next as unknown as Record<string, unknown>).volume;

  if (!next.xAxis) {
    next.xAxis = { type: 'category' };
  }

  // ---- 成交量副图（先算，因为要决定 yAxis 的形状）
  const volumeConfig: VolumeOption | null =
    extras.autoVolume === false || option.volume === false
      ? null
      : option.volume && typeof option.volume === 'object'
        ? option.volume
        : {};
  let volumeSeries: SeriesOption | null = null;
  let volumeSource: TradingSeriesOption | undefined;
  if (volumeConfig) {
    for (const series of seriesList) {
      if (!isCandle(series)) continue;
      const built = buildVolumeSeries(series, volumeConfig);
      if (built) {
        volumeSeries = built;
        volumeSource = series;
        break;
      }
    }
  }
  if (volumeSeries) {
    next.series = [...renderSeriesList(seriesList), volumeSeries] as SeriesOption[];
  }

  // ---- y 轴：价格轴（钉含影线的范围）+ 成交量轴（钉带宽）
  const userAxes: AxisOption[] = Array.isArray(option.yAxis)
    ? option.yAxis.slice()
    : option.yAxis
      ? [option.yAxis]
      : [];
  const axes: AxisOption[] = [userAxes[0] ? { ...userAxes[0] } : {}];
  let axesTouched = false;

  if (extras.autoPriceRange !== false) {
    const range = computePriceRange(seriesList, { padding: extras.pricePadding });
    if (range) {
      axes[0] = withPriceRange(axes[0], range);
      axesTouched = true;
    }
  }

  // 报价小数位：只填没写 formatter 的价格轴（用户自己格式化时不抢）
  const precision = Number(extras.pricePrecision);
  const numberFormat = extras.numberFormat || DEFAULT_NUMBER_FORMAT;
  if (extras.pricePrecision !== undefined && isFinite(precision) && !axes[0].formatter) {
    const digits = Math.min(8, Math.max(0, Math.round(precision)));
    axes[0].formatter = (value: unknown) => numberFormat(Number(value), digits);
    axesTouched = true;
  }

  if (volumeSeries && volumeSource) {
    const axisIndex = volumeAxisIndexOf(volumeConfig || {});
    const volumeRange = computeVolumeRange(collectVolumes(volumeSource, volumeConfig || {}), (volumeConfig || {}).ratio);
    const axis: AxisOption = { ...(userAxes[axisIndex] || {}), show: false, nice: false };
    if (volumeRange) {
      if (axis.min === undefined) axis.min = volumeRange.min;
      if (axis.max === undefined) axis.max = volumeRange.max;
    }
    while (axes.length <= axisIndex) axes.push({});
    axes[axisIndex] = axis;
    axesTouched = true;
  }

  // 用户自己声明的其余轴原样补回
  for (let i = 1; i < userAxes.length; i++) {
    if (axes[i] === undefined) axes[i] = userAxes[i];
  }

  // 只在真的动过轴时才写回去 —— 没写 yAxis 的场景不该凭空多出一个空轴
  if (axesTouched || Array.isArray(option.yAxis)) {
    next.yAxis = Array.isArray(option.yAxis) || axes.length > 1 ? axes : axes[0];
  }

  // ---- 提示框
  const candleOption = seriesList.find(isCandle);
  if (candleOption && (!next.tooltip || !next.tooltip.formatter)) {
    // 默认 `axis` 触发器：整列读数（十字光标到哪一根、抬头就显示哪一根）。
    // 这与引擎自己的默认一致；引擎的 `item` 触发器要求指针正好压在数据图元上，
    // 交易图表里那样会「时有时无」。
    const tooltip: TooltipOption = { trigger: 'axis', ...(next.tooltip || {}) };
    const formatterOptions: OhlcTooltipOptions = {
      seriesOption: candleOption,
      labels: extras.priceLabels,
      pricePrecision: extras.pricePrecision,
      messages: extras.messages,
      numberFormat: extras.numberFormat,
      volumeFormat: extras.volumeFormat,
      volumeSeriesId: volumeSeries ? String(volumeSeries.id) : undefined,
    };
    // ice-chart 把 `tooltip.formatter` 的返回类型声明成了 `string | string[]`，
    // 而运行时支持的还有 `{ title?, rows? }`（`InteractionController` 里那三个分支）。
    // 这里按运行时的真实契约转型，不去动上游的类型声明。
    tooltip.formatter = createOhlcTooltipFormatter(formatterOptions) as unknown as TooltipOption['formatter'];
    next.tooltip = tooltip;
  }

  return next;
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
  const options: ICEChartOptions = {
    ...(chartOptions || {}),
    dpr: resolveDpr(chartOptions && chartOptions.dpr !== undefined ? chartOptions.dpr : extras.dpr),
  };
  return createChart(target, toTradingOption(option, extras) as ChartOption, options);
}
