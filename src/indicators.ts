import type { SeriesOption } from '@damoqiongqiu/ice-chart';
import { readOhlc } from './ohlc';
import { resolveCandleStyle } from './series/CandlestickSeries';
import { resolveTerminalMessages } from './messages';
import type { TerminalMessages } from './messages';
import type { TradingSeriesOption } from './types';

/**
 * 技术指标。
 *
 * 纯函数一律返回**与输入等长**的数列，预热期为 `null`（不是跳过、不是补 0）——
 * 这样指标的每一格都能直接对上 K 线的下标，画图 / 提示框 / 表都不用再对齐一次。
 *
 * ⚠️ 派生系列的数据项必须**带上与 K 线相同的 x 值**：ice-chart 的类目轴按字符串
 * 匹配类目（`BandScale.indexOf` 刻意不做「数值当角标」的退化），不带 x 的点会映射到 NaN。
 */

export type Series = Array<number | null>;

/** 简单移动平均。 */
export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** 指数移动平均。首个有效值用前 period 个值的简单平均做种子（与通行做法一致）。 */
export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** 总体标准差（除以 n）—— 布林带用总体口径，与主流终端一致。 */
export function stdev(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0) return out;
  const mean = sma(values, period);
  for (let i = period - 1; i < values.length; i++) {
    const avg = mean[i];
    if (avg === null) continue;
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += (values[j] - avg) ** 2;
    out[i] = Math.sqrt(sum / period);
  }
  return out;
}

export interface BollingerBands {
  middle: Series;
  upper: Series;
  lower: Series;
}

/** 布林带（默认 20 周期、2 倍标准差）。 */
export function bollinger(values: number[], period = 20, multiplier = 2): BollingerBands {
  const middle = sma(values, period);
  const deviation = stdev(values, period);
  const upper: Series = new Array(values.length).fill(null);
  const lower: Series = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    const mid = middle[i];
    const dev = deviation[i];
    if (mid === null || dev === null) continue;
    upper[i] = mid + dev * multiplier;
    lower[i] = mid - dev * multiplier;
  }
  return { middle, upper, lower };
}

export interface MacdResult {
  /** 快慢均线之差。 */
  dif: Series;
  /** DIF 的信号线。 */
  dea: Series;
  /** 柱 = (DIF − DEA) × 2（国内终端的习惯倍数）。 */
  histogram: Series;
}

/** MACD（默认 12 / 26 / 9）。 */
export function macd(values: number[], fast = 12, slow = 26, signal = 9): MacdResult {
  const fastLine = ema(values, fast);
  const slowLine = ema(values, slow);
  const dif: Series = values.map((_, i) =>
    fastLine[i] === null || slowLine[i] === null ? null : (fastLine[i] as number) - (slowLine[i] as number)
  );
  // DEA 是 DIF 的 EMA，要把 null 段剔掉再算、再按位置填回
  const valid: number[] = [];
  const indexOfValid: number[] = [];
  for (let i = 0; i < dif.length; i++) {
    if (dif[i] !== null) {
      valid.push(dif[i] as number);
      indexOfValid.push(i);
    }
  }
  const deaValid = ema(valid, signal);
  const dea: Series = new Array(values.length).fill(null);
  for (let i = 0; i < deaValid.length; i++) dea[indexOfValid[i]] = deaValid[i];
  const histogram: Series = values.map((_, i) =>
    dif[i] === null || dea[i] === null ? null : ((dif[i] as number) - (dea[i] as number)) * 2
  );
  return { dif, dea, histogram };
}

/** 相对强弱指标（默认 14 周期，Wilder 平滑）。 */
export function rsi(values: number[], period = 14): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0 || values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const up = diff > 0 ? diff : 0;
    const down = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + up) / period;
    avgLoss = (avgLoss * (period - 1) + down) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** 收盘价序列（指标的统一输入）。读不出的位置给前值填充，保证下标与 K 线对齐。 */
export function closeSeries(candles: TradingSeriesOption | undefined): number[] {
  if (!candles || !Array.isArray(candles.data)) return [];
  const out: number[] = [];
  let last = 0;
  for (const raw of candles.data) {
    const ohlc = readOhlc(raw, candles);
    if (ohlc) last = ohlc[1];
    out.push(last);
  }
  return out;
}

/** 每根 K 线的 x（类目标签）。派生系列必须带上它。 */
function xSeries(candles: TradingSeriesOption | undefined): unknown[] {
  if (!candles || !Array.isArray(candles.data)) return [];
  const field = candles.xField || 'x';
  return candles.data.map((raw: any, i) => {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      if (raw[field] !== undefined) return raw[field];
      if (raw.name !== undefined) return raw.name;
    }
    return i;
  });
}

export interface SeriesDataOptions {
  /**
   * 去掉首尾的 null（默认 `true`）。
   *
   * 为什么必须去：ice-chart 归一化时把 `y === null` 的点写成 `top: 0`
   * （`normalize.ts`），折线系列于是把「缺失」当成 **0** 画 —— 均线的预热期会从
   * 第一个有效值处拉出一条竖直假线（实测：pixel y 落在 yScale.map(0) 上，不是 NaN）。
   * 首尾 null 只是「还没有值」，直接不输出数据项最干净。
   *
   * 注意：**中间**的空洞目前没法在应用侧规避，只能等上游把 null 点真正断线。
   */
  trim?: boolean;
  /** 只保留指定区间（含头部对齐用），一般不用传。 */
  from?: number;
  to?: number;
}

/** 把一条指标数列变成图表的 `line` 系列数据（带上与 K 线相同的 x）。 */
export function seriesData(
  candles: TradingSeriesOption | undefined,
  values: Series,
  extra: Record<string, unknown> = {},
  options: SeriesDataOptions = {}
) {
  const xs = xSeries(candles);
  const trim = options.trim !== false;
  let from = 0;
  let to = xs.length - 1;
  if (trim) {
    while (from <= to && values[from] === null) from++;
    while (to >= from && values[to] === null) to--;
  }
  if (options.from !== undefined) from = Math.max(from, options.from);
  if (options.to !== undefined) to = Math.min(to, options.to);
  const out: Array<Record<string, unknown>> = [];
  for (let i = from; i <= to; i++) {
    out.push({ x: xs[i], y: values[i] === null ? null : values[i], ...extra });
  }
  return out;
}

export interface OverlaySpec {
  /** 叠加哪几种：均线（可多周期）、布林带。 */
  ma?: number[];
  emaPeriods?: number[];
  boll?: { period?: number; multiplier?: number } | false;
  /** 均线线宽（CSS px），默认 1.2。 */
  lineWidth?: number;
  /** 均线配色（按 MA、EMA 依次取），不给就用内置色板。 */
  palette?: string[];
  /** 文案目录（序列名从它取，图例可见）。 */
  messages?: Partial<TerminalMessages> | 'zh' | 'en';
}

/** 派生系列自动开 `virtual` 的最小点数（小图保持原样：`getOption()` 里照旧带着 data）。 */
const DERIVED_VIRTUAL_MIN = 4096;

/**
 * 大系列 + **类目 x** 时，给派生系列开 `virtual`（引擎的**惰性原始点**）。
 *
 * 为什么只在这条路上开：
 * - 类目 x（时间字符串）走惰性原始点 —— 原始数据**仍按引用保留**，省掉的是
 *   「每点一个 `DataPoint`」与逐帧的像素缓存 / LTTB（百万点的派生折线实测占整帧大头）；
 *   `getOption()` 与提示框照旧拿得到 `data`。
 * - 数值 x 的虚拟系列走**数值列**，引擎会把 `data` 从 option 里摘掉（换内存）。
 *   那是「用户显式要求」的语义，不在这里替他决定 —— 要省内存的应用自己写 `virtual: true`。
 */
function derivedVirtual(candles: TradingSeriesOption | undefined, count: number): true | undefined {
  if (!candles || !Array.isArray(candles.data) || count <= DERIVED_VIRTUAL_MIN) return undefined;
  const field = candles.xField || 'x';
  const sample: any = candles.data[0];
  const x = sample && typeof sample === 'object' && !Array.isArray(sample) ? sample[field] : undefined;
  return typeof x === 'string' ? true : undefined;
}

/**
 * 主图叠加系列（均线 / 布林带）。
 *
 * 叠加系列绑在价格轴上、不参与柱位分配（类型是 `line`），并且**不带 tooltip 行**——
 * 抬头已经在报四个价，再塞几行均线会喧宾夺主（要看数值就把 `id` 传给 readout 之外的用法）。
 */
export function createOverlaySeries(
  candles: TradingSeriesOption | undefined,
  spec: OverlaySpec = {}
): SeriesOption[] {
  if (!candles || !Array.isArray(candles.data) || !candles.data.length) return [];
  const closes = closeSeries(candles);
  const out: SeriesOption[] = [];
  const axisIndex = Number((candles as any).yAxisIndex) || 0;
  const width = spec.lineWidth === undefined ? 1.2 : spec.lineWidth;

  const push = (id: string, name: string, values: Series, color: string, dashed = false) => {
    const data = seriesData(candles, values) as any[];
    out.push({
      id,
      type: 'line',
      name,
      yAxisIndex: axisIndex,
      smooth: false,
      lineWidth: width,
      color,
      lineDash: dashed ? [4, 3] : undefined,
      // 大系列 + 类目 x：走惰性原始点（不建「每点一个 DataPoint」、绘制按像素列抽样）
      virtual: derivedVirtual(candles, data.length),
      data,
    } as SeriesOption);
  };

  const palette = spec.palette && spec.palette.length ? spec.palette : ['#f5a524', '#3b82f6', '#a78bfa', '#22c55e', '#ec4899'];
  // 序列名走文案目录：图例开着时用户看到的就是这几个名字
  const messages = resolveTerminalMessages(spec.messages);
  (spec.ma || []).forEach((period, i) => {
    push(`${candles.id}__ma${period}`, messages.indicators.ma(period), sma(closes, period), palette[i % palette.length]);
  });
  (spec.emaPeriods || []).forEach((period, i) => {
    push(`${candles.id}__ema${period}`, messages.indicators.ema(period), ema(closes, period), palette[(i + 2) % palette.length], true);
  });
  if (spec.boll) {
    const period = spec.boll.period || 20;
    const band = bollinger(closes, period, spec.boll.multiplier || 2);
    push(`${candles.id}__boll-mid`, messages.indicators.boll(period), band.middle, '#94a3b8', true);
    push(`${candles.id}__boll-up`, `${messages.indicators.boll(period)}+`, band.upper, 'rgba(148,163,184,0.75)');
    push(`${candles.id}__boll-low`, `${messages.indicators.boll(period)}-`, band.lower, 'rgba(148,163,184,0.75)');
  }
  return out;
}

/** MACD pane 的 option 片段：柱 + DIF + DEA，柱按正负上色。 */
export function createMacdPaneOption(
  candles: TradingSeriesOption | undefined,
  spec: {
    fast?: number;
    slow?: number;
    signal?: number;
    upColor?: string;
    downColor?: string;
    /** 文案目录（MACD / DIF / DEA 三个序列名从它取）。 */
    messages?: Partial<TerminalMessages> | 'zh' | 'en';
  } = {}
): { series: SeriesOption[] } {
  const style = resolveCandleStyle(candles);
  const up = spec.upColor || style.upColor;
  const down = spec.downColor || style.downColor;
  const closes = closeSeries(candles);
  const result = macd(closes, spec.fast || 12, spec.slow || 26, spec.signal || 9);
  const messages = resolveTerminalMessages(spec.messages);
  const xs = xSeries(candles);
  const histogram = xs.map((x, i) => {
    const value = result.histogram[i];
    return { x, y: value, color: (value ?? 0) >= 0 ? up : down };
  });
  // 百万点的柱 / 线：与叠加系列同一条口径（类目 x + 大系列 → 惰性原始点）
  const virtual = derivedVirtual(candles, histogram.length);
  return {
    series: [
      {
        id: `${candles?.id || 'k'}__macd-hist`,
        type: 'bar',
        name: messages.indicators.macd,
        barWidth: 0.42,
        virtual,
        data: histogram as any[],
      } as SeriesOption,
      {
        id: `${candles?.id || 'k'}__macd-dif`,
        type: 'line',
        name: messages.indicators.dif,
        lineWidth: 1.1,
        color: '#f5a524',
        virtual,
        data: seriesData(candles, result.dif) as any[],
      } as SeriesOption,
      {
        id: `${candles?.id || 'k'}__macd-dea`,
        type: 'line',
        name: messages.indicators.dea,
        lineWidth: 1.1,
        color: '#3b82f6',
        virtual,
        data: seriesData(candles, result.dea) as any[],
      } as SeriesOption,
    ],
  };
}

/** RSI pane 的 option 片段：一条 RSI + 30 / 50 / 70 三条参考线（用标注画）。 */
export function createRsiPaneOption(
  candles: TradingSeriesOption | undefined,
  spec: {
    period?: number;
    color?: string;
    /** 文案目录（RSI 序列名从它取）。 */
    messages?: Partial<TerminalMessages> | 'zh' | 'en';
  } = {}
): { series: SeriesOption[]; annotation: { lines: Array<Record<string, unknown>> } } {
  const closes = closeSeries(candles);
  const values = rsi(closes, spec.period || 14);
  const data = seriesData(candles, values) as any[];
  const guides = [70, 50, 30].map((value) => ({
    axis: 'y',
    value,
    dashed: true,
    color: 'rgba(138,151,166,0.45)',
    lineWidth: 1,
  }));
  return {
    series: [
      {
        id: `${candles?.id || 'k'}__rsi`,
        type: 'line',
        name: resolveTerminalMessages(spec.messages).indicators.rsi(spec.period || 14),
        lineWidth: 1.3,
        color: spec.color || '#a78bfa',
        virtual: derivedVirtual(candles, data.length),
        data,
      } as SeriesOption,
    ],
    annotation: { lines: guides },
  };
}

/**
 * 指标 pane 的固定 y 轴范围（让副图不随数据抖动）。
 * RSI 天生 0~100；MACD 需要按数据算对称的上下界。
 */
export function macdRange(
  candles: TradingSeriesOption | undefined,
  spec: { fast?: number; slow?: number; signal?: number; messages?: Partial<TerminalMessages> | 'zh' | 'en' } = {}
) {
  const closes = closeSeries(candles);
  const result = macd(closes, spec.fast || 12, spec.slow || 26, spec.signal || 9);
  let peak = 0;
  for (const series of [result.dif, result.dea, result.histogram]) {
    for (const value of series) {
      if (value === null) continue;
      peak = Math.max(peak, Math.abs(value));
    }
  }
  if (!peak) return null;
  const span = peak * 1.25;
  return { min: -span, max: span };
}
