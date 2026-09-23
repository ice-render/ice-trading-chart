import { formatPrice, formatVolume } from './format';

/**
 * **文案目录**：本包渲染到界面上的每一句话都从这里取。
 *
 * 为什么要有一层目录，而不是像早先那样零散地传 `labels`：库自己会渲染东西，而**库不知道用户
 * 说什么语言**。目录把「库渲染的文案」集中到一个可注入的对象上，接入方只要传一份自己的目录
 * （或 `'zh'` / `'en'` 预设），界面上的字就全变了 —— 不必记住「哪个组件有哪个 label 选项」。
 *
 * 覆盖范围（就是库里所有会显示出来的文本）：
 * - `tooltip`：OHLC 提示框的四价与量；
 * - `orderBook`：盘口表头三列；
 * - `indicators`：均线 / 布林 / MACD / RSI 的**序列名**（图例开着时可见）。
 *
 * 不在这一层的是：
 * - **数字与日期**：那是格式化问题，走 `TerminalNumberFormat`（见下）与坐标轴的 `formatter`；
 * - 应用自己的界面文案（面板标题、提示行、账户区）—— 那是应用的事，示例页演示了怎么接
 *   （`data-i18n` + 一个目录对象）。**注意：工具条的文案不在此列** —— 工具条自 2026-09-23 起
 *   属于图表本身（见 `toolbar.ts`），它的文案走 `toolbar` 段。
 */
export interface TerminalMessages {
  tooltip: {
    /** 提示框里四价与量的行名。 */
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
  };
  orderBook: {
    price: string;
    size: string;
    total: string;
  };
  /**
   * **工具条**的文案。
   *
   * 2026-09-23 起它属于这一层 —— 用户定了「工具条是图表的一部分」，所以图标、主题、文案、状态
   * 同步四件事都收敛到库里；在此之前这里写的是「工具栏是应用的事」，那条理由已经不成立。
   */
  toolbar: {
    intervals: string;
    type: string;
    indicators: string;
    drawings: string;
    display: string;
    /** 指标清单为空时面板里的一句话。 */
    none: string;
    chartTypes: { id: string; label: string }[];
    drawingTools: { id: string; label: string }[];
  };
  indicators: {
    /** 均线 / 指数均线 / 布林带的序列名（图例可见）。 */
    ma: (period: number) => string;
    ema: (period: number) => string;
    boll: (period: number) => string;
    macd: string;
    dif: string;
    dea: string;
    rsi: (period: number) => string;
  };
}

/** 中文（默认）。 */
export const ZH_TERMINAL_MESSAGES: TerminalMessages = {
  tooltip: { open: '开', high: '高', low: '低', close: '收', volume: '量' },
  orderBook: { price: '价格', size: '数量', total: '合计' },
  toolbar: {
    intervals: '周期',
    type: '图表类型',
    indicators: '指标',
    drawings: '画线',
    display: '显示',
    none: '暂无可用指标',
    chartTypes: [
      { id: 'candlestick', label: '蜡烛图' },
      { id: 'line', label: '分时 / 折线' },
    ],
    drawingTools: [
      { id: 'hline', label: '水平线' },
      { id: 'vline', label: '垂直线' },
      { id: 'trend', label: '趋势线' },
      { id: 'rect', label: '区间矩形' },
      { id: 'none', label: '不画线' },
    ],
  },
  indicators: {
    ma: (period) => `MA${period}`,
    ema: (period) => `EMA${period}`,
    boll: (period) => `BOLL(${period})`,
    macd: 'MACD',
    dif: 'DIF',
    dea: 'DEA',
    rsi: (period) => `RSI${period}`,
  },
};

/** 英文。 */
export const EN_TERMINAL_MESSAGES: TerminalMessages = {
  tooltip: { open: 'Open', high: 'High', low: 'Low', close: 'Close', volume: 'Vol' },
  orderBook: { price: 'Price', size: 'Size', total: 'Total' },
  toolbar: {
    intervals: 'Interval',
    type: 'Chart type',
    indicators: 'Indicators',
    drawings: 'Drawings',
    display: 'Display',
    none: 'No indicators',
    chartTypes: [
      { id: 'candlestick', label: 'Candles' },
      { id: 'line', label: 'Line' },
    ],
    drawingTools: [
      { id: 'hline', label: 'Horizontal' },
      { id: 'vline', label: 'Vertical' },
      { id: 'trend', label: 'Trend' },
      { id: 'rect', label: 'Rectangle' },
      { id: 'none', label: 'None' },
    ],
  },
  indicators: {
    ma: (period) => `MA${period}`,
    ema: (period) => `EMA${period}`,
    boll: (period) => `BOLL(${period})`,
    macd: 'MACD',
    dif: 'DIF',
    dea: 'DEA',
    rsi: (period) => `RSI${period}`,
  },
};

/** 默认目录（与历史行为一致：中文）。 */
export const DEFAULT_TERMINAL_MESSAGES = ZH_TERMINAL_MESSAGES;

/**
 * 预设名或补丁 → 完整目录。**分组深合并**：只覆盖 `tooltip.open` 不会把 `tooltip` 其余字段清空。
 */
export function resolveTerminalMessages(patch?: Partial<TerminalMessages> | 'zh' | 'en'): TerminalMessages {
  const base = patch === 'en' ? EN_TERMINAL_MESSAGES : ZH_TERMINAL_MESSAGES;
  if (!patch || typeof patch === 'string') {
    return { ...base, tooltip: { ...base.tooltip }, orderBook: { ...base.orderBook }, toolbar: { ...base.toolbar }, indicators: { ...base.indicators } };
  }
  return {
    tooltip: { ...base.tooltip, ...(patch.tooltip || {}) },
    orderBook: { ...base.orderBook, ...(patch.orderBook || {}) },
    toolbar: { ...base.toolbar, ...(patch.toolbar || {}) },
    indicators: { ...base.indicators, ...(patch.indicators || {}) },
  };
}

/**
 * **数字格式化**：签名的唯一契约。库渲染的数字（价格轴刻度、提示框里的价与量）都从这里出。
 *
 * `precision` 是「固定小数位」，不给就按 `formatPrice` 的老口径（最多 6 位、去尾随 0）。
 */
export type TerminalNumberFormat = (value: number, precision?: number) => string;

/** 成交量格式化（默认 K / M / B 缩写）。 */
export type TerminalVolumeFormat = (value: number) => string;

/** 默认数字格式（千分位 + 固定小数位）。 */
export const DEFAULT_NUMBER_FORMAT: TerminalNumberFormat = (value, precision) => formatPrice(value, precision);

/** 默认成交量格式（K / M / B）。 */
export const DEFAULT_VOLUME_FORMAT: TerminalVolumeFormat = (value) => formatVolume(value);

/**
 * 按 **locale** 造一个数字格式（内部用 `Intl.NumberFormat`，实例按「locale + 小数位」缓存）。
 *
 * ```ts
 * createTradingChart(canvas, option, { numberFormat: createIntlNumberFormat('de-DE') });
 * // 42 300.5 → "42.300,50"
 * ```
 *
 * 环境没有 `Intl`（极老的运行环境 / 非浏览器）时自动退回默认格式，不会抛。
 */
export function createIntlNumberFormat(locale: string, options: Intl.NumberFormatOptions = {}): TerminalNumberFormat {
  const cache = new Map<string, Intl.NumberFormat>();
  return (value, precision) => {
    if (!isFinite(value)) return '-';
    const digits = precision === undefined || precision === null ? undefined : Math.min(8, Math.max(0, Math.round(Number(precision))));
    const key = `${locale}|${digits === undefined ? 'auto' : digits}`;
    try {
      let formatter = cache.get(key);
      if (!formatter) {
        formatter = new Intl.NumberFormat(locale, {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits === undefined ? 6 : digits,
          ...options,
        });
        cache.set(key, formatter);
      }
      return formatter.format(value);
    } catch {
      return DEFAULT_NUMBER_FORMAT(value, precision);
    }
  };
}
