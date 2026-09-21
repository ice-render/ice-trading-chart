import { DARK_CHART_THEME, LIGHT_CHART_THEME, createChart, linkCharts } from '@damoqiongqiu/ice-chart';
import type { AxisOption, ChartOption, ChartTheme, ICEChart } from '@damoqiongqiu/ice-chart';
import type { ChartLinkHandle } from '@damoqiongqiu/ice-chart';
import { createTradingChart, toTradingOption } from './chart';
import { resolveDpr } from './device';
import type { TradingChartOption } from './types';

/**
 * 真副图：把容器切成纵向堆叠的多块画布，每块一个独立的图表实例。
 *
 * 为什么不用「同一个绘图区 + 多个 y 轴」：那是**同一块**绘图区按轴域分带，
 * 副图的刻度、网格、量纲都跟主图挤在一起。真副图要的是各自独立的绘图区 ——
 * ice-chart 目前没有 pane 概念，所以这里用「多实例 + linkCharts 联动」实现，
 * 上游一行都不用改。
 *
 * 代价是**横向对齐要自己做**：每块画布的右轴预留宽度由「最宽刻度标签」决定，
 * 主图是 `42100.5`、成交量是 `2.4K`，宽度天然不同，绘图区就会左右错位。
 * 对策是两条一起上：
 *   1. 主题字体固定成等宽（数字与空格的步进一致）；
 *   2. 刻度标签用 `fixedWidthAxisFormatter` 补到同样的字符数。
 * 这样每块画布的最大标签宽度严格相等，右轴预留宽度也相等（预留 = 标签宽 + 固定间距）。
 */

/** 等宽字体：让「补空格对齐」真的成立。 */
export const PANE_FONT_FAMILY = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Roboto Mono', monospace";

export const DEFAULT_AXIS_LABEL_CHARS = 9;

/** 把刻度标签补/截到固定字符数（等宽字体下即固定像素宽）。 */
export function fixedWidthAxisFormatter(chars: number = DEFAULT_AXIS_LABEL_CHARS) {
  const width = Math.max(3, Math.round(chars));
  return (value: unknown): string => {
    const text = value === null || value === undefined ? '' : String(value);
    return text.length >= width ? text : text.padStart(width, ' ');
  };
}

export interface PaneSpec {
  id: string;
  /** 主力（价格）pane 用 `true`：它走 `createTradingChart`（含 K 线补齐、成交量配置等）。 */
  primary?: boolean;
  /** 高度权重，默认 1。 */
  weight?: number;
  /** 最小高度（px），默认 56。 */
  minHeight?: number;
  /**
   * 这一格的 option，也可以是**取值函数**。
   *
   * 给函数是因为：`setOption` 是**整体替换**，数据一变就得把完整 option 再给一次；
   * 由 pane 栈在每次 `refresh()` 时重新求值，才能保证它注入的「等宽主题 + 定宽刻度」
   * 不会在应用层自己 `setOption` 时被冲掉（冲掉之后横向对齐就失效了）。
   */
  option: ChartOption | TradingChartOption | (() => ChartOption | TradingChartOption);
  /** 传给 `createTradingChart` 的 extras（仅 primary）。 */
  extras?: Record<string, unknown>;
}

export interface PaneStackOptions {
  /** 容器总高（px）。不给则用容器当前高度。 */
  height?: number;
  /** pane 之间的间距（px），默认 8。 */
  gap?: number;
  /** 右轴标签的定宽字符数，默认 9。 */
  axisLabelChars?: number;
  /** 主题基座，默认深色；字体固定为等宽（对齐的前提）。 */
  theme?: 'light' | 'dark' | Partial<ChartTheme>;
  /** 是否联动 hover / zoom / pan / brush，默认 true。 */
  link?: boolean;
  /** 设备像素比，默认取 `window.devicePixelRatio`（上限 3）。各 pane 用同一个值。 */
  dpr?: number;
}

export interface PaneStack {
  /** 各 pane 的图表实例，顺序与传入的 specs 一致。 */
  charts: ICEChart[];
  chartOf(id: string): ICEChart | null;
  /**
   * 某一格的容器元素（`position: relative`）。
   *
   * 给需要往某一块画布上挂覆盖层的人用：OHLC 抬头、价签、十字光标横线这些
   * 都是应用层用 DOM 画的，挂载点就是这一格的容器 —— 有了它就不用去猜 DOM 结构。
   */
  holderOf(id: string): HTMLDivElement | null;
  /** 重新按容器尺寸排布（容器尺寸变化后调用）。 */
  resize(): void;
  /** 把每一格的 option 重新求值 + 重新注入对齐信息后应用（数据变化后调它）。 */
  refresh(applyOptions?: { animate?: boolean | 'enter' | 'update'; preserveView?: boolean }): void;
  /** 单独换某一格的 option（同样会重新注入对齐信息）。 */
  setPaneOption(id: string, option: ChartOption | TradingChartOption): void;
  /** 把每个 pane 的 x 窗口对齐到同一段（数据变化后调用）。 */
  syncDomains(): void;
  destroy(): void;
  link: ChartLinkHandle | null;
}

function composeAxisFormatter(user: AxisOption | undefined, chars: number): (value: unknown) => string {
  const pad = fixedWidthAxisFormatter(chars);
  const own = user && user.formatter;
  return (value: unknown) => {
    const text = own ? String(own(value as never, 0)) : String(value);
    return text.length >= chars ? text : text.padStart(chars, ' ');
  };
}

function baseTheme(theme: PaneStackOptions['theme']): ChartTheme {
  const base = theme === 'light' ? LIGHT_CHART_THEME : DARK_CHART_THEME;
  if (!theme || typeof theme === 'string') return { ...base, fontFamily: PANE_FONT_FAMILY };
  return { ...base, ...theme, fontFamily: PANE_FONT_FAMILY };
}

/** 把一格 option 的 y 轴规整成数组，并给每个轴装定宽 formatter。 */
function alignAxes(option: ChartOption, chars: number): AxisOption[] {
  const raw = option.yAxis;
  const axes: AxisOption[] = Array.isArray(raw) ? raw.map((axis) => ({ ...axis })) : [{ ...(raw || {}) }];
  if (!axes.length) axes.push({});
  return axes.map((axis) => ({ ...axis, formatter: composeAxisFormatter(axis, chars) }));
}

/**
 * 建一摞副图。
 *
 * ```ts
 * const stack = createPaneStack(document.getElementById('panes')!, [
 *   { id: 'price', primary: true, weight: 3, option: priceOption },
 *   { id: 'volume', weight: 1, option: volumeOption },
 *   { id: 'macd', weight: 1, option: macdOption },
 * ]);
 * ```
 */
export function createPaneStack(container: HTMLElement, specs: PaneSpec[], options: PaneStackOptions = {}): PaneStack {
  const gap = options.gap === undefined ? 8 : options.gap;
  const chars = options.axisLabelChars === undefined ? DEFAULT_AXIS_LABEL_CHARS : options.axisLabelChars;
  const theme = baseTheme(options.theme);
  const dpr = resolveDpr(options.dpr);
  const host = container;
  const created: Array<{ spec: PaneSpec; holder: HTMLDivElement; canvas: HTMLCanvasElement; chart: ICEChart; current: ChartOption }> = [];

  host.style.position = host.style.position || 'relative';

  /** 把一格的 option 求值 + 注入「等宽主题 + 定宽刻度」。 */
  const prepareOption = (spec: PaneSpec, override?: ChartOption | TradingChartOption): ChartOption => {
    const raw = (override || (typeof spec.option === 'function' ? spec.option() : spec.option)) as ChartOption;
    const axes = alignAxes(raw, chars);
    return {
      ...raw,
      theme,
      yAxis: axes.length === 1 ? axes[0] : axes,
    };
  };

  const totalWeight = specs.reduce((sum, spec) => sum + Math.max(0.0001, spec.weight === undefined ? 1 : spec.weight), 0);
  const outerHeight = options.height || host.clientHeight || 0;
  const usable = Math.max(specs.length * 56, outerHeight - gap * Math.max(0, specs.length - 1));

  specs.forEach((spec, index) => {
    const weight = Math.max(0.0001, spec.weight === undefined ? 1 : spec.weight);
    const minHeight = spec.minHeight === undefined ? 56 : spec.minHeight;
    const holder = document.createElement('div');
    holder.dataset.paneId = spec.id;
    holder.style.position = 'relative';
    holder.style.height = `${Math.max(minHeight, Math.round((usable * weight) / totalWeight))}px`;
    holder.style.marginTop = index === 0 ? '0' : `${gap}px`;
    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    holder.appendChild(canvas);
    host.appendChild(holder);

    const prepared = prepareOption(spec);
    // primary 走 createTradingChart（内部会再补一层交易语义：yField / 影线量程 / 提示框），
    // 其余 pane 直接 createChart —— 副图不需要 K 线那套补齐。
    const chart = spec.primary
      ? createTradingChart(canvas, prepared as TradingChartOption, (spec.extras || {}) as never, { dpr })
      : createChart(canvas, prepared, { dpr });

    created.push({ spec, holder, canvas, chart, current: prepared });
  });

  const charts = created.map((entry) => entry.chart);
  const handle = options.link === false || charts.length < 2 ? null : linkCharts(charts, { axis: 'x' });

  const resize = () => {
    const height = options.height || host.clientHeight || 0;
    const nextUsable = Math.max(specs.length * 56, height - gap * Math.max(0, specs.length - 1));
    for (const entry of created) {
      const weight = Math.max(0.0001, entry.spec.weight === undefined ? 1 : entry.spec.weight);
      const minHeight = entry.spec.minHeight === undefined ? 56 : entry.spec.minHeight;
      const paneHeight = Math.max(minHeight, Math.round((nextUsable * weight) / totalWeight));
      entry.holder.style.height = `${paneHeight}px`;
      const width = Math.max(240, Math.round(entry.holder.clientWidth));
      entry.chart.resize(width, paneHeight);
    }
  };

  const syncDomains = () => {
    const source = charts[0];
    if (!source) return;
    const domain = source.getDomain('x');
    if (!domain || domain.length < 2) return;
    for (const chart of charts) {
      if (chart === source) continue;
      chart.silent(() => chart.setDomain('x', [domain[0], domain[domain.length - 1]]));
    }
  };

  /** 重新应用某一格（重新求值 option → 重新注入 → setOption）。 */
  const applyPane = (
    entry: (typeof created)[number],
    applyOptions?: { animate?: boolean | 'enter' | 'update'; preserveView?: boolean }
  ) => {
    const prepared = prepareOption(entry.spec);
    entry.current = prepared;
    const options = {
      animate: applyOptions && applyOptions.animate !== undefined ? applyOptions.animate : false,
      preserveView: applyOptions && applyOptions.preserveView !== undefined ? applyOptions.preserveView : true,
    };
    if (entry.spec.primary) {
      entry.chart.setOption(toTradingOption(prepared as TradingChartOption, (entry.spec.extras || {}) as never), options);
    } else {
      entry.chart.setOption(prepared, options);
    }
  };

  const refresh = (applyOptions?: { animate?: boolean | 'enter' | 'update'; preserveView?: boolean }) => {
    for (const entry of created) applyPane(entry, applyOptions);
    syncDomains();
  };

  const setPaneOption = (id: string, option: ChartOption | TradingChartOption) => {
    const entry = created.find((item) => item.spec.id === id);
    if (!entry) return;
    const prepared = prepareOption(entry.spec, option);
    entry.current = prepared;
    if (entry.spec.primary) {
      entry.chart.setOption(toTradingOption(prepared as TradingChartOption, (entry.spec.extras || {}) as never), {
        animate: false,
        preserveView: true,
      });
    } else {
      entry.chart.setOption(prepared, { animate: false, preserveView: true });
    }
  };

  const destroy = () => {
    for (const entry of created) {
      entry.chart.destroy();
      if (entry.holder.parentNode) entry.holder.parentNode.removeChild(entry.holder);
    }
    created.length = 0;
  };

  resize();

  return {
    charts,
    chartOf: (id: string) => {
      const found = created.find((entry) => entry.spec.id === id);
      return found ? found.chart : null;
    },
    holderOf: (id: string) => {
      const found = created.find((entry) => entry.spec.id === id);
      return found ? found.holder : null;
    },
    resize,
    refresh,
    setPaneOption,
    syncDomains,
    destroy,
    link: handle,
  };
}
