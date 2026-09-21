import type { ICEChart } from '@damoqiongqiu/ice-chart';

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
