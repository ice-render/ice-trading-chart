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

export interface OrderBookOptions {
  /** 每侧的档数，默认 **10**。 */
  levels?: number;
  /** 价格格式化，默认两位小数。 */
  priceFormat?: (price: number) => string;
  /** 数量格式化，默认两位小数。 */
  sizeFormat?: (size: number) => string;
  /** 卖盘色（跟随应用的涨色）。 */
  upColor?: string;
  /** 买盘色（跟随应用的跌色）。 */
  downColor?: string;
  /** 是否画深度条，默认 true。 */
  showDepth?: boolean;
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
  /** 当前中间价（上一次 update 的结果）。 */
  mid(): number | null;
  /** 当前价差（上一次 update 的结果）。 */
  spread(): number | null;
  destroy(): void;
}

const STYLE_ID = 'ice-trading-order-book-style';

const STYLE = `
.ice-book { font: 11px/1.7 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.ice-book-row { position: relative; display: grid; grid-template-columns: 1fr 1fr; padding: 1px 10px; cursor: pointer; }
.ice-book-row:hover { background: rgba(255, 255, 255, 0.04); }
.ice-book-depth { position: absolute; top: 1px; bottom: 1px; right: 0; z-index: 0; }
.ice-book-px, .ice-book-sz { position: relative; z-index: 1; }
.ice-book-sz { text-align: right; opacity: 0.72; }
.ice-book-mid {
  display: flex; align-items: baseline; gap: 8px; padding: 4px 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.ice-book-mid b { font-size: 15px; font-weight: 600; }
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
}

function defaultPriceFormat(value: number): string {
  return Number.isFinite(value) ? (Math.round(value * 100) / 100).toFixed(2) : '-';
}

function defaultSizeFormat(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '-';
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
  root.append(depth, price, size);
  root.addEventListener('click', () => {
    const raw = root.dataset.price;
    if (raw === undefined) return;
    onPick(Number(raw), side);
  });
  return { root, depth, price, size };
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
  const priceFormat = options.priceFormat || defaultPriceFormat;
  const sizeFormat = options.sizeFormat || defaultSizeFormat;
  const pick = options.onPickPrice || (() => undefined);

  const root = document.createElement('div');
  root.className = 'ice-book';
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
  root.append(askSide, midRow, bidSide);
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

  let upColor = options.upColor || '#f04438';
  let downColor = options.downColor || '#12d18d';
  let lastMid: number | null = null;
  let lastSpread: number | null = null;
  let signature = '';

  const paintSide = (rows: Row[], levelsData: OrderBookLevel[], side: 'ask' | 'bid', maxSize: number) => {
    const color = side === 'ask' ? upColor : downColor;
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
      row.depth.style.width = showDepth ? `${Math.max(2, Math.round((level.size / maxSize) * 100))}%` : '0';
      row.depth.style.background = withAlpha(color, 0.13);
    }
  };

  const update = (data: OrderBookData, updateOptions: { mid?: number; midColor?: string } = {}) => {
    const mid = updateOptions.mid;
    const asks = (data && data.asks ? data.asks : []).slice(0, levels);
    const bids = (data && data.bids ? data.bids : []).slice(0, levels);
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

  return {
    element: root,
    update,
    setPalette,
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
