import { resolveTerminalMessages } from './messages';
import type { TerminalMessages } from './messages';
import { resolveTerminalTheme } from './theme';
import type { TerminalTheme } from './theme';

/**
 * 盘口（买卖十档）。
 *
 * 为什么放在本包：盘口是**交易专属**的 UI，通用图表库不该认识它，而本包的定位就是
 * 「交易语义的唯一落点」。图表部分照旧走 `createPaneStack` / `createTradingChart`，
 * 盘口这类外围由本组件承担。
 *
 * 设计约定：
 * - **结构只建一次**（一档一行），`update()` 只改数值与深度条宽度 —— 不整段重建 DOM；
 * - 变更按**签名**去重，数据没变时一次 DOM 都不写（伪实时页面每帧都在推数据）；
 * - 组件自带样式（注入一次，id 守卫），页面不需要为它写 CSS；
 * - 点某一档通过 `onPickPrice` 回调抛给应用（例如填进下单表单）。
 */

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface OrderBookData {
  /** 卖盘，**从最优价（最接近中间价）到最远**。 */
  asks: OrderBookLevel[];
  /** 买盘，同样从最优价开始。 */
  bids: OrderBookLevel[];
}

/**
 * 盘口视图：双向 / 仅买 / 仅卖。
 *
 * 主流合约盘的标配（窄面板里只看一侧很常见）。这里**只做呈现**：
 * 三种视图用同一份结构，切换只是显隐，不重建 DOM —— 与组件「结构只建一次」的约定一致。
 */
export type OrderBookView = 'both' | 'bids' | 'asks';

/**
 * **按价格步长聚合档位**（纯函数，可单测）。
 *
 * 盘口聚合是交易盘的标配：原始档位可能细到 0.01，屏幕只放得下十档，
 * 聚合到 1 / 10 才能看到更深的簿子。规则与主流盘口一致：
 * - 价格落到「步长的网格」上：买单向下取整、卖单向上取整（都不穿过自己的价格）；
 * - 同一格的量**相加**；
 * - 输出顺序与输入约定一致（买盘从高到低、卖盘从低到高）。
 *
 * `step <= 0` 或非有限值时**原样返回**（等于不聚合）。聚合后同一格里的量可能为 0/负数，
 * 这里不判合法性 —— 数据本来就该由行情源保证。
 */
export function aggregateLevels(levels: OrderBookLevel[], step: number, side: 'ask' | 'bid'): OrderBookLevel[] {
  if (!Array.isArray(levels) || !levels.length) return [];
  if (!isFinite(step) || step <= 0) return levels.slice();
  const buckets = new Map<number, number>();
  for (const level of levels) {
    if (!level || !isFinite(level.price)) continue;
    const snap = side === 'ask' ? Math.ceil(level.price / step) * step : Math.floor(level.price / step) * step;
    // 浮点误差：0.1 的步长会算出 742.3000000000001 这种键，统一收到 1e-9
    const key = Math.round(snap * 1e9) / 1e9;
    buckets.set(key, (buckets.get(key) ?? 0) + (isFinite(level.size) ? level.size : 0));
  }
  const prices = [...buckets.keys()].sort(side === 'ask' ? (a, b) => a - b : (a, b) => b - a);
  return prices.map((price) => ({ price, size: buckets.get(price) as number }));
}

export interface OrderBookOptions {
  /** 每侧的档数，默认 **10**。 */
  levels?: number;
  /** 价格格式化，默认两位小数。 */
  priceFormat?: (price: number) => string;
  /** 数量格式化，默认两位小数。 */
  sizeFormat?: (size: number) => string;
  /**
   * **跌色**（卖盘用）。合约盘面的惯例是「卖盘偏跌、买盘偏涨」：
   * 涨绿跌红的盘面上卖盘就是红的、买盘是绿的；换成涨红跌绿时两边跟着翻。
   */
  downColor?: string;
  /** **涨色**（买盘用）。 */
  upColor?: string;
  /** 表头三个列名（优先级：`labels` > `messages.orderBook` > 默认「价格 / 数量 / 合计」）。 */
  labels?: { price?: string; size?: string; total?: string };
  /** 文案目录（列名从它取，'zh' / 'en' 预设或自定义片段）。 */
  messages?: Partial<TerminalMessages> | 'zh' | 'en';
  /**
   * 终端主题（面板底 / 边框 / 文字 / 涨跌色都从它取）。
   *
   * 不传就用深色盘面的默认值 —— 组件自带样式，但**颜色归属主题**：
   * 页面只要把同一份主题给（图表 / 盘口 / CSS 变量），换肤是一处改。
   * 显式给了 `upColor` / `downColor` 时以显式值为准（优先级：选项 > 主题 > 默认）。
   */
  theme?: Partial<TerminalTheme>;
  /** 是否画深度条，默认 true。 */
  showDepth?: boolean;
  /** 初始视图（双向 / 仅买 / 仅卖），默认 `'both'`。 */
  view?: OrderBookView;
  /**
   * 初始**价格聚合步长**（例如 `1` 表示把 742.31 / 742.58 并到同一格）。
   * 默认 `0` = 不聚合，原样显示行情源给的档位。
   */
  priceStep?: number;
  /** 点击某一档的回调。 */
  onPickPrice?: (price: number, side: 'ask' | 'bid') => void;
}

export interface OrderBook {
  /** 根元素（可直接塞进布局）。 */
  readonly element: HTMLElement;
  /**
   * 推一次行情。
   *
   * `mid` 不给就用最优买卖价的中点；`midColor` 用于「最新价按涨跌着色」这类应用侧语义
   * （组件自己不知道该跟谁比，所以颜色由调用方给）。
   */
  update(data: OrderBookData, options?: { mid?: number; midColor?: string }): void;
  /** 换配色（应用切涨跌色时调）。 */
  setPalette(palette: { upColor?: string; downColor?: string }): void;
  /** 换主题（深色 / 浅色 / 自家品牌色）：面板、文字、涨跌色一起跟着走。 */
  setTheme(theme: Partial<TerminalTheme>): void;
  /**
   * 换文案（表头三列）：换语言的入口，只改文字、不重建结构。
   *
   * 第二个参数是显式的列名（带单位那种，例如 `价格 (USDT)`）—— 优先级仍然高于目录。
   */
  setMessages(
    messages?: Partial<TerminalMessages> | 'zh' | 'en',
    labels?: { price?: string; size?: string; total?: string }
  ): void;
  /**
   * 换视图（双向 / 仅买 / 仅卖）。
   *
   * 只动显隐，**不重建结构**；没变的话连下一次重画都省掉。
   * 面板上的按钮由应用自己画（组件不管交互外壳），点了调这里即可。
   */
  setView(view: OrderBookView): void;
  /** 当前视图。 */
  view(): OrderBookView;
  /**
   * 换**价格聚合步长**（`<= 0` 表示不聚合，见 `aggregateLevels`）。
   *
   * 聚合在组件内做，应用照样推**原始**档位 —— 切精度不需要行情源配合，
   * 也不存在「聚合后的数据被当成原始数据再聚合一次」的问题。
   */
  setPriceStep(step: number): void;
  /** 当前聚合步长。 */
  priceStep(): number;
  /** 当前中间价（上一次 update 的结果）。 */
  mid(): number | null;
  /** 当前价差（上一次 update 的结果）。 */
  spread(): number | null;
  destroy(): void;
}

const STYLE_ID = 'ice-trading-order-book-style';

const STYLE = `
.ice-book {
  font: 11px/1.7 var(--ice-book-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  color: var(--ice-book-text, #eaecef);
}
.ice-book-head {
  display: grid; grid-template-columns: 1fr 1fr 1.05fr; gap: 4px; padding: 0 10px 2px;
  color: var(--ice-book-muted, rgba(132, 142, 156, 0.9)); font-size: 10px;
}
.ice-book-head span:nth-child(2), .ice-book-head span:nth-child(3) { text-align: right; }
.ice-book-row { position: relative; display: grid; grid-template-columns: 1fr 1fr 1.05fr; gap: 4px; padding: 1px 10px; cursor: pointer; }
.ice-book-row:hover { background: var(--ice-book-hover, rgba(255, 255, 255, 0.04)); }
.ice-book-depth { position: absolute; top: 1px; bottom: 1px; right: 0; z-index: 0; }
.ice-book-px, .ice-book-sz, .ice-book-tt { position: relative; z-index: 1; }
.ice-book-sz, .ice-book-tt { text-align: right; }
.ice-book-sz { opacity: 0.78; }
.ice-book-tt { opacity: 0.92; }
.ice-book-mid {
  display: flex; align-items: baseline; gap: 8px; padding: 4px 10px;
  border-top: 1px solid var(--ice-book-line, rgba(255, 255, 255, 0.08));
  border-bottom: 1px solid var(--ice-book-line, rgba(255, 255, 255, 0.08));
}
.ice-book-mid b { font-size: 17px; font-weight: 600; }
.ice-book-mid span { font-size: 10px; opacity: 0.6; }
.ice-book-empty { padding: 6px 10px; opacity: 0.55; }
`;

function ensureStyle(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

interface Row {
  root: HTMLElement;
  depth: HTMLElement;
  price: HTMLElement;
  size: HTMLElement;
  total: HTMLElement;
}

/** 步长对应的显示小数位（0.1 → 1 位、1 → 0 位；不聚合时沿用惯例的两位）。 */
function decimalsForStep(step: number): number {
  if (!isFinite(step) || step <= 0) return 2;
  const digits = Math.ceil(-Math.log10(step));
  return Math.max(0, Math.min(8, digits));
}

function defaultPriceFormat(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '-';
  const factor = 10 ** decimals;
  return (Math.round(value * factor) / factor).toFixed(decimals);
}

function defaultSizeFormat(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '-';
}

/** 表头三个列名（优先级：显式 labels > 文案目录 > 默认中文）。 */
function pickLabels(messages?: Partial<TerminalMessages> | 'zh' | 'en', labels?: { price?: string; size?: string; total?: string }) {
  return { ...resolveTerminalMessages(messages).orderBook, ...(labels || {}) };
}

function createRow(side: 'ask' | 'bid', onPick: (price: number, side: 'ask' | 'bid') => void): Row {
  const root = document.createElement('div');
  root.className = 'ice-book-row';
  root.dataset.side = side;
  const depth = document.createElement('i');
  depth.className = 'ice-book-depth';
  const price = document.createElement('span');
  price.className = 'ice-book-px';
  const size = document.createElement('span');
  size.className = 'ice-book-sz';
  const total = document.createElement('span');
  total.className = 'ice-book-tt';
  root.append(depth, price, size, total);
  root.addEventListener('click', () => {
    const raw = root.dataset.price;
    if (raw === undefined) return;
    onPick(Number(raw), side);
  });
  return { root, depth, price, size, total };
}

/**
 * 建一个盘口组件。
 *
 * ```ts
 * const book = createOrderBook(container, { levels: 10, onPickPrice: (price) => form.price = price });
 * book.update({ asks, bids }, lastPrice);
 * ```
 */
export function createOrderBook(container: HTMLElement, options: OrderBookOptions = {}): OrderBook {
  ensureStyle();
  const levels = Math.max(1, Math.round(options.levels === undefined ? 10 : options.levels));
  const showDepth = options.showDepth !== false;
  let view: OrderBookView = options.view || 'both';
  let priceStep = isFinite(Number(options.priceStep)) ? Math.max(0, Number(options.priceStep)) : 0;
  /**
   * 价格格式：应用给了就用应用的；没给就用**步长感知**的默认值
   * （聚合到 1 还显示两位小数会看到 `742.00 / 743.00` —— 数字冗余，主流盘口都跟着步长走）。
   */
  const priceFormat = options.priceFormat || ((value: number) => defaultPriceFormat(value, decimalsForStep(priceStep)));
  const sizeFormat = options.sizeFormat || defaultSizeFormat;
  const pick = options.onPickPrice || (() => undefined);

  let text = pickLabels(options.messages, options.labels);
  const root = document.createElement('div');
  root.className = 'ice-book';
  const head = document.createElement('div');
  head.className = 'ice-book-head';
  const headCells = [document.createElement('span'), document.createElement('span'), document.createElement('span')];
  for (const cell of headCells) head.appendChild(cell);
  const paintHead = () => {
    headCells[0].textContent = text.price;
    headCells[1].textContent = text.size;
    headCells[2].textContent = text.total;
  };
  paintHead();
  const askSide = document.createElement('div');
  askSide.className = 'ice-book-side';
  askSide.dataset.side = 'ask';
  const midRow = document.createElement('div');
  midRow.className = 'ice-book-mid';
  const midPrice = document.createElement('b');
  const midMeta = document.createElement('span');
  midRow.append(midPrice, midMeta);
  const bidSide = document.createElement('div');
  bidSide.className = 'ice-book-side';
  bidSide.dataset.side = 'bid';
  root.append(head, askSide, midRow, bidSide);
  container.appendChild(root);

  // 卖盘从上到下是「最远 → 最优」，所以第 i 行显示的是 asks[levels-1-i]
  const askRows: Row[] = [];
  const bidRows: Row[] = [];
  for (let i = 0; i < levels; i += 1) {
    const ask = createRow('ask', pick);
    askSide.appendChild(ask.root);
    askRows.push(ask);
    const bid = createRow('bid', pick);
    bidSide.appendChild(bid.root);
    bidRows.push(bid);
  }

  let theme = resolveTerminalTheme(options.theme);
  let upColor = options.upColor || theme.up;
  let downColor = options.downColor || theme.down;

  /**
   * 主题 → 组件根节点上的 CSS 变量（面板底 / 边框 / 文字 / 悬停底）。
   *
   * 布局样式仍然是注入一次的 `<style>`（结构不变），**颜色走变量**：
   * 换肤只要重写这几个变量，不必重建 DOM。
   */
  const paintTheme = () => {
    const vars: Record<string, string> = {
      '--ice-book-text': theme.text,
      '--ice-book-muted': theme.muted,
      '--ice-book-line': theme.line,
      '--ice-book-mono': theme.monoFamily,
      '--ice-book-hover': theme.panel2,
    };
    for (const key of Object.keys(vars)) root.style.setProperty(key, vars[key]);
  };
  paintTheme();
  /** 视图 → 两侧与中间价那行的显隐（结构不动，只切 display）。 */
  const paintView = () => {
    askSide.style.display = view === 'bids' ? 'none' : '';
    bidSide.style.display = view === 'asks' ? 'none' : '';
  };
  paintView();
  let lastMid: number | null = null;
  let lastSpread: number | null = null;
  let signature = '';

  const paintSide = (rows: Row[], levelsData: OrderBookLevel[], side: 'ask' | 'bid', maxSize: number) => {
    // 卖盘 = 跌色、买盘 = 涨色（合约盘面的通行口径：卖盘偏向下跌的那一侧）
    const color = side === 'ask' ? downColor : upColor;
    // 「合计」从**最优价**往外累加：`levelsData[0]` 就是最优价
    const totals: number[] = [];
    let running = 0;
    for (const level of levelsData) {
      running += isFinite(level.size) ? level.size : 0;
      totals.push(running);
    }
    for (let i = 0; i < rows.length; i += 1) {
      // 卖盘倒序：数组尾部（最优价）贴着中间价
      const level = side === 'ask' ? levelsData[levelsData.length - 1 - i] : levelsData[i];
      const row = rows[i];
      if (!level) {
        row.root.style.display = 'none';
        delete row.root.dataset.price;
        continue;
      }
      row.root.style.display = '';
      row.root.dataset.price = String(level.price);
      row.price.textContent = priceFormat(level.price);
      row.price.style.color = color;
      row.size.textContent = sizeFormat(level.size);
      // 行 i 对应 `levelsData` 的哪一项：卖盘倒着来，买盘顺着来
      const levelIndex = side === 'ask' ? levelsData.length - 1 - i : i;
      row.total.textContent = sizeFormat(totals[levelIndex]);
      row.depth.style.width = showDepth ? `${Math.max(2, Math.round((level.size / maxSize) * 100))}%` : '0';
      row.depth.style.background = withAlpha(color, 0.13);
    }
  };

  const update = (data: OrderBookData, updateOptions: { mid?: number; midColor?: string } = {}) => {
    const mid = updateOptions.mid;
    // 先按**步长**聚合再取前十档：应用永远推原始档位，切精度不必行情源配合
    const asks = aggregateLevels(data && data.asks ? data.asks : [], priceStep, 'ask').slice(0, levels);
    const bids = aggregateLevels(data && data.bids ? data.bids : [], priceStep, 'bid').slice(0, levels);
    const bestAsk = asks.length ? asks[0].price : null;
    const bestBid = bids.length ? bids[0].price : null;
    const resolvedMid = mid !== undefined ? mid : bestAsk !== null && bestBid !== null ? (bestAsk + bestBid) / 2 : bestAsk !== null ? bestAsk : bestBid;
    const spread = bestAsk !== null && bestBid !== null ? bestAsk - bestBid : null;

    const next = [
      updated(asks),
      updated(bids),
      resolvedMid === null ? '-' : Math.round(resolvedMid * 1e6) / 1e6,
      spread === null ? '-' : Math.round(spread * 1e6) / 1e6,
      upColor,
      downColor,
      updateOptions.midColor || '',
      view,
      String(priceStep),
      priceFormat(1),
    ].join('|');
    const changed = next !== signature;
    signature = next;
    lastMid = resolvedMid === undefined ? null : resolvedMid;
    lastSpread = spread;
    if (!changed) return;

    let maxSize = 0.001;
    for (const level of asks.concat(bids)) if (isFinite(level.size) && level.size > maxSize) maxSize = level.size;

    paintSide(askRows, asks, 'ask', maxSize);
    paintSide(bidRows, bids, 'bid', maxSize);
    midPrice.textContent = resolvedMid === null || resolvedMid === undefined ? '-' : priceFormat(resolvedMid);
    midPrice.style.color = updateOptions.midColor || '';
    midMeta.textContent = spread === null ? '—' : `价差 ${spread.toFixed(2)}`;
  };

  const setPalette = (palette: { upColor?: string; downColor?: string }) => {
    if (palette.upColor) upColor = palette.upColor;
    if (palette.downColor) downColor = palette.downColor;
    signature = ''; // 强制下一次 update 重绘
  };

  /** 换文案：只重写表头三个格（换语言用）。 */
  const setMessages = (
    next?: Partial<TerminalMessages> | 'zh' | 'en',
    labels?: { price?: string; size?: string; total?: string }
  ) => {
    text = pickLabels(next === undefined ? options.messages : next, labels === undefined ? options.labels : labels);
    paintHead();
  };

  /** 换肤：面板 / 文字立刻变，涨跌色跟着主题走（显式给过 upColor / downColor 的不动）。 */
  const setTheme = (next: Partial<TerminalTheme>) => {
    theme = resolveTerminalTheme({ ...theme, ...next });
    if (!options.upColor) upColor = theme.up;
    if (!options.downColor) downColor = theme.down;
    paintTheme();
    signature = '';
  };

  return {
    element: root,
    update,
    setPalette,
    setTheme,
    setMessages,
    setView: (next: OrderBookView) => {
      if (next !== 'both' && next !== 'bids' && next !== 'asks') return;
      if (view === next) return;
      view = next;
      paintView();
      signature = ''; // 视图变了要重画那一屏（两侧的档位可能都换过）
    },
    view: () => view,
    setPriceStep: (step: number) => {
      const next = isFinite(Number(step)) ? Math.max(0, Number(step)) : 0;
      if (priceStep === next) return;
      priceStep = next;
      signature = ''; // 精度变了，档位与格式都要重算
    },
    priceStep: () => priceStep,
    mid: () => lastMid,
    spread: () => lastSpread,
    destroy: () => {
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

/** 一行数据的指纹（用于跳过无变化的 DOM 写入）。 */
function updated(levels: OrderBookLevel[]): string {
  return levels.map((level) => `${level.price}@${level.size}`).join(',');
}

/** 给颜色加透明度：认 `#rgb` / `#rrggbb`，其余（如 rgba()）原样返回。 */
function withAlpha(color: string, alpha: number): string {
  const hex = color.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  if (short) {
    const [, r, g, b] = short;
    return `rgba(${parseInt(r + r, 16)}, ${parseInt(g + g, 16)}, ${parseInt(b + b, 16)}, ${alpha})`;
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (long) {
    const [, r, g, b] = long;
    return `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, ${alpha})`;
  }
  return color;
}
