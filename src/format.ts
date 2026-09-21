/** 数字格式化。抬头、价签、提示框共用一份，避免同一个数在页面里出现两种写法。 */

/** 去掉尾随的 0 与孤立的小数点（32.10 → 32.1，32.00 → 32）。 */
function trim(value: number, digits: number): string {
  const fixed = value.toFixed(digits);
  if (!fixed.includes('.')) return fixed;
  return fixed.replace(/0+$/, '').replace(/\.$/, '');
}

/** 价格：最多 6 位小数，去掉尾随的 0。 */
export function formatPrice(value: number): string {
  if (!isFinite(value)) return '-';
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
