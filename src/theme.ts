import type { ChartTheme } from '@damoqiongqiu/ice-chart';

/**
 * **交易终端主题**：一套 token 同时驱动三处外观 ——
 *
 * 1. **图表**（`createPaneStack` / `createTradingChart`）：`terminalThemeToChartTheme()` 把 token
 *    映射成 ice-chart 的 `Partial<ChartTheme>`，再经 ice-chart 的主题桥推到 **ice-render 的引擎主题**
 *    （`chartThemeToEnginePatch` → `applyChartThemeToEngine`）—— 也就是说不必自己碰引擎的
 *    `setTheme`，整条链路是通的；
 * 2. **外围组件**（盘口 `createOrderBook`）：直接吃同一份 token（面板底 / 边框 / 文字 / 涨跌色）；
 * 3. **页面外壳**（HTML/CSS 画的抬头、价签、工具栏、表格）：`applyTerminalTheme()` 把 token
 *    写成一组 CSS 变量，页面只需要在样式里用 `var(--panel)` 这些名字。
 *
 * 为什么要这一层：早先这三处各写各的颜色（页面一套 CSS 变量、盘口一套硬编码、图表一套
 * partial theme），换一次配色要改三个地方，而且盘口根本改不动。现在**一处 token、三处生效**，
 * 换肤（深色 / 浅色 / 自家品牌色）只要传一个对象。
 */
export interface TerminalTheme {
  /** 页面底色。 */
  background: string;
  /** 面板底色。 */
  panel: string;
  /** 面板内层（下拉、输入框、次级块）。 */
  panel2: string;
  /** 边框 / 更淡的分隔。 */
  line: string;
  lineSoft: string;
  /** 正文 / 次要 / 弱化三档文字色。 */
  text: string;
  dim: string;
  muted: string;
  /** 强调色（品牌色）与压在它上面的文字色。 */
  accent: string;
  accentInk: string;
  /** 涨 / 跌（蜡烛、盘口两侧、买卖按钮都按它取）。 */
  up: string;
  down: string;
  /** 图表内部：网格线 / 轴线 / 轴标签。 */
  grid: string;
  axisLine: string;
  axisLabel: string;
  /** 十字准星虚线与水印。 */
  ruler: string;
  watermark: string;
  /** 跨天的会话分隔线（很淡，深浅两套要各自给）。 */
  sessionLine: string;
  /** 界面字体与数字字体（数字用等宽，报价才对得齐）。 */
  fontFamily: string;
  monoFamily: string;
  /** 图表字号（刻度 / 提示框）。 */
  fontSize: number;
}

/** 深色盘面（默认）。 */
export const DARK_TERMINAL_THEME: TerminalTheme = {
  background: '#0b0e11',
  panel: '#181a20',
  panel2: '#1e2329',
  line: '#2b3139',
  lineSoft: '#21262e',
  text: '#eaecef',
  dim: '#b7bdc6',
  muted: '#848e9c',
  accent: '#f0b90b',
  accentInk: '#0b0e11',
  up: '#0ecb81',
  down: '#f6465d',
  grid: '#1c2126',
  axisLine: '#2b3139',
  axisLabel: '#848e9c',
  ruler: 'rgba(132, 142, 156, 0.66)',
  watermark: 'rgba(234, 236, 239, 0.04)',
  sessionLine: 'rgba(255, 255, 255, 0.05)',
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
  monoFamily: "'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: 11,
};

/** 浅色盘面（同一套语义，只是明暗反过来）。 */
export const LIGHT_TERMINAL_THEME: TerminalTheme = {
  ...DARK_TERMINAL_THEME,
  background: '#ffffff',
  panel: '#fafafa',
  panel2: '#f0f1f2',
  line: '#eaecef',
  lineSoft: '#f0f1f2',
  text: '#1e2329',
  dim: '#474d57',
  muted: '#848e9c',
  accent: '#f0b90b',
  accentInk: '#1e2329',
  grid: '#f0f1f2',
  axisLine: '#eaecef',
  axisLabel: '#848e9c',
  ruler: 'rgba(132, 142, 156, 0.55)',
  watermark: 'rgba(30, 35, 41, 0.05)',
  sessionLine: 'rgba(30, 35, 41, 0.07)',
};

/** 主题变量名（`applyTerminalTheme` 写、页面 CSS 读；改名字要两边一起改）。 */
export const TERMINAL_THEME_VARS = {
  background: '--bg',
  panel: '--panel',
  panel2: '--panel-2',
  line: '--line',
  lineSoft: '--line-soft',
  text: '--text',
  dim: '--dim',
  muted: '--muted',
  accent: '--accent',
  accentInk: '--accent-ink',
  up: '--up',
  down: '--down',
  ruler: '--ruler',
  sessionLine: '--session-line',
  fontFamily: '--font',
  monoFamily: '--mono',
} as const;

/** 预设名或补丁 → 完整主题。 */
export function resolveTerminalTheme(patch?: Partial<TerminalTheme> | 'dark' | 'light'): TerminalTheme {
  if (patch === 'light') return { ...LIGHT_TERMINAL_THEME };
  if (patch === 'dark' || !patch) return { ...DARK_TERMINAL_THEME };
  return { ...DARK_TERMINAL_THEME, ...patch };
}

/**
 * 终端主题 → 图表主题（喂给 `createPaneStack({ theme })`，或自己 `setOption` 的 `option.theme`）。
 *
 * 只映射「图表自己画的东西」：背景 / 轴 / 网格 / 图例 / 提示框 / 准星 / 选中态。
 * 蜡烛的涨跌色不在这里 —— 那是**系列 option**（`candle.upColor` / `downColor`），
 * 因为同一张图上不同系列可以有不同配色。
 */
export function terminalThemeToChartTheme(theme: TerminalTheme): Partial<ChartTheme> {
  return {
    backgroundColor: theme.background,
    textColor: theme.text,
    subTextColor: theme.muted,
    axisLineColor: theme.axisLine,
    axisLabelColor: theme.axisLabel,
    splitLineColor: theme.grid,
    fontFamily: theme.monoFamily,
    fontSize: theme.fontSize,
    labelHaloColor: theme.background,
    legend: { textColor: theme.dim, inactiveColor: theme.muted },
    tooltip: {
      background: theme.panel2,
      borderColor: theme.line,
      textColor: theme.text,
      shadowColor: theme.ruler,
      fontSize: theme.fontSize + 1,
      padding: 10,
      radius: 6,
    },
    crosshair: { lineColor: theme.ruler, labelBackground: theme.muted, labelColor: theme.background },
    brush: { fill: 'rgba(240, 185, 11, 0.14)', stroke: theme.accent },
    selection: { stroke: theme.accent, dimOpacity: 0.3 },
  };
}

/**
 * 把主题写成 CSS 变量（挂在 `document.documentElement` 上，页面 CSS 直接 `var(--panel)`）。
 *
 * 页面外壳是 HTML 画的（库不管），所以这里只做「token → 变量名」这一件事，
 * 让页面和图表 / 盘口共享同一份颜色来源。
 */
export function applyTerminalTheme(theme: TerminalTheme, root?: HTMLElement | null): void {
  const target = root || (typeof document !== 'undefined' ? document.documentElement : null);
  if (!target) return;
  for (const key of Object.keys(TERMINAL_THEME_VARS) as Array<keyof typeof TERMINAL_THEME_VARS>) {
    target.style.setProperty(TERMINAL_THEME_VARS[key], String(theme[key]));
  }
}
