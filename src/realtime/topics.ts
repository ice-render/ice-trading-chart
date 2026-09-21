import type { CandleDatum } from '../types';

/**
 * **交易语义的 topic 存储**：K 线、深度（盘口）、仓位。
 *
 * 这一层解决的是「同一条流反复推同一份数据」的合并语义，也就是把原始报文变成**可渲染的状态**：
 *
 * - K 线：**同一根反复推**（只有 h/l/c/v 变）→ 就地改；**换了 x** → 接一根新的（上一根算收盘）；
 *   比当前最后一根**更旧**的 → 忽略（乱序报文不能回退画面）。REST 历史与重连回补走 `load()` 按 x 去重合并。
 * - 深度：**快照 + 增量**，增量必须带序列号；**跳号就报 `resync`**（应用据此重取快照 ——
 *   这是盘口协议里最关键的一条，跳过它盘口会悄悄错下去）。
 * - 仓位：数组 upsert（key = symbol + 方向），`size <= 0` 视为平掉。
 */

/** K 线流的一次变更。 */
export interface CandleStreamEvent {
  /** update = 同一根在变；close = 这一根收盘；append = 来了一根新的（前一根即收盘）；ignored = 乱序，丢弃；load = 快照合并。 */
  type: 'update' | 'close' | 'append' | 'ignored' | 'load';
  bar: CandleDatum;
}

export interface CandleStream {
  /** 当前全部 K 线（升序）。 */
  bars(): CandleDatum[];
  last(): CandleDatum | null;
  size(): number;
  /** 应用一条推送：就地改 / 接新的 / 丢弃乱序。 */
  apply(bar: CandleDatum, closed?: boolean): CandleStreamEvent;
  /** 合并一段快照（历史 / 重连回补）：按 x 去重，`replace` 为真时整体替换。 */
  load(bars: CandleDatum[], options?: { replace?: boolean }): CandleDatum[];
  on(listener: (event: CandleStreamEvent) => void): () => void;
  clear(): void;
}

function barKey(bar: CandleDatum): string {
  return String(bar && bar.x);
}

/**
 * 建一个 K 线流（内存里最近 `limit` 根，默认 20000）。
 *
 * 不碰图表、不碰网络 —— 只管「这条流现在是什么」。应用拿 `apply()` 的返回值或 `on()` 事件
 * 决定要不要刷新图表（通常配合 hub 的按帧合并）。
 */
export function createCandleStream(options: { limit?: number } = {}): CandleStream {
  const limit = Math.max(1, options.limit ?? 20000);
  let bars: CandleDatum[] = [];
  const listeners = new Set<(event: CandleStreamEvent) => void>();

  const emit = (event: CandleStreamEvent) => {
    for (const listener of Array.from(listeners)) {
      try {
        listener(event);
      } catch {
        /* 单个监听器出错不影响别人 */
      }
    }
    return event;
  };

  const apply = (bar: CandleDatum, closed = false): CandleStreamEvent => {
    if (!bar || bar.x === undefined || bar.x === null) return emit({ type: 'ignored', bar });
    const last = bars.length ? bars[bars.length - 1] : null;
    if (!last) {
      bars.push(bar);
      return emit({ type: closed ? 'close' : 'update', bar });
    }
    const incoming = barKey(bar);
    const current = barKey(last);
    if (incoming === current) {
      bars[bars.length - 1] = bar;
      return emit({ type: closed ? 'close' : 'update', bar });
    }
    // 乱序（类目 key 是稳定的字符串，直接比字符串即可；数值轴场景请自行换成数值比较）
    if (incoming < current) return emit({ type: 'ignored', bar });
    bars.push(bar);
    if (bars.length > limit) bars.splice(0, bars.length - limit);
    return emit({ type: 'append', bar });
  };

  const load = (incoming: CandleDatum[], loadOptions: { replace?: boolean } = {}): CandleDatum[] => {
    const list = Array.isArray(incoming) ? incoming.filter((bar) => bar && bar.x !== undefined && bar.x !== null) : [];
    if (!list.length) return bars;
    if (loadOptions.replace) {
      bars = list.slice(-limit);
      return bars;
    }
    const merged = new Map<string, CandleDatum>();
    for (const bar of bars) merged.set(barKey(bar), bar);
    for (const bar of list) merged.set(barKey(bar), bar);
    bars = Array.from(merged.values()).sort((a, b) => (barKey(a) < barKey(b) ? -1 : barKey(a) > barKey(b) ? 1 : 0));
    if (bars.length > limit) bars = bars.slice(bars.length - limit);
    if (list.length) emit({ type: 'load', bar: list[list.length - 1] });
    return bars;
  };

  return {
    bars: () => bars.slice(),
    last: () => (bars.length ? bars[bars.length - 1] : null),
    size: () => bars.length,
    apply,
    load,
    on: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear: () => {
      bars = [];
    },
  };
}

/** 深度（盘口）的一档。 */
export interface DepthLevel {
  price: number;
  size: number;
}

export interface DepthSnapshotMessage {
  type: 'snapshot';
  /** 快照序列号。 */
  seq: number;
  bids: DepthLevel[];
  asks: DepthLevel[];
}

export interface DepthDiffMessage {
  type: 'diff';
  /** 本条增量的序列号。 */
  seq: number;
  /** 上一条的序列号（对不上就说明中间丢包，要重取快照）。 */
  prevSeq?: number;
  bids: DepthLevel[];
  asks: DepthLevel[];
}

export type DepthMessage = DepthSnapshotMessage | DepthDiffMessage;

export interface DepthStoreEvent {
  /** applied = 增量接上了；snapshot = 换了快照；resync = 序列号跳号，请重取快照；ignored = 丢弃。 */
  type: 'applied' | 'snapshot' | 'resync' | 'ignored';
  seq?: number;
}

export interface DepthStore {
  book(): { bids: DepthLevel[]; asks: DepthLevel[]; seq: number } | null;
  apply(message: DepthMessage): DepthStoreEvent;
  on(listener: (event: DepthStoreEvent) => void): () => void;
  clear(): void;
}

/** 建一个深度存储（默认只留每侧 50 档）。 */
export function createDepthStore(options: { depth?: number } = {}): DepthStore {
  const depth = Math.max(1, options.depth ?? 50);
  let store: { bids: Map<number, number>; asks: Map<number, number>; seq: number } | null = null;
  const listeners = new Set<(event: DepthStoreEvent) => void>();
  const emit = (event: DepthStoreEvent) => {
    for (const listener of Array.from(listeners)) {
      try {
        listener(event);
      } catch {
        /* ignore */
      }
    }
    return event;
  };
  const applyLevels = (target: Map<number, number>, levels: DepthLevel[]) => {
    for (const level of levels || []) {
      const price = Number(level.price);
      const size = Number(level.size);
      if (!isFinite(price)) continue;
      if (!isFinite(size) || size <= 0) target.delete(price);
      else target.set(price, size);
    }
  };
  const sorted = () => {
    if (!store) return null;
    const bids = Array.from(store.bids.entries())
      .sort((a, b) => b[0] - a[0])
      .slice(0, depth)
      .map(([price, size]) => ({ price, size }));
    const asks = Array.from(store.asks.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(0, depth)
      .map(([price, size]) => ({ price, size }));
    return { bids, asks, seq: store.seq };
  };

  return {
    book: sorted,
    apply: (message) => {
      if (!message || !isFinite(Number(message.seq))) return emit({ type: 'ignored' });
      if (message.type === 'snapshot') {
        store = { bids: new Map(), asks: new Map(), seq: Number(message.seq) };
        applyLevels(store.bids, message.bids);
        applyLevels(store.asks, message.asks);
        return emit({ type: 'snapshot', seq: store.seq });
      }
      if (!store) return emit({ type: 'resync', seq: Number(message.seq) });
      const seq = Number(message.seq);
      // 允许两种常见口径：显式 prevSeq 对账，或「差 1」的连续编号
      const expected = message.prevSeq === undefined ? store.seq + 1 : Number(message.prevSeq);
      if (expected !== store.seq) return emit({ type: 'resync', seq });
      applyLevels(store.bids, message.bids);
      applyLevels(store.asks, message.asks);
      store.seq = seq;
      return emit({ type: 'applied', seq });
    },
    on: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear: () => {
      store = null;
    },
  };
}

/** 仓位（不同交易所字段差异很大，所以只约定「按 symbol + 方向 upsert」这一层）。 */
export interface PositionDatum {
  symbol: string;
  side: 'long' | 'short';
  size: number;
  entryPrice?: number;
  [key: string]: unknown;
}

export interface PositionStore {
  list(): PositionDatum[];
  apply(message: PositionDatum | PositionDatum[] | { positions: PositionDatum[] }): PositionDatum[];
  on(listener: (positions: PositionDatum[]) => void): () => void;
  clear(): void;
}

/** 建一个仓位存储（`size <= 0` 视为平掉，直接从列表里摘掉）。 */
export function createPositionStore(): PositionStore {
  const items = new Map<string, PositionDatum>();
  const listeners = new Set<(positions: PositionDatum[]) => void>();
  const snapshot = () => Array.from(items.values());
  const publish = () => {
    const list = snapshot();
    for (const listener of Array.from(listeners)) {
      try {
        listener(list);
      } catch {
        /* ignore */
      }
    }
    return list;
  };
  return {
    list: snapshot,
    apply: (message) => {
      const list = Array.isArray(message) ? message : message && Array.isArray((message as any).positions) ? (message as any).positions : [message];
      for (const item of list as PositionDatum[]) {
        if (!item || !item.symbol) continue;
        const key = `${item.symbol}|${item.side}`;
        if (!isFinite(Number(item.size)) || Number(item.size) <= 0) items.delete(key);
        else items.set(key, { ...item, size: Number(item.size) });
      }
      return publish();
    },
    on: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear: () => {
      items.clear();
      publish();
    },
  };
}
