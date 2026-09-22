import { readOhlc } from '../ohlc';
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
  return { count, open, close, low, high, valid, validCount, priceMin, priceMax, indexOfX };
}
