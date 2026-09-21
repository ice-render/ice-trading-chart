import type { SeriesOption } from '@damoqiongqiu/ice-chart';
import { readOhlc } from './ohlc';
import { resolveCandleStyle } from './series/CandlestickSeries';
import type { CandleDatum, PriceRange, TradingSeriesOption, VolumeOption } from './types';

export const DEFAULT_VOLUME_FIELD = 'v';
export const DEFAULT_VOLUME_RATIO = 5;
export const DEFAULT_VOLUME_AXIS = 1;
/**
 * 成交量柱宽：同样**铺满类目带宽**（= 步距的 80%，留 20% 间隙）。
 *
 * 比蜡烛窄会让副图看着比主图稀疏，两者对齐才好读；要更细自己传 `barWidth`。
 */
export const DEFAULT_VOLUME_BAR_WIDTH = 1;

function toPositive(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return isFinite(n) && n >= 0 ? n : null;
}

/** 从原始数据项里读成交量。读不出返回 null（这根不画量，但不影响画 K 线）。 */
export function readVolume(raw: unknown, option: VolumeOption = {}): number | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const field = option.field || DEFAULT_VOLUME_FIELD;
  const item = raw as CandleDatum;
  if (item[field] !== undefined) return toPositive(item[field]);
  // 长名兼容
  return toPositive(item.volume);
}

/**
 * 由成交量数列算出**轴域**。
 *
 * 上界是 `ratio × 最大量` 而不是最大量本身 —— 这就是「把柱子压到底部 1/ratio」的全部数学：
 * 轴域 `[0, k·max]` 下，`v = max` 落在 `plot.height × (1 − 1/k)` 处。
 *
 * 调用方必须把得到的 max 配 `nice: false` 落到轴上，否则 `niceDomain` 会把上界向上取整，
 * 带宽就不是 1/k 了（`util/math.ts` 的 `niceDomain`）。
 */
export function computeVolumeRange(values: number[], ratio: number = DEFAULT_VOLUME_RATIO): PriceRange | null {
  let max = 0;
  for (const value of values || []) {
    if (typeof value !== 'number' || !isFinite(value)) continue;
    if (value > max) max = value;
  }
  if (max <= 0) return null;
  const k = isFinite(ratio) && ratio > 1 ? ratio : DEFAULT_VOLUME_RATIO;
  return { min: 0, max: max * k };
}

/** 收集一个系列（K 线）里所有能读出的成交量。 */
export function collectVolumes(series: TradingSeriesOption | undefined, option: VolumeOption = {}): number[] {
  if (!series || !Array.isArray(series.data)) return [];
  const out: number[] = [];
  for (const raw of series.data) {
    const volume = readVolume(raw, option);
    if (volume !== null) out.push(volume);
  }
  return out;
}

function readX(raw: unknown, source: TradingSeriesOption): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const item = raw as CandleDatum;
  const field = source.xField || 'x';
  if (item[field] !== undefined) return item[field];
  return item.name;
}

/**
 * 由 K 线系列生成成交量系列（`type: 'bar'`）。
 *
 * 两个必须遵守的约束：
 * 1. **数据项要带上和 K 线相同的 x**。ice-chart 的 `BandScale.indexOf` 刻意不做
 *    「数值当类目下标」的退化（`BandScale.ts:44-47`），不带 x 的 `{value}` 会映射到 NaN。
 * 2. **逐项配色**走数据项自己的 `color` 字段（`BarSeries.barColorAt`），涨跌方向由
 *    `close >= open` 判定，颜色取 K 线的 `candle` 样式。
 *
 * 一条量都读不出时返回 `null`（成交量的缺席不应该影响 K 线）。
 */
export function buildVolumeSeries(
  source: TradingSeriesOption | undefined,
  option: VolumeOption = {}
): SeriesOption | null {
  if (!source || !Array.isArray(source.data) || !source.data.length) return null;
  const style = resolveCandleStyle(source);
  const upColor = option.upColor || style.upColor;
  const downColor = option.downColor || style.downColor;
  const data: Array<Record<string, unknown>> = [];
  let readable = 0;
  for (const raw of source.data) {
    const volume = readVolume(raw, option);
    const ohlc = readOhlc(raw, source);
    const x = readX(raw, source);
    if (volume === null) {
      // **读不出量的那一根也要带上 x**：类目轴是按「这格系列里出现过的 x」建域的，
      // 少了 x 就少一个类目 —— 中间空一根会让后面所有量柱整体错位一格；
      // 尾巴上空一大片（比如视窗停在最新数据右边）时更糟：这份系列的类目域会
      // 比 K 线短一截，联动过来的窗口在这个 pane 里找不到右端 key，
      // 引擎的 clamp 只好退回「整段数据」，量图当场被拉成整幅（实测踩到）。
      const item: Record<string, unknown> = { value: null };
      if (x !== undefined) item.x = x;
      data.push(item);
      continue;
    }
    readable += 1;
    const rising = ohlc ? ohlc[1] >= ohlc[0] : true;
    const item: Record<string, unknown> = { value: volume, color: rising ? upColor : downColor };
    if (x !== undefined) item.x = x;
    data.push(item);
  }
  if (!readable) return null;
  return {
    id: `${source.id}__volume`,
    type: 'bar',
    name: `${source.name || source.id} 量`,
    yAxisIndex: option.axisIndex === undefined ? DEFAULT_VOLUME_AXIS : option.axisIndex,
    barWidth: option.barWidth === undefined ? DEFAULT_VOLUME_BAR_WIDTH : option.barWidth,
    data: data as any[],
  } as SeriesOption;
}

/** 由 `buildVolumeSeries` 的产物反推它挂在哪个轴上（tooltip / chrome 用）。 */
export function volumeAxisIndexOf(option: VolumeOption = {}): number {
  return option.axisIndex === undefined ? DEFAULT_VOLUME_AXIS : option.axisIndex;
}
