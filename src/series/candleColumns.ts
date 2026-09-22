import { readOhlc } from '../ohlc';
import type { InternalSeries } from '@damoqiongqiu/ice-chart';
import type { CandleFieldOptions } from '../types';

/**
 * K 线的**列存**：四个价只解析一次，之后渲染 / 命中 / 量程都按标量读。
 *
 * 为什么要这一层（照 ice-chart 的列存思路）：一屏 K 线的成本本来被三件事放大 ——
 * ① 每次命中都新建一个「每根一个 Rect」的数组；② 每帧每根都重新 `readOhlc(raw)`
 * （raw 是用户给的元组 / 对象，解析一次还要新建 `[o,c,l,h]` 数组）；
 * ③ 没有窗口裁剪，缩到最远时把全量 K 线都画一遍。
 * 于是「10 万根 K 线」在命中和渲染上都是 O(n) 且每根都在分配对象 —— 列存把这三件事
 * 一起收敛成：**建列一趟 O(n)，之后热路径只读标量、只碰可见窗口**。
 *
 * 纪律（与 ice-chart 的列存一致）：
 * - **读不出的根不画**（`valid[i] === 0`），绝不补 0 或补前值；
 * - 列存**不是**第二份真相：它由原始数据派生，`data` 一变（换数组 / 变长度）就重建；
 * - 缓存键带「字段名签名」：同一份数据用不同字段名读，是两份列。
 *
 * ⚠️ 唯一的已知盲区：**同一个数组等长原地改值**（`data[i].c = ...` 而不换数组、不改长度）
 * 不会被发现 —— 本包的 setData / appendData 都不会这么干（换数组 / 收尾追加），
 * 但应用自己原地改值时要调 `invalidateCandleColumns(data)`。
 */
export interface CandleColumns {
  /** 根数（= 数据项数与归一化后的点数）。 */
  count: number;
  open: Float64Array;
  close: Float64Array;
  low: Float64Array;
  high: Float64Array;
  /** 该根能否读出四个价（0 = 读不出：不画、不参与量程与压缩聚合）。 */
  valid: Uint8Array;
  /** 读得出的根数。 */
  validCount: number;
  /** 影线极值（只统计读得出的根）；一根都没有时是 ±Infinity。 */
  priceMin: number;
  priceMax: number;
  /** 类目 → 下标：窗口裁剪与命中定位用（O(1)，不必扫全量）。重复标签后者胜。 */
  indexOfX: Map<string, number>;
  /**
   * `indexOfX` 里存的下标是**相对这个偏移**的（环形滑动的记账）。
   *
   * 不这么做的话，滑动一格就要把整张 Map 的下标全部改一遍（O(n)）——
   * 存相对值之后，滑动只把这个数加一。
   */
  shiftOffset: number;
  /** 增量维护之后极值可能陈旧（环滑动会淘汰掉极值那一根）；用前调 `ensureCandleRange`。 */
  rangeStale: boolean;
}

/** 缓存：数据数组 → (字段签名 → 列)。用 WeakMap 挂数据，不改数据、不阻止回收。 */
const CACHE = new WeakMap<object, Map<string, CandleColumns>>();

/** 字段签名：同一份数据换个字段名读就是另一份列。 */
export function candleFieldSignature(option: CandleFieldOptions = {}): string {
  return [option.openField || '', option.closeField || '', option.lowField || '', option.highField || ''].join('|');
}

/** 取（必要时建）列。`data` 不是数组时返回一根都没有的空列，不抛错。 */
export function candleColumns(data: unknown, option: CandleFieldOptions = {}): CandleColumns {
  if (!Array.isArray(data)) return buildCandleColumns(data, option);
  const signature = candleFieldSignature(option);
  let bySignature = CACHE.get(data);
  if (!bySignature) {
    bySignature = new Map<string, CandleColumns>();
    CACHE.set(data, bySignature);
  }
  const key = `${signature}#${data.length}`;
  const cached = bySignature.get(key);
  if (cached) return cached;
  const columns = buildCandleColumns(data, option);
  // 只保留当前签名 / 长度那一份：原地改值或换字段名时不留旧列
  bySignature.clear();
  bySignature.set(key, columns);
  return columns;
}

/** 丢弃某份数据的列（原地改值之后调它；换数组 / 改长度不需要）。 */
export function invalidateCandleColumns(data: unknown): void {
  if (data && typeof data === 'object') CACHE.delete(data as object);
}

/**
 * **面向系列的列存**（组件用它）：数据来源优先取系列自己的存储，而不是 `option.data`。
 *
 * 为什么必须这样：K 线默认走 ice-chart 的列存，`appendData(..., { maxPoints })` 之后
 * **原始数据归存储所有、option 里的 `data` 被摘掉** —— 再照 `option.data` 建列就得到一份空列，
 * 蜡烛会**静默不画**（实测：环形模式下 `validCount === 0`，而画布上只剩坐标轴，
 * 冒烟测试因为"有墨"照样绿 —— 这类 bug 只有盯着数据才看得出来）。
 *
 * 数据一律走公开访问器 `series.pointAt(i).raw`（普通系列 / 惰性原始点 / 环形都能读）。
 * 缓存按**存储对象**（`series.raw`）或**数据数组**做键，并支持两种增量：
 * - 环形（`raw.capacity > 0`）：`start` 前进了多少就平移多少列（`copyWithin`）+ 只解析新进来的那几根；
 * - 惰性原始点（非环）：长度长了就只解析尾部新增的几根。
 * 于是「追加一根」对应的是 O(1) 的列维护，而不是每次重扫全窗口。
 */
export function candleColumnsFor(series: InternalSeries, option: CandleFieldOptions = {}): CandleColumns {
  const fields = candleFieldSignature(option);
  const raw = series.raw || null;
  const data = (series.option as any) ? (series.option as any).data : undefined;
  const key: object | null = raw ? raw : Array.isArray(data) ? data : null;
  const cached = key ? SERIES_CACHE.get(key) : undefined;
  if (cached && cached.fields === fields && cached.series === series) {
    const reused = reuseCandleColumns(cached, series, raw, data, option);
    if (reused) return cached.columns;
  }
  const columns = buildColumnsFromSeries(series, option);
  if (key) {
    SERIES_CACHE.set(key, {
      series,
      fields,
      capacity: raw ? raw.capacity : 0,
      start: raw ? raw.start : 0,
      length: columns.count,
      dataRef: data,
      firstKey: columns.indexOfX.size ? String(series.xValueAt(0)) : '',
      lastKey: columns.count ? String(series.xValueAt(columns.count - 1)) : '',
      columns,
    });
  }
  return columns;
}

interface SeriesColumnsCache {
  series: InternalSeries;
  fields: string;
  /** 环形态：容量与起点（判断"滑动了几格"）。 */
  capacity: number;
  start: number;
  /** 逻辑长度（判断"尾部追加了几根"）。 */
  length: number;
  dataRef: unknown;
  /** 普通系列：首末类目（内容一变就重建）。 */
  firstKey: string;
  lastKey: string;
  columns: CandleColumns;
}

const SERIES_CACHE = new WeakMap<object, SeriesColumnsCache>();

/** 能复用现有的列就复用（并就地增量维护）；不能就返回 false（调用方重建）。 */
function reuseCandleColumns(
  cached: SeriesColumnsCache,
  series: InternalSeries,
  raw: any,
  data: unknown,
  option: CandleFieldOptions
): boolean {
  const columns = cached.columns;
  if (raw && raw.capacity > 0) {
    if (cached.capacity !== raw.capacity || cached.length !== raw.length) return false;
    const delta = (raw.start - cached.start + raw.capacity) % raw.capacity;
    if (delta === 0) return true;
    if (delta >= raw.length) return false;
    shiftColumns(columns, series, delta, option);
    cached.start = raw.start;
    cached.series = series;
    return true;
  }
  if (raw) {
    if (cached.length > raw.length) return false;
    if (cached.length === raw.length) {
      cached.series = series;
      return true;
    }
    appendColumns(columns, series, cached.length, raw.length, option);
    cached.length = raw.length;
    cached.series = series;
    return true;
  }
  if (Array.isArray(data) && cached.dataRef === data && cached.length === series.pointCount) {
    // 普通系列：内容可能被原地改过（push+shift 这种长度不变的情况），首末类目一致才敢复用
    const firstKey = series.pointCount ? String(series.xValueAt(0)) : '';
    const lastKey = series.pointCount ? String(series.xValueAt(series.pointCount - 1)) : '';
    if (firstKey === cached.firstKey && lastKey === cached.lastKey) {
      cached.series = series;
      return true;
    }
  }
  return false;
}

/** 从系列（走公开访问器）建一份全新的列。 */
function buildColumnsFromSeries(series: InternalSeries, option: CandleFieldOptions): CandleColumns {
  const count = series.pointCount;
  const columns: CandleColumns = {
    count,
    open: new Float64Array(count),
    close: new Float64Array(count),
    low: new Float64Array(count),
    high: new Float64Array(count),
    valid: new Uint8Array(count),
    validCount: 0,
    priceMin: Infinity,
    priceMax: -Infinity,
    indexOfX: new Map<string, number>(),
    shiftOffset: 0,
    rangeStale: false,
  };
  appendColumns(columns, series, 0, count, option);
  return columns;
}

/** 解析 [from, to) 这些根写进列（并维护类目索引）。 */
function appendColumns(
  columns: CandleColumns,
  series: InternalSeries,
  from: number,
  to: number,
  option: CandleFieldOptions
): void {
  for (let i = from; i < to; i++) {
    const point = series.pointAt(i);
    columns.indexOfX.set(String(series.xValueAt(i)), i - columns.shiftOffset);
    const ohlc = point ? readOhlc(point.raw, option) : null;
    if (!ohlc) continue;
    columns.open[i] = ohlc[0];
    columns.close[i] = ohlc[1];
    columns.low[i] = ohlc[2];
    columns.high[i] = ohlc[3];
    columns.valid[i] = 1;
    columns.validCount += 1;
  }
  columns.rangeStale = true;
}

/**
 * 环形态滑动 `delta` 格：整体左移 + 只解析新进来的那几根。
 *
 * `indexOfX` 存的是「相对 `shiftOffset` 的下标」，滑动只把 offset 加 delta
 * （类目→下标的查表因此不必重写一整张 Map ✗ → ✓）。
 */
function shiftColumns(columns: CandleColumns, series: InternalSeries, delta: number, option: CandleFieldOptions): void {
  // 被挤出去的那些类目：从索引表里摘掉（它们的下标已经不在窗口里）
  let evictedValid = 0;
  for (let i = 0; i < delta; i++) {
    if (columns.valid[i]) evictedValid += 1;
    columns.indexOfX.delete(String(series.xValueAt(i)));
  }
  const count = series.pointCount;
  const keep = count - delta;
  columns.open.copyWithin(0, delta);
  columns.close.copyWithin(0, delta);
  columns.low.copyWithin(0, delta);
  columns.high.copyWithin(0, delta);
  columns.valid.copyWithin(0, delta);
  columns.shiftOffset += delta;
  columns.validCount -= evictedValid;
  // 尾部是被复制过来的陈旧一格：先清零有效标记（新的那几根由 appendColumns 覆盖）
  for (let i = 0; i < delta; i++) {
    columns.valid[keep + i] = 0;
  }
  columns.rangeStale = true;
  appendColumns(columns, series, keep, count, option);
}

/** 需要精确极值时重算一遍（增量维护之后它是陈旧的）。 */
export function ensureCandleRange(columns: CandleColumns): void {
  if (!columns.rangeStale) return;
  let min = Infinity;
  let max = -Infinity;
  let valid = 0;
  for (let i = 0; i < columns.count; i++) {
    if (!columns.valid[i]) continue;
    valid += 1;
    if (columns.low[i] < min) min = columns.low[i];
    if (columns.high[i] > max) max = columns.high[i];
  }
  columns.validCount = valid;
  columns.priceMin = isFinite(min) ? min : Infinity;
  columns.priceMax = isFinite(max) ? max : -Infinity;
  columns.rangeStale = false;
}

/** 建列（纯函数，不走缓存）。 */
export function buildCandleColumns(data: unknown, option: CandleFieldOptions = {}): CandleColumns {
  const list = Array.isArray(data) ? data : [];
  const count = list.length;
  const open = new Float64Array(count);
  const close = new Float64Array(count);
  const low = new Float64Array(count);
  const high = new Float64Array(count);
  const valid = new Uint8Array(count);
  const indexOfX = new Map<string, number>();
  let validCount = 0;
  let priceMin = Infinity;
  let priceMax = -Infinity;
  for (let i = 0; i < count; i++) {
    const raw: any = list[i];
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.x !== undefined) {
      indexOfX.set(String(raw.x), i);
    } else {
      indexOfX.set(String(i), i);
    }
    const ohlc = readOhlc(raw, option);
    if (!ohlc) continue;
    open[i] = ohlc[0];
    close[i] = ohlc[1];
    low[i] = ohlc[2];
    high[i] = ohlc[3];
    valid[i] = 1;
    validCount += 1;
    if (ohlc[2] < priceMin) priceMin = ohlc[2];
    if (ohlc[3] > priceMax) priceMax = ohlc[3];
  }
  return {
    count,
    open,
    close,
    low,
    high,
    valid,
    validCount,
    priceMin,
    priceMax,
    indexOfX,
    shiftOffset: 0,
    rangeStale: false,
  };
}
