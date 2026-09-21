import type { ICEChart, Rect } from '@damoqiongqiu/ice-chart';

/**
 * 画布内坐标投影。
 *
 * 为什么要有这一层：交易图表的外壳（OHLC 抬头、价格标签、最新价线、十字光标横线）
 * 通常由应用自己用 DOM 画在画布上方，而不是画进 canvas —— 于是「数据坐标 → 画布像素」
 * 必须有**公开契约**。直接摸 `chart.norm.yAxes[i].scale` 与 `chart.layout.plot` 也能算，
 * 但那等于把内部结构当 API 用；这里把它固化下来。
 *
 * 返回的坐标一律是**画布 CSS 像素**（原点在画布左上角，与 `chart.layout.plot` 同一坐标系）。
 * 覆盖层容器只要和画布左上角对齐，就能直接拿去写样式。
 *
 * ⚠️ 不要用 `seriesComponent.pixelAt()` 做这件事：入场 / 更新动画期间它返回的是**补间中**的
 * 位置，而不是最终位置（实测踩过）。这里走比例尺，与动画无关。
 */

/** 绘图区矩形（画布 CSS 像素）。没有布局时返回 null。 */
export function plotRect(chart: ICEChart): Rect | null {
  const plot = chart.layout && chart.layout.plot;
  if (!plot || !isFinite(plot.width) || plot.width <= 0) return null;
  return { x: plot.x, y: plot.y, width: plot.width, height: plot.height };
}

/** 价格 → 画布 y。 */
export function priceToY(chart: ICEChart, price: number, axisIndex = 0): number | null {
  const plot = plotRect(chart);
  if (!plot || typeof price !== 'number' || !isFinite(price)) return null;
  const axis = chart.norm && chart.norm.yAxes[axisIndex];
  const scale = axis && axis.scale;
  if (!scale) return null;
  const local = Number(scale.map(price));
  if (!isFinite(local)) return null;
  return plot.y + local;
}

/** 画布 y → 价格（指针位置反投影成价格）。 */
export function yToPrice(chart: ICEChart, y: number, axisIndex = 0): number | null {
  const plot = plotRect(chart);
  if (!plot || typeof y !== 'number' || !isFinite(y)) return null;
  const axis = chart.norm && chart.norm.yAxes[axisIndex];
  const scale = axis && axis.scale;
  if (!scale) return null;
  const value = Number(scale.invert(y - plot.y));
  if (!isFinite(value)) return null;
  return value;
}

/** 类目 / x 值 → 画布 x。 */
export function categoryToX(chart: ICEChart, xValue: unknown): number | null {
  const plot = plotRect(chart);
  if (!plot) return null;
  const scale = chart.norm && chart.norm.xAxis && chart.norm.xAxis.scale;
  if (!scale) return null;
  const local = Number(scale.map(xValue));
  if (!isFinite(local)) return null;
  return plot.x + local;
}

/**
 * 画布 x → 类目下标。
 *
 * 用 `scale.invert` 而不是 `scale.indexAt`：类目带之间**有间隙**（`paddingInner` 默认 0.2），
 * `indexAt` 落在间隙里会返回 -1 —— 指针正好在两个蜡烛之间时就成了「没点到任何类目」。
 * `invert` 命中不到时给最近的类目，这与十字光标取列的口径一致。
 * 指针在绘图区之外才返回 null，调用方能区分「在外面」与「在最边上」。
 */
export function xToCategoryIndex(chart: ICEChart, x: number): number | null {
  const plot = plotRect(chart);
  if (!plot) return null;
  if (x < plot.x || x > plot.x + plot.width) return null;
  const scale = chart.norm && chart.norm.xAxis && chart.norm.xAxis.scale;
  if (!scale || !scale.isBand()) return null;
  const value = scale.invert(x - plot.x);
  const index = scale.domain.indexOf(value);
  return index >= 0 ? index : null;
}
