import { candleColumns } from './series/candleColumns';
import type { PriceRangeOptions, PriceRange, TradingSeriesOption } from './types';

/** 影线会让价格轴比「只用收盘价」宽一截，默认上下各留 6%（ice-chart 对固定端不加留白）。 */
export const DEFAULT_PRICE_PADDING = 0.06;

/**
 * 由数据算出**含影线**的价格轴范围。
 *
 * 为什么必须显式给：ice-chart 的自动量程只用归一化后的 `y`（本包默认是收盘价），
 * 影线（low / high）不在里面，不钉住就会把影线裁掉。落点是 `yAxis.min` / `yAxis.max` ——
 * 它们是 ice-chart 的公开选项，且对「显式写了的那一侧」不施加自动留白，所以留白由本函数给。
 *
 * 读不出任何有效蜡烛时返回 `null`，交给 ice-chart 自己量程（不画蛇添足）。
 */
export function computePriceRange(
  seriesList: TradingSeriesOption[],
  options: PriceRangeOptions = {}
): PriceRange | null {
  let min = Infinity;
  let max = -Infinity;
  for (const series of seriesList || []) {
    if (!series || series.type !== 'candlestick') continue;
    // 与渲染 / 命中**共用同一份列存**（同一趟扫描）：量程不再各解析一遍 raw
    const columns = candleColumns(series.data, series);
    if (columns.validCount === 0) continue;
    min = Math.min(min, columns.priceMin);
    max = Math.max(max, columns.priceMax);
  }
  if (!isFinite(min) || !isFinite(max)) return null;

  if (max === min) {
    // 全平的行情：给一个对称的可见区间，否则刻度会退化成一条线
    const span = Math.abs(max) * 0.01 || 1;
    return { min: min - span, max: max + span };
  }
  const padding = options.padding === undefined ? DEFAULT_PRICE_PADDING : options.padding;
  const pad = (max - min) * padding;
  return { min: min - pad, max: max + pad };
}
