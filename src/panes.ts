import { DARK_CHART_THEME, LIGHT_CHART_THEME, createChart, linkCharts } from '@damoqiongqiu/ice-chart';
import type { AxisOption, ChartOption, ChartTheme, ICEChart } from '@damoqiongqiu/ice-chart';
import type { ChartLinkHandle } from '@damoqiongqiu/ice-chart';
import { toTradingOption } from './chart';
import { registerTradingSeries } from './register';
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

/**
 * 数值轴刻度密度：**一档大概占多少像素**（默认值，实际用「主题字号 × 2.5」）。
 *
 * 口径照主流看盘软件：**一档留出 `字号 × 2.5` 的高度**（字号 12 → 30px）。
 * 他们的步长梯子里有 2.5（1/2/2.5/5），落点均匀；我们的引擎只给 1/2/5，
 * 所以取「**离目标最近**」的那一档（见 `axisTickCount`），实测一档落在 19~47px。
 */
export const DEFAULT_AXIS_TICK_SPACING = 30;

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
  /**
   * pane 之间的分隔线高度（px），默认 **1**。
   *
   * 主流终端库的默认就是 1 像素的分隔线（外加一个更宽的透明拖拽热区）——
   * 这个值一大，副图看着就和主图「不像一体」。
   */
  gap?: number;
  /** 分隔线颜色，默认一条很淡的白线。传 `'transparent'` 就是纯留白。 */
  separatorColor?: string;
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
  /**
   * 换主题（深色 / 浅色 / 自定义片段），立即重画三块 pane。
   *
   * 为什么要有这个方法：主题是在**建栈那一刻**解析好的（等宽字体、字号、配色都从它来），
   * 之后每次 `refresh()` 注入的还是那一份 —— 光改 `option.theme` 不会生效。
   * 页面切换深浅色时调它（或直接重建整摞 pane，但那会把缩放窗口 / 画线一起丢掉）。
   */
  setTheme(theme: PaneStackOptions['theme']): void;
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

/**
 * 引擎给一个跨度配一个档数时落到的步长：`raw = span / count` **严格向上**取到
 * 1 / 2 / 5 × 10^k 里的一档（raw 正好落在 10^k 上也往上走一格）。
 * 例：400 / 8 = 50 → 50；400 / 7 = 57.1 → 100；1000 / 10 = 100 → 200。
 */
function engineStep(span: number, count: number): number {
  const raw = span / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const residual = raw / magnitude;
  const factor = residual >= 5 ? 10 : residual >= 2 ? 5 : 2;
  return factor * magnitude;
}

/**
 * 走一遍引擎的完整链路，算出**真正画出来的那一步**有多宽。
 *
 * 引擎是两步走：① `niceDomain` 用 `niceStep(跨度, 档数)` 把数据域向外取整；
 * ② 刻度再对**取整后的域**做一次 `niceStep(域跨度, 档数)`。两次向上取整会叠在一起 ——
 * 实测：跨度 957、档数 11 时第一步得到 100（域变成 [40800, 41900]，跨度 1100），
 * 第二步 `1100 / 11 = 100` 又往上走一格 → **200**，一档 57px，比目标稀一倍。
 * 所以「想要多少档」不能直接丢给引擎，得把这条链路模拟出来再反推。
 */
function simulatedTickStep(min: number, max: number, count: number, nice: boolean): number {
  const span = max - min;
  if (!nice) return engineStep(span, count);
  const domainStep = engineStep(span, count);
  const from = Math.floor(min / domainStep) * domainStep;
  const to = Math.ceil(max / domainStep) * domainStep;
  return engineStep(to - from, count);
}

/** `axisTickCount` 的参数。 */
export interface AxisTickCountOptions {
  /** 一档大概占多少像素，默认 `DEFAULT_AXIS_TICK_SPACING`（栈里传的是「主题字号 × 2.5」）。 */
  spacing?: number;
  /** 该轴的 `nice` 是不是开着（默认开）；关掉的话引擎不会先取整数据域。 */
  nice?: boolean;
}

/**
 * 由「数据域 + 轴长（px）」反推数值轴该给**多少档**刻度（返回 0 = 不干预）。
 *
 * 为什么不直接把「想要几档」传进去：引擎把 `跨度 / 档数` 向上取到 1 / 2 / 5 × 10^k，
 * 而且**取两次**（先取数据域、再取刻度，见 `simulatedTickStep`）。直接拍档数会在
 * 跨越 10^k 的地方突然稀一半，加大档数还经常救不回来（1000 / 8 → 125 → 200，一档 57px）。
 *
 * 所以这里把 2~24 档全模拟一遍，取**落到的步长离目标最近**的那一档（按对数距离，
 * 于是「粗一倍」和「细一倍」一样糟）。目标 = `一档占 spacing 像素` 对应的步长。
 * 因为步长梯子是 1/2/5，实际一档会落在 `spacing / √2.5 ~ spacing × √2.5` 之间
 * （目标 30px 时是 19~47px）—— 比默认 5 档时的 57~71px 密得多，缩放 / 平移时也不会漂。
 *
 * 只在**两端都显式写了 min / max** 的数值轴上用它（见 `alignAxes`）：跨度是 option 里的常量，
 * 不会因为刻度数变化而回馈震荡（引擎会拿 `tickCount` 去 nice 数据域）。
 */
export function axisTickCount(min: number, max: number, length: number, options: AxisTickCountOptions = {}): number {
  const from = Number(min);
  const to = Number(max);
  const lengthValue = Number(length);
  if (!isFinite(from) || !isFinite(to) || !(to > from)) return 0;
  if (!isFinite(lengthValue) || !(lengthValue > 0)) return 0;
  const rawSpacing = Number(options.spacing);
  const spacing = isFinite(rawSpacing) && rawSpacing > 0 ? rawSpacing : DEFAULT_AXIS_TICK_SPACING;
  const nice = options.nice !== false;
  const span = to - from;
  const target = (span * spacing) / lengthValue;
  const MIN = 2;
  const MAX = 24;
  let best = 0;
  let bestDistance = Infinity;
  for (let count = MIN; count <= MAX; count++) {
    const step = simulatedTickStep(from, to, count, nice);
    const distance = Math.abs(Math.log(step / target));
    // 严格更近才换（同一个落点取档数少的那个）
    if (distance < bestDistance - 1e-9) {
      bestDistance = distance;
      best = count;
    }
  }
  return best;
}

/**
 * 把一格 option 的 y 轴规整成数组、装定宽 formatter，并在缺 `tickCount` 时按密度补上。
 *
 * `views` 是这一格**现在显示中**的 y 窗口（每根轴一个）。为什么要它而不是直接用 option 里的
 * `min` / `max`：手动量程（纵向拖 / 标尺缩放过）之后，显示中的窗口和 option 里那一段不是一个东西 ——
 * 拿后者算密度，会出现「窗口已经缩到 275 宽、档数还是按 501 宽给的 12 档」，
 * 一档当场稀到 52px（实测）。窗口是引擎按当前视图给的，拿它算才是所见即所得。
 * 视图窗口已经是引擎取整过的域，刻度只会再取整一次，所以这时 `nice` 传 `false`。
 */
function alignAxes(
  option: ChartOption,
  chars: number,
  length: number,
  spacing: number,
  views: Array<[number, number] | null> = []
): AxisOption[] {
  const raw = option.yAxis;
  const axes: AxisOption[] = Array.isArray(raw) ? raw.map((axis) => ({ ...axis })) : [{ ...(raw || {}) }];
  if (!axes.length) axes.push({});
  return axes.map((axis, index) => {
    const next: AxisOption = { ...axis, formatter: composeAxisFormatter(axis, chars) };
    if (next.tickCount === undefined) {
      const view = views[index];
      const count = view
        ? axisTickCount(view[0], view[1], length, { nice: false, spacing })
        : axisTickCount(Number(next.min), Number(next.max), length, { nice: next.nice !== false, spacing });
      if (count > 0) next.tickCount = count;
    }
    return next;
  });
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
  const gap = options.gap === undefined ? 1 : options.gap;
  const separatorColor = options.separatorColor === undefined ? 'rgba(255, 255, 255, 0.08)' : options.separatorColor;
  const chars = options.axisLabelChars === undefined ? DEFAULT_AXIS_LABEL_CHARS : options.axisLabelChars;
  let theme = baseTheme(options.theme);
  // 刻度密度的下限跟着主题字号走（字号 × 2）—— 换字号时密度不会突然变陌生
  let tickSpacing = 2.5 * (Number(theme.fontSize) > 0 ? Number(theme.fontSize) : 12);
  const dpr = resolveDpr(options.dpr);
  const host = container;
  const created: Array<{ spec: PaneSpec; holder: HTMLDivElement; canvas: HTMLCanvasElement; chart: ICEChart; current: ChartOption }> = [];

  // candlestick 是自定义系列：注册一次（幂等），之后每块画布都走 createChart
  registerTradingSeries();
  host.style.position = host.style.position || 'relative';

  /**
   * 某一格**绘图区**的高度（px）：只有建好图之后才量得到，所以首帧传 0 ——
   * 首帧用引擎默认档数，紧接着 `applyPane` 再用量到的真实高度补一次（见下面的创建循环）。
   */
  const plotHeightOf = (entry: { chart?: ICEChart }): number => {
    const plot = entry.chart && entry.chart.layout ? entry.chart.layout.plot : null;
    return plot && isFinite(plot.height) ? plot.height : 0;
  };

  /** 某一格**显示中**的 y 窗口（每根轴一个）——手动量程时它和 option 里的 `min` / `max` 不同。 */
  const viewAxesOf = (entry: { chart?: ICEChart }): Array<[number, number] | null> => {
    const chart = entry.chart;
    if (!chart || !chart.norm || !chart.norm.yAxes) return [];
    return chart.norm.yAxes.map((_axis, index) => {
      const domain = chart.getAxisDomain(index);
      if (!domain || domain.length !== 2) return null;
      const from = Number(domain[0]);
      const to = Number(domain[1]);
      return isFinite(from) && isFinite(to) && to > from ? ([from, to] as [number, number]) : null;
    });
  };

  /**
   * 把一格的 option 求值 → 补交易语义（primary 走 `toTradingOption`）→ 注入
   * 「等宽主题 + 定宽刻度 + 刻度密度」。
   *
   * ⚠️ 顺序不能反：定宽 formatter 是**包在外层**的，必须包在**最终**那个 formatter 上 ——
   * 先包一层空壳、再让 `toTradingOption` 往里塞报价精度（`pricePrecision`），
   * 它看到「已经有 formatter 了」就会让路，两位数小数就永远加不上（实测踩到）。
   */
  const prepareOption = (
    spec: PaneSpec,
    override?: ChartOption | TradingChartOption,
    length = 0,
    views: Array<[number, number] | null> = []
  ): ChartOption => {
    const raw = (override || (typeof spec.option === 'function' ? spec.option() : spec.option)) as TradingChartOption;
    const trading = spec.primary
      ? toTradingOption(raw, (spec.extras || {}) as never)
      : (raw as ChartOption);
    const axes = alignAxes(trading, chars, length, tickSpacing, views);
    return {
      ...trading,
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
    if (index > 0 && gap > 0) {
      const separator = document.createElement('div');
      separator.dataset.paneSeparator = spec.id;
      separator.style.height = `${gap}px`;
      separator.style.background = separatorColor;
      host.appendChild(separator);
    }
    const holder = document.createElement('div');
    holder.dataset.paneId = spec.id;
    holder.style.position = 'relative';
    holder.style.height = `${Math.max(minHeight, Math.round((usable * weight) / totalWeight))}px`;
    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    holder.appendChild(canvas);
    host.appendChild(holder);

    // `prepareOption` 里已经补过交易语义（primary 走 toTradingOption），这里统一 createChart ——
    // 再走一遍 createTradingChart 等于把补过的语义又补一次（工具提示 formatter 那层的判断会变得绕）。
    const prepared = prepareOption(spec);
    const chart = createChart(canvas, prepared, { dpr });

    created.push({ spec, holder, canvas, chart, current: prepared });
  });

  const charts = created.map((entry) => entry.chart);
  const handle = options.link === false || charts.length < 2 ? null : linkCharts(charts, { axis: 'x' });

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
    const prepared = prepareOption(entry.spec, undefined, plotHeightOf(entry), viewAxesOf(entry));
    entry.current = prepared;
    const options = {
      animate: applyOptions && applyOptions.animate !== undefined ? applyOptions.animate : false,
      preserveView: applyOptions && applyOptions.preserveView !== undefined ? applyOptions.preserveView : true,
    };
    entry.chart.setOption(prepared, options);
  };

  const refresh = (applyOptions?: { animate?: boolean | 'enter' | 'update'; preserveView?: boolean }) => {
    for (const entry of created) applyPane(entry, applyOptions);
    syncDomains();
  };

  /** 换主题：重新解析 token，再按新主题把三块 pane 重新求值 + 应用一遍。 */
  const setTheme = (next: PaneStackOptions['theme']) => {
    theme = baseTheme(next);
    tickSpacing = 2.5 * (Number(theme.fontSize) > 0 ? Number(theme.fontSize) : 12);
    for (const entry of created) {
      applyPane(entry);
    }
    syncDomains();
  };

  const setPaneOption = (id: string, option: ChartOption | TradingChartOption) => {
    const entry = created.find((item) => item.spec.id === id);
    if (!entry) return;
    const prepared = prepareOption(entry.spec, option, plotHeightOf(entry), viewAxesOf(entry));
    entry.current = prepared;
    entry.chart.setOption(prepared, { animate: false, preserveView: true });
  };

  /**
   * 重新按容器尺寸排布。
   *
   * ⚠️ 尺寸算完之后**必须再应用一遍 option**：刻度密度是按「绘图区高度 ÷ 一档的最小像素」
   * 反推的（`alignAxes`），而绘图区高度只有排完之后才知道 —— 首帧建图时量到的是画布的
   * 默认尺寸，不重算的话档数会一直按那个尺寸走（实测：600px 的容器被算成 ~91px，
   * 价格轴只剩 4 档）。容器尺寸变化时同理。
   */
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
    for (const entry of created) {
      if (plotHeightOf(entry) > 0) applyPane(entry);
    }
  };

  const destroy = () => {
    for (const entry of created) {
      entry.chart.destroy();
      if (entry.holder.parentNode) entry.holder.parentNode.removeChild(entry.holder);
    }
    for (const node of Array.from(host.querySelectorAll('[data-pane-separator]'))) {
      if (node.parentNode) node.parentNode.removeChild(node);
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
    setTheme,
    setPaneOption,
    syncDomains,
    destroy,
    link: handle,
  };
}
