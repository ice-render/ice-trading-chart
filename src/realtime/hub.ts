import { createRealtimeClient } from './client';
import type { RealtimeClient, RealtimeClientOptions, RealtimeState } from './client';
import { createCandleStream, createDepthStore, createPositionStore } from './topics';
import type { CandleStream, DepthStore, PositionStore } from './topics';
import type { CandleDatum } from '../types';

/**
 * **实时行情中枢**：把「一条连接 + 一组 topic」组装成应用真正好用的东西。
 *
 * 它干三件事：
 *
 * 1. **订阅记账**：应用只说「我要 kline(BTCUSDT, 1m)」，枢纽负责算 key、发订阅报文、
 *    并把订阅关系记下来 —— **连接一开就自动重放全部订阅**（断线重连后不用应用操心）；
 * 2. **按帧合并**：同一条流一秒推几十上百次，枢纽把它们合进 store，但**每帧只通知一次**
 *    （`flush: 'frame'`；也可以给毫秒数）。这就是「高频推送不把主线程打满」的关键一条：
 *    应用侧每帧只做一次图表刷新；
 * 3. **把状态交给应用**：`data(key)` 拿当前状态，`onData` 拿变更（含 `kind`），
 *    `onState` 拿连接状态 —— 应用不必知道报文长什么样、也不必自己写重连。
 *
 * 应用要做的只有三件：给协议（`Topic` 的 `subscribe` / `decode`）、给 store（内置的
 * `createCandleStream` / `createDepthStore` / `createPositionStore` 或自己的）、把数据画出来。
 */

/** 一次（合并后的）数据变更。 */
export interface RealtimeChange<TData = unknown> {
  /** topic 名。 */
  topic: string;
  /** topic 内唯一 key（例如 `BTCUSDT:1m`）。 */
  key: string;
  /** 订阅时的参数。 */
  params: unknown;
  /** 当前 store（K 线 topic 是 `CandleStream`，深度是 `DepthStore`，仓位是 `PositionStore`）。 */
  data: TData;
  /** 变更类型（由 topic 的 `apply` 给出）：K 线是 update / close / append / load，深度是 applied / snapshot / resync… */
  kind: string;
  /** 原始 payload。 */
  payload: unknown;
}

export interface RealtimeTopic<TParams = any, TData = any> {
  /** topic 名（'kline' / 'depth' / 'positions' …）。 */
  name: string;
  /** 参数 → 唯一 key。 */
  keyOf(params: TParams): string;
  /** 订阅报文（应用原样交给客户端 `send`）。 */
  subscribe(params: TParams): unknown;
  /** 退订报文（可选；不给就只「不再处理」其消息）。 */
  unsubscribe?(params: TParams): unknown;
  /**
   * 报文 → 「属于哪个 key、payload 是什么」。
   *
   * 不是本 topic 的报文返回 `null`（一个连接上多路复用的时候，这里就是分流点）。
   */
  decode(message: unknown): { key: string; payload: any } | null;
  /** 初始 store（不给就用 `undefined` 起）。 */
  initial?(): TData;
  /** 把 payload 并进 store，返回新的 store 与这次变更的类型。 */
  apply(store: TData | undefined, payload: any, context: { key: string; params: TParams }): { data: TData; kind: string };
}

export interface RealtimeHubOptions {
  /** 底层客户端；不给就用 `clientOptions` 建一个。 */
  client?: RealtimeClient;
  /** 建客户端用的配置（给了 `client` 就忽略）。 */
  clientOptions?: RealtimeClientOptions;
  /** 支持的 topic 列表。 */
  topics: RealtimeTopic[];
  /**
   * 合并推送：`'frame'`（默认）按 rAF 每帧一次；给数字表示毫秒。
   * 只影响**通知**的节奏，store 每条报文都会及时更新。
   */
  flush?: 'frame' | number;
  /** 合并后的变更（每帧最多一次）。 */
  onData?: (changes: RealtimeChange[]) => void;
  /** 连接状态变化（转发客户端状态 + 中枢自己的重订阅动作）。 */
  onState?: (state: RealtimeState, detail: { attempt: number; retryInMs?: number; resubscribed?: number }) => void;
  /** 出错（连接、发送、解码）。 */
  onError?: (error: unknown) => void;
  debug?: (event: string, detail?: unknown) => void;
}

export interface RealtimeHub {
  /** 订阅：返回 key（重复订阅同一个 key 只发一次报文）。 */
  subscribe(topicName: string, params: any): string | null;
  /** 退订。 */
  unsubscribe(topicName: string, params: any): void;
  /**
   * 参数 → 这一条订阅的 key（`topic:key` 的完整写法）。
   *
   * 有了它，应用不必自己拼 key 字符串（`data()` / 事件里的 `key` 都是这个口径）——
   * 自定义 topic 的 `keyOf` 一旦改口径，应用侧跟着改的就是零处。
   */
  keyOf(topicName: string, params: any): string | null;
  /** 当前 store。 */
  data<TData = unknown>(key: string): TData | undefined;
  /** 当前订阅的 key 列表。 */
  keys(): string[];
  /** 底层客户端（要发自定义报文 / 看状态时用）。 */
  readonly client: RealtimeClient;
  /** 手动触发一次通知（一般不用：flush 会自动跑）。 */
  flush(): void;
  dispose(): void;
}

interface Subscription {
  topic: RealtimeTopic;
  params: unknown;
  key: string;
}

/**
 * 建一个实时中枢。
 *
 * ```ts
 * const hub = createRealtimeHub({
 *   clientOptions: { url: 'wss://example.com/ws', heartbeat: { payload: { op: 'ping' } } },
 *   topics: [createCandleTopic({...}), createDepthTopic({...})],
 *   onData: (changes) => { for (const change of changes) render(change); },
 * });
 * hub.subscribe('kline', { symbol: 'BTCUSDT', interval: '1m' });
 * ```
 */
export function createRealtimeHub(options: RealtimeHubOptions): RealtimeHub {
  const topics = new Map<string, RealtimeTopic>();
  for (const topic of options.topics || []) topics.set(topic.name, topic);

  const client =
    options.client ||
    createRealtimeClient({
      ...(options.clientOptions as RealtimeClientOptions),
      onState: (state, detail) => {
        options.clientOptions?.onState?.(state, detail);
        if (state === 'open') {
          const resubscribed = resubscribeAll();
          options.onState?.(state, { ...detail, resubscribed });
          return;
        }
        options.onState?.(state, detail);
      },
      onMessage: (message) => {
        options.clientOptions?.onMessage?.(message);
        handleMessage(message);
      },
      onError: (error) => {
        options.clientOptions?.onError?.(error);
        options.onError?.(error);
      },
      debug: options.debug,
    });

  const subscriptions = new Map<string, Subscription>();
  const stores = new Map<string, unknown>();
  const pending = new Map<string, RealtimeChange>();
  const frame = options.flush === undefined ? 'frame' : options.flush;

  let frameHandle: any = null;
  let timerHandle: any = null;
  let disposed = false;

  const notify = () => {
    frameHandle = null;
    timerHandle = null;
    if (!pending.size) return;
    const changes = Array.from(pending.values());
    pending.clear();
    options.onData?.(changes);
  };

  const scheduleFlush = () => {
    if (!pending.size) return;
    if (frame === 'frame') {
      // 没有 rAF 的环境（某些测试 / Node）退化成「立即通知」，避免数据卡在队列里
      if (typeof requestAnimationFrame !== 'function') {
        notify();
        return;
      }
      if (frameHandle !== null) return; // 本帧已经排过，合并进去
      frameHandle = requestAnimationFrame(notify);
      return;
    }
    if (timerHandle !== null) return;
    const delay = Math.max(0, Number(frame) || 0);
    if (delay === 0) {
      notify();
      return;
    }
    timerHandle = setTimeout(notify, delay);
  };

  function keyOf(topicName: string, params: any): string | null {
    const topic = topics.get(topicName);
    if (!topic) return null;
    const key = topic.keyOf(params);
    return key ? `${topicName}:${key}` : null;
  }

  function resubscribeAll(): number {
    let count = 0;
    for (const entry of subscriptions.values()) {
      client.send(entry.topic.subscribe(entry.params));
      count += 1;
    }
    options.debug?.('resubscribe', { count });
    return count;
  }

  function handleMessage(message: unknown) {
    for (const topic of topics.values()) {
      let decoded: { key: string; payload: any } | null = null;
      try {
        decoded = topic.decode(message);
      } catch (error) {
        options.onError?.(error);
        continue;
      }
      if (!decoded) continue;
      const fullKey = `${topic.name}:${decoded.key}`;
      const entry = subscriptions.get(fullKey);
      // 没订阅过的 key 直接丢：多路复用连接上常收到别人的频道
      if (!entry) continue;
      try {
        const result = topic.apply(stores.get(fullKey), decoded.payload, { key: decoded.key, params: entry.params });
        stores.set(fullKey, result.data);
        pending.set(fullKey, {
          topic: topic.name,
          key: decoded.key,
          params: entry.params,
          data: result.data,
          kind: result.kind,
          payload: decoded.payload,
        });
      } catch (error) {
        options.onError?.(error);
        continue;
      }
    }
    scheduleFlush();
  }

  return {
    client,
    keyOf: (topicName, params) => keyOf(topicName, params),
    subscribe: (topicName, params) => {
      const topic = topics.get(topicName);
      const fullKey = keyOf(topicName, params);
      if (!topic) {
        // 拼错 topic 名时**要响**：静默返回 null 的话，页面会安静地什么都不发生
        options.onError?.(new Error(`[ice-trading-chart] 没有注册名为 ${topicName} 的 topic`));
        return null;
      }
      if (!fullKey) {
        options.onError?.(new Error(`[ice-trading-chart] topic ${topicName} 的 keyOf 没有给出 key`));
        return null;
      }
      if (!subscriptions.has(fullKey)) {
        subscriptions.set(fullKey, { topic, params, key: fullKey });
        if (stores.get(fullKey) === undefined && topic.initial) stores.set(fullKey, topic.initial());
        // 已连接就立刻发；没连上就**不**在这里发 —— 连接打开时统一重放（`resubscribeAll`），
        // 否则「队列补发 + 打开重放」会把同一条订阅发两遍（实测）
        if (client.state() === 'open') client.send(topic.subscribe(params));
      }
      return fullKey;
    },
    unsubscribe: (topicName, params) => {
      const fullKey = keyOf(topicName, params);
      if (!fullKey) return;
      const entry = subscriptions.get(fullKey);
      if (!entry) return;
      subscriptions.delete(fullKey);
      stores.delete(fullKey);
      if (entry.topic.unsubscribe) client.send(entry.topic.unsubscribe(entry.params));
    },
    data: <TData>(key: string) => stores.get(key) as TData | undefined,
    keys: () => Array.from(subscriptions.keys()),
    flush: notify,
    dispose: () => {
      disposed = true;
      if (frameHandle !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameHandle);
      if (timerHandle !== null) clearTimeout(timerHandle);
      frameHandle = null;
      timerHandle = null;
      subscriptions.clear();
      stores.clear();
      pending.clear();
      client.dispose();
    },
  };
}

/** K 线 topic 的参数。 */
export interface CandleTopicParams {
  symbol: string;
  interval: string;
}

export interface CandleTopicOptions {
  /** topic 名，默认 `kline`。 */
  name?: string;
  /** 参数 → key，默认 `symbol:interval`。 */
  keyOf?: (params: CandleTopicParams) => string;
  /** 订阅报文。 */
  subscribe: (params: CandleTopicParams) => unknown;
  /** 退订报文（可选）。 */
  unsubscribe?: (params: CandleTopicParams) => unknown;
  /**
   * 报文 → `{ key, payload }`：payload 是 `{ bar, closed? }`。
   * 不是 K 线报文返回 `null`。
   */
  decode: (message: unknown) => { key: string; bar: CandleDatum; closed?: boolean } | null;
  /** 内存里最多留多少根，默认 20000。 */
  limit?: number;
}

/** K 线 topic：store 是 `CandleStream`（就地改 / 收盘 / 追新 / 乱序丢弃都在它里面）。 */
export function createCandleTopic(
  options: CandleTopicOptions
): RealtimeTopic<CandleTopicParams, CandleStream> {
  const name = options.name || 'kline';
  const keyOf = options.keyOf || ((params: CandleTopicParams) => `${params.symbol}:${params.interval}`);
  return {
    name,
    keyOf,
    subscribe: (params) => options.subscribe(params),
    unsubscribe: options.unsubscribe ? (params) => options.unsubscribe!(params) : undefined,
    initial: () => createCandleStream({ limit: options.limit }),
    decode: (message) => {
      const hit = options.decode(message);
      return hit ? { key: hit.key, payload: { bar: hit.bar, closed: hit.closed === true } } : null;
    },
    apply: (stream, payload) => {
      const data = stream || createCandleStream({ limit: options.limit });
      const event = data.apply(payload.bar, payload.closed === true);
      return { data, kind: event.type };
    },
  };
}

/** 深度 topic 的参数（按交易对订阅）。 */
export interface DepthTopicParams {
  symbol: string;
}

export interface DepthTopicOptions {
  name?: string;
  keyOf?: (params: DepthTopicParams) => string;
  subscribe: (params: DepthTopicParams) => unknown;
  unsubscribe?: (params: DepthTopicParams) => unknown;
  /** 报文 → `{ key, message }`（message 是 `DepthMessage`：快照或增量）。 */
  decode: (message: unknown) => { key: string; message: any } | null;
  /** 每侧留多少档，默认 50。 */
  depth?: number;
}

/** 深度 topic：store 是 `DepthStore`（快照 + 增量 + 序列号对账，跳号报 `resync`）。 */
export function createDepthTopic(options: DepthTopicOptions): RealtimeTopic<DepthTopicParams, DepthStore> {
  const name = options.name || 'depth';
  const keyOf = options.keyOf || ((params: DepthTopicParams) => params.symbol);
  return {
    name,
    keyOf,
    subscribe: (params) => options.subscribe(params),
    unsubscribe: options.unsubscribe ? (params) => options.unsubscribe!(params) : undefined,
    initial: () => createDepthStore({ depth: options.depth }),
    decode: (message) => {
      const hit = options.decode(message);
      return hit ? { key: hit.key, payload: hit.message } : null;
    },
    apply: (store, payload) => {
      const data = store || createDepthStore({ depth: options.depth });
      const event = data.apply(payload);
      return { data, kind: event.type };
    },
  };
}

/** 仓位 topic 的参数（一般按账户订阅，所以默认一个空对象 → key 固定 `account`）。 */
export interface PositionTopicOptions {
  name?: string;
  keyOf?: (params: unknown) => string;
  subscribe: (params: unknown) => unknown;
  unsubscribe?: (params: unknown) => unknown;
  /** 报文 → `{ key, positions }`。 */
  decode: (message: unknown) => { key: string; positions: any } | null;
}

/** 仓位 topic：store 是 `PositionStore`（按 symbol + 方向 upsert，size<=0 摘掉）。 */
export function createPositionTopic(options: PositionTopicOptions): RealtimeTopic<unknown, PositionStore> {
  const name = options.name || 'positions';
  const keyOf = options.keyOf || (() => 'account');
  return {
    name,
    keyOf,
    subscribe: (params) => options.subscribe(params),
    unsubscribe: options.unsubscribe ? (params) => options.unsubscribe!(params) : undefined,
    initial: () => createPositionStore(),
    decode: (message) => {
      const hit = options.decode(message);
      return hit ? { key: hit.key, payload: hit.positions } : null;
    },
    apply: (store, payload) => {
      const data = store || createPositionStore();
      data.apply(payload);
      return { data, kind: 'positions' };
    },
  };
}
