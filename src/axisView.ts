import type { ICEChart } from '@damoqiongqiu/ice-chart';
import { plotRect, yToPrice } from './project';

/**
 * 数值轴（y）的**视图控制** —— 交易图表上「照着标尺操作」的两个动作：
 *
 * - `resetAutoScale()`：把 y 交还给自动量程（右侧标尺上**双击**）；
 * - `zoomValueAxis()`：缩放 y（右侧标尺上**滚轮**）。
 *
 * 为什么这两个动作归应用侧而不是引擎：引擎的手势一律要求指针**落在绘图区内**
 * （`InteractionController.beginDrag` / `handleWheel` 都先判 `isInsidePlot`），
 * 标尺那一条带子它根本不认 —— 于是「滚轮在图上缩放时间轴、在标尺上缩放数值轴」
 * 这种主流看盘软件的分工，只能由应用把标尺上的事件接过来自己做。
 *
 * 两者都只走公开 API（`getDomain` / `fullDomain` / `setDomain` / `setOption`），
 * 不碰引擎内部结构。
 */

/**
 * 把某个 pane 的**数值轴（y）退回自动量程**，x 窗口原样保留。
 *
 * 为什么需要它：`interaction.pan.axes: 'xy'` 打开后，纵向拖动会把「用户拖出来的那个 y 窗口」
 * 记进图表实例的视图状态里，此后**写在 option 里的 `yAxis.min` / `max` 一律被它盖住**
 * （`rebuild()` 里 `effectiveYs` 优先取视图状态）—— 页面按可见窗口重算的量程再也进不去，
 * 价格轴就锁在用户拖出来的那个高度上，K 线被挤出绘图区也回不来。
 *
 * 主流看盘软件对此的手势是：**在右侧数值标尺上双击 = 自适应**。本函数就是那一步的
 * 数据侧动作，命中判定（指针是不是落在标尺上）由页面自己做 —— 它本来就有每块 pane 的
 * 画布矩形与绘图区矩形。
 *
 * 只走公开 API，两步：
 * 1. `setOption(当前 option, { preserveView: false })` —— 引擎里唯一能清掉视图状态的公开
 *    入口（`resetZoom()` 效果相同，但它默认带动画，而且同样会连 x 一起清掉）；
 * 2. 把 x 窗口按原样写回去 —— 「y 归自动、x 不动」才是「价格轴自适应」的语义。
 *
 * 全程包在 `silent()` 里：这是应用自己发起的一次量程调整，不该往外抛 `pan:change` /
 * `zoom:change`（否则「用户动过视窗 → 退出跟盘」这类订阅会被误触发）。
 *
 * @returns 是否真的执行了。图表还没布局好（没有绘图区）时返回 `false`，调用方可以据此跳过。
 */
export function resetAutoScale(chart: ICEChart): boolean {
  if (!chart || !chart.layout || !chart.norm) return false;
  const domain = chart.getDomain('x');
  chart.silent(() => {
    chart.setOption(chart.getOption(), { animate: false, preserveView: false });
    if (domain && domain.length >= 2) {
      chart.setDomain('x', [domain[0], domain[domain.length - 1]], 'api');
    }
  });
  return true;
}

/** `zoomValueAxis` 的参数。 */
export interface ValueZoomOptions {
  /** 一次缩放的倍数：**> 1 是放大**（窗口变窄），`< 1` 是缩小。滚轮一格的倍率见 `interaction.zoom.wheelFactor`。 */
  factor: number;
  /**
   * 缩放锚点在**画布内**的 y（与 `yToPrice(chart, y)` 同一坐标系，一般就传指针的 y）。
   * 不传则锚在绘图区中点 —— 锚点处的那个价格在缩放前后**停在原地**。
   */
  anchorY?: number;
  /** 缩放下限（占完整数据域的比例），默认取 option 里的 `interaction.zoom.minSpan`（再默认 0.05）。 */
  minSpan?: number;
  /** 缩放上限，默认取 option 里的 `interaction.zoom.maxSpan`（再默认 1 = 不超出完整数据域）。 */
  maxSpan?: number;
}

/** `interaction.zoom` 里连续轴的比例上下限（引擎的默认值：0.05 / 1）。 */
function spanLimits(chart: ICEChart, options: ValueZoomOptions): { min: number; max: number } {
  const interaction = chart.getOption().interaction;
  const zoom = interaction ? interaction.zoom : undefined;
  // `zoom` 可以是 `false`（关掉缩放）：只有对象形式才带上下限
  const configured = zoom !== undefined && typeof zoom === 'object' ? zoom : null;
  const pick = (own: number | undefined, fallback: number): number => {
    const value = Number(own);
    return isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    min: pick(options.minSpan, pick(configured ? configured.minSpan : undefined, 0.05)),
    max: pick(options.maxSpan, pick(configured ? configured.maxSpan : undefined, 1)),
  };
}

/**
 * 以 `anchorY` 为锚点缩放数值轴（「右侧标尺上滚轮」的数据侧动作）。
 *
 * 口径与引擎自己的数值轴缩放（`InteractionController.zoomDomain` 的连续轴分支）一致：
 * 新跨度 = `当前跨度 / factor`，夹在「完整数据域 × [`minSpan`, `maxSpan`]」之间，
 * 锚点处的价格保持不动。夹取与「不出完整数据域」交给 `setDomain('y', …, 'zoom')`
 * —— 走 `'zoom'` 这个来源才和引擎的手势缩放同一条夹取路径（`'api'` 不做这层约束）。
 *
 * @returns 是否真的缩放了（图表没布局好 / 窗口退化 / 锚点反投影不出价格时返回 `false`）。
 */
export function zoomValueAxis(chart: ICEChart, options: ValueZoomOptions): boolean {
  const factor = Number(options && options.factor);
  if (!chart || !chart.norm || !chart.layout || !isFinite(factor) || factor <= 0) return false;
  const plot = plotRect(chart);
  const domain = chart.getDomain('y');
  const full = chart.fullDomain('y');
  if (!plot || !domain || domain.length < 2 || !full || full.length < 2) return false;
  const d0 = Number(domain[0]);
  const d1 = Number(domain[1]);
  const f0 = Number(full[0]);
  const f1 = Number(full[1]);
  const span = d1 - d0;
  const fullSpan = f1 - f0;
  if (!(span > 0) || !(fullSpan > 0)) return false;
  const anchorY = options.anchorY === undefined ? plot.y + plot.height / 2 : Number(options.anchorY);
  const anchor = isFinite(anchorY) ? yToPrice(chart, anchorY) : null;
  if (anchor === null) return false;

  const limits = spanLimits(chart, options);
  const nextSpan = Math.min(Math.max(span / factor, fullSpan * limits.min), fullSpan * limits.max);
  // 锚点在窗口里的相对位置不变 —— 缩放时「指针指着的那个价格」纹丝不动
  const ratio = Math.min(1, Math.max(0, (anchor - d0) / span));
  const start = anchor - ratio * nextSpan;
  chart.setDomain('y', [start, start + nextSpan], 'zoom');
  return true;
}
