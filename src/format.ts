/** 数字格式化。抬头、价签、提示框共用一份，避免同一个数在页面里出现两种写法。 */

/** 价格的默认小数位（报价口径：两位小数，与大多数撮合所的 tick 精度一致）。 */
export const DEFAULT_PRICE_PRECISION = 2;

/** 去掉尾随的 0 与孤立的小数点（32.10 → 32.1，32.00 → 32）。 */
function trim(value: number, digits: number): string {
  const fixed = value.toFixed(digits);
  if (!fixed.includes('.')) return fixed;
  return fixed.replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * 价格格式化。
 *
 * - **给了 `precision`**（整数 0~8）：固定小数位，**不**去尾随 0 —— 价格轴刻度、价签、
 *   提示框要的是「同一竖列对齐的报价」，`42300` 与 `42300.5` 混在一起反而难读；
 * - 不给：最多 6 位小数并去掉尾随 0（老口径，量级跨度大的场景仍然好用）。
 */
/** 给整数部分加千分位（`42300.00` → `42,300.00`）。 */
function groupThousands(text: string): string {
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  const [intPart, decPart] = body.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const out = decPart ? `${grouped}.${decPart}` : grouped;
  return negative ? `-${out}` : out;
}

export function formatPrice(value: number, precision?: number): string {
  if (!isFinite(value)) return '-';
  const digits = Number(precision);
  if (precision !== undefined && precision !== null && isFinite(digits)) {
    // 固定小数位 + 千分位：主流看盘软件的报价口径（82,532.40 这样读起来才有位感）
    return groupThousands(value.toFixed(Math.min(8, Math.max(0, Math.round(digits)))));
  }
  return trim(value, 6);
}

/** 成交量：千 / 百万 / 十亿 用 K / M / B 缩写，最多 2 位小数。 */
export function formatVolume(value: number): string {
  if (!isFinite(value)) return '-';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${trim(value / 1e9, 2)}B`;
  if (abs >= 1e6) return `${trim(value / 1e6, 2)}M`;
  if (abs >= 1e3) return `${trim(value / 1e3, 2)}K`;
  return trim(value, 2);
}

/** 带符号的价格（涨跌额）：`+1.2` / `-0.8`。 */
export function formatSigned(value: number): string {
  if (!isFinite(value)) return '-';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${formatPrice(Math.abs(value))}`;
}

/** 百分比：`+1.23%` / `-0.45%`（入参是百分数本身，不是小数）。 */
export function formatPct(value: number): string {
  if (!isFinite(value)) return '-';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${trim(Math.abs(value), 2)}%`;
}
