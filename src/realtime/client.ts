/**
 * **实时行情客户端**：一条 WebSocket 连接的完整生命周期。
 *
 * 这一层**不含任何交易语义**（不认识 K 线 / 盘口 / 仓位），只负责把「一条会断的长连接」
 * 变成一个「应用可以放心用的东西」：
 *
 * - **断线重连**：指数退避 + 抖动（`min → max`，封顶），成功后计数清零；
 * - **重连即重订阅**：订阅关系由 `RealtimeHub` 记账，客户端每次 `open` 都抛 `open` 事件，
 *   上层据此**重放全部订阅**（这类协议几乎都要求重连后重新 subscribe）；
 * - **心跳 + 静默看门狗**：定时发心跳；超过 `timeoutMs` 没收到任何消息就判定掉线并主动断开
 *   （TCP 半开、中间设备静默断流这两件事，只有靠应用层心跳才救得回来）；
 * - **断线期间的消息排队**：`send()` 在未连接时进队列（有上限，满了丢最旧的），
 *   连上后按序补发 —— 订阅报文因此不会丢；
 * - **网络状态联动**：浏览器 `online` 事件立刻重连，`offline` 期间不空转重试。
 *
 * 传输实现可注入（`createSocket`），所以单测里用假 socket 就能把重连 / 心跳 / 排队全跑一遍，
 * Node 端也能换成 `ws`。
 */

/** 客户端状态。 */
export type RealtimeState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

/** WebSocket 的最小形状（浏览器 `WebSocket` 与常见 Node 实现都满足）。 */
export interface WebSocketLike {
  readyState: number;
  send(data: any): void;
  close(code?: number, reason?: string): void;
  addEventListener?(type: string, listener: (event: any) => void): void;
  removeEventListener?(type: string, listener: (event: any) => void): void;
  onopen?: ((event: any) => void) | null;
  onmessage?: ((event: any) => void) | null;
  onclose?: ((event: any) => void) | null;
  onerror?: ((event: any) => void) | null;
}

export interface RealtimeReconnectOptions {
  /** 首次退避时长（ms），默认 500。 */
  minDelayMs?: number;
  /** 退避上限（ms），默认 15000。 */
  maxDelayMs?: number;
  /** 退避倍数，默认 1.8。 */
  factor?: number;
  /** 抖动比例（0~1），默认 0.2：避免一批客户端同时重连。 */
  jitter?: number;
  /** 最多重试多少次（不含首次连接），默认 Infinity。 */
  maxAttempts?: number;
}

export interface RealtimeHeartbeatOptions {
  /** 心跳报文（原样交给 `encode`）。 */
  payload: unknown;
  /** 发送间隔（ms），默认 15000。 */
  intervalMs?: number;
  /**
   * 静默超时（ms），默认 `intervalMs × 2.5`：这么久没收到**任何**消息就判定掉线，
   * 主动断开走重连。填 `0` 关掉看门狗（只发心跳、不判死）。
   */
  timeoutMs?: number;
}

export interface RealtimeClientOptions {
  /**
   * 连接地址：字符串，或按「第几次尝试」求值的函数（有些网关需要带 token / 分片参数）。
   */
  url: string | ((context: { attempt: number }) => string);
  /** 子协议（透传给 WebSocket）。 */
  protocols?: string | string[];
  /** 注入传输实现，默认用全局 `WebSocket`。 */
  createSocket?: (url: string, protocols?: string | string[]) => WebSocketLike;
  /** 心跳配置。不给就不发心跳，也不做静默看门狗。 */
  heartbeat?: RealtimeHeartbeatOptions;
  /** 重连退避配置。 */
  reconnect?: RealtimeReconnectOptions;
  /** 未连接时最多排队多少条消息，默认 64。 */
  queueLimit?: number;
  /** 编解码：默认 JSON。 */
  encode?: (value: unknown) => string;
  decode?: (raw: any) => unknown;
  /** 状态变化（含重连倒计时里的 `retryIn`）。 */
  onState?: (state: RealtimeState, detail: { attempt: number; retryInMs?: number; reason?: string }) => void;
  /** 收到一条（已解码的）消息。 */
  onMessage?: (message: unknown) => void;
  /** 出错（连接失败 / 发送失败）；不影响重连。 */
  onError?: (error: unknown) => void;
  /** 调试日志。 */
  debug?: (event: string, detail?: unknown) => void;
}

export type RealtimeClientEvent = 'state' | 'open' | 'message' | 'error' | 'close';

export interface RealtimeClient {
  /** 当前状态。 */
  state(): RealtimeState;
  /** 已失败的连接次数（连上即清零）。 */
  attempts(): number;
  /** 队列里还压着多少条消息。 */
  queued(): number;
  /** 建立连接（幂等：连接中 / 已连接时什么都不做）。 */
  connect(): void;
  /** 主动关闭，**不再重连**。 */
  close(reason?: string): void;
  /** 发送；未连接时排队（返回是否已直接发出）。 */
  send(message: unknown): boolean;
  /** 订阅事件；返回取消订阅的函数。 */
  on(event: RealtimeClientEvent, listener: (payload: any) => void): () => void;
  /** 关闭并清理所有定时器 / 监听。 */
  dispose(): void;
}

const OPEN = 1;

function resolveSocketFactory(injected?: RealtimeClientOptions['createSocket']) {
  if (injected) return injected;
  return (url: string, protocols?: string | string[]) => {
    const Ctor = (globalThis as any).WebSocket;
    if (!Ctor) throw new Error('[ice-trading-chart] 当前环境没有 WebSocket，请通过 createSocket 注入实现');
    return protocols === undefined ? new Ctor(url) : new Ctor(url, protocols);
  };
}

/**
 * 建一个实时客户端。
 *
 * ```ts
 * const client = createRealtimeClient({
 *   url: 'wss://example.com/ws',
 *   heartbeat: { payload: { op: 'ping' } },
 *   reconnect: { minDelayMs: 500, maxDelayMs: 15000 },
 * });
 * client.on('open', () => resubscribeAll());   // 重连后要重放订阅
 * client.connect();
 * ```
 */
export function createRealtimeClient(options: RealtimeClientOptions): RealtimeClient {
  const reconnect = {
    minDelayMs: options.reconnect?.minDelayMs ?? 500,
    maxDelayMs: options.reconnect?.maxDelayMs ?? 15000,
    factor: options.reconnect?.factor ?? 1.8,
    jitter: options.reconnect?.jitter ?? 0.2,
    maxAttempts: options.reconnect?.maxAttempts ?? Number.POSITIVE_INFINITY,
  };
  const queueLimit = Math.max(0, options.queueLimit ?? 64);
  const encode = options.encode || ((value: unknown) => JSON.stringify(value));
  const decode = options.decode || ((raw: any) => (typeof raw === 'string' ? JSON.parse(raw) : raw));
  const createSocket = resolveSocketFactory(options.createSocket);
  const listeners = new Map<RealtimeClientEvent, Set<(payload: any) => void>>();

  let state: RealtimeState = 'idle';
  let socket: WebSocketLike | null = null;
  let attempt = 0;
  let queue: string[] = [];
  let retryTimer: any = null;
  let heartbeatTimer: any = null;
  let watchdogTimer: any = null;
  let lastMessageAt = 0;
  let manual = false;
  let disposed = false;
  let boundOnline: (() => void) | null = null;
  let boundOffline: (() => void) | null = null;

  const emit = (event: RealtimeClientEvent, payload?: any) => {
    const set = listeners.get(event);
    if (!set) return;
    for (const listener of Array.from(set)) {
      try {
        listener(payload);
      } catch (error) {
        options.onError?.(error);
      }
    }
  };

  const setState = (next: RealtimeState, detail: { reason?: string; retryInMs?: number } = {}) => {
    state = next;
    const payload = { attempt, reason: detail.reason, retryInMs: detail.retryInMs };
    options.onState?.(next, payload);
    emit('state', { state: next, ...payload });
    options.debug?.('state', { state: next, ...payload });
  };

  const clearTimers = () => {
    if (retryTimer) clearTimeout(retryTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (watchdogTimer) clearInterval(watchdogTimer);
    retryTimer = null;
    heartbeatTimer = null;
    watchdogTimer = null;
  };

  const startHeartbeat = () => {
    const beat = options.heartbeat;
    if (!beat) return;
    lastMessageAt = Date.now();
    const intervalMs = beat.intervalMs ?? 15000;
    const timeoutMs = beat.timeoutMs === undefined ? Math.round(intervalMs * 2.5) : beat.timeoutMs;
    heartbeatTimer = setInterval(() => {
      send(beat.payload);
    }, intervalMs);
    if (timeoutMs > 0) {
      // 看门狗按 intervalMs/2 检查，够细也不费
      watchdogTimer = setInterval(
        () => {
          if (Date.now() - lastMessageAt > timeoutMs) {
            options.debug?.('watchdog-timeout', { silentMs: Date.now() - lastMessageAt });
            // 主动断开：onclose 会走重连
            closeSocket('heartbeat-timeout');
          }
        },
        Math.max(250, Math.round(intervalMs / 2))
      );
    }
  };

  const flushQueue = () => {
    if (!socket || socket.readyState !== OPEN) return;
    const pending = queue;
    queue = [];
    for (const raw of pending) {
      try {
        socket.send(raw);
      } catch (error) {
        options.onError?.(error);
      }
    }
  };

  const scheduleRetry = (reason: string) => {
    if (manual || disposed) {
      setState('closed', { reason });
      return;
    }
    if (attempt >= reconnect.maxAttempts) {
      setState('closed', { reason: `${reason}（已达最大重试次数）` });
      return;
    }
    const base = Math.min(reconnect.maxDelayMs, reconnect.minDelayMs * Math.pow(reconnect.factor, attempt));
    const jitter = base * reconnect.jitter * (Math.random() * 2 - 1);
    const delay = Math.max(0, Math.round(base + jitter));
    attempt += 1;
    setState('reconnecting', { reason, retryInMs: delay });
    retryTimer = setTimeout(() => {
      retryTimer = null;
      openSocket();
    }, delay);
  };

  /** 关掉当前连接。`retry` 为假时只关不排重试（离线等网络恢复时用，见 window `offline`）。 */
  const closeSocket = (reason: string, retry = true) => {
    const current = socket;
    socket = null;
    if (!current) return;
    unbindSocket(current);
    try {
      current.close(1000, reason);
    } catch {
      /* 关闭失败不影响后续重连 */
    }
    if (retry && (state === 'open' || state === 'connecting')) scheduleRetry(reason);
  };

  const unbindSocket = (target: WebSocketLike) => {
    if (target.removeEventListener) {
      target.removeEventListener('open', onOpen);
      target.removeEventListener('message', onMessage);
      target.removeEventListener('close', onClose);
      target.removeEventListener('error', onError);
    } else {
      target.onopen = null;
      target.onmessage = null;
      target.onclose = null;
      target.onerror = null;
    }
  };

  const onOpen = () => {
    attempt = 0;
    setState('open');
    startHeartbeat();
    flushQueue();
    emit('open', {});
  };

  const onMessage = (event: any) => {
    lastMessageAt = Date.now();
    const raw = event && event.data !== undefined ? event.data : event;
    let message: unknown = raw;
    try {
      message = decode(raw);
    } catch (error) {
      options.onError?.(error);
      return;
    }
    options.onMessage?.(message);
    emit('message', message);
  };

  const onClose = (event: any) => {
    const reason = (event && (event.reason || event.message)) || 'socket-closed';
    clearTimers();
    socket = null;
    emit('close', { reason });
    if (manual || disposed) {
      setState('closed', { reason });
      return;
    }
    scheduleRetry(reason);
  };

  const onError = (error: any) => {
    options.onError?.(error);
    emit('error', error);
    // 出错**不直接重连**：让 onclose 统一处理（避免一次故障触发两轮重连）
  };

  const bindSocket = (target: WebSocketLike) => {
    if (target.addEventListener) {
      target.addEventListener('open', onOpen);
      target.addEventListener('message', onMessage);
      target.addEventListener('close', onClose);
      target.addEventListener('error', onError);
      return;
    }
    target.onopen = onOpen;
    target.onmessage = onMessage;
    target.onclose = onClose;
    target.onerror = onError;
  };

  const openSocket = () => {
    if (disposed || manual) return;
    if (socket && (socket.readyState === OPEN || socket.readyState === 0)) return;
    clearTimers();
    setState('connecting');
    const url = typeof options.url === 'function' ? options.url({ attempt }) : options.url;
    try {
      const next = createSocket(url, options.protocols);
      socket = next;
      bindSocket(next);
      // 有些实现（注入的假 socket）在构造时就已经 open，不会抛 open 事件
      if (next.readyState === OPEN) onOpen();
    } catch (error) {
      options.onError?.(error);
      scheduleRetry('create-failed');
    }
  };

  const send = (message: unknown): boolean => {
    let raw: string;
    try {
      raw = encode(message);
    } catch (error) {
      options.onError?.(error);
      return false;
    }
    if (socket && socket.readyState === OPEN) {
      try {
        socket.send(raw);
        return true;
      } catch (error) {
        options.onError?.(error);
      }
    }
    if (queueLimit > 0) {
      queue.push(raw);
      if (queue.length > queueLimit) queue.splice(0, queue.length - queueLimit);
    }
    return false;
  };

  const client: RealtimeClient = {
    state: () => state,
    attempts: () => attempt,
    queued: () => queue.length,
    connect: () => {
      manual = false;
      if (disposed) return;
      openSocket();
    },
    close: (reason = 'manual-close') => {
      manual = true;
      clearTimers();
      const current = socket;
      socket = null;
      if (current) {
        unbindSocket(current);
        try {
          current.close(1000, reason);
        } catch {
          /* ignore */
        }
      }
      setState('closed', { reason });
    },
    send,
    on: (event, listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
      return () => listeners.get(event)?.delete(listener);
    },
    dispose: () => {
      disposed = true;
      manual = true;
      clearTimers();
      if (boundOnline && typeof window !== 'undefined') window.removeEventListener('online', boundOnline);
      if (boundOffline && typeof window !== 'undefined') window.removeEventListener('offline', boundOffline);
      boundOnline = null;
      boundOffline = null;
      const current = socket;
      socket = null;
      if (current) {
        unbindSocket(current);
        try {
          current.close(1000, 'dispose');
        } catch {
          /* ignore */
        }
      }
      listeners.clear();
      state = 'closed';
    },
  };

  // 网络状态联动：回到在线立刻重连（否则只能等退避跑完），离线期间不空转
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    boundOnline = () => {
      if (manual || disposed) return;
      const backoffPending = retryTimer !== null;
      if (backoffPending) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      attempt = 0; // 网络刚恢复，不必背着之前的退避
      openSocket();
    };
    boundOffline = () => {
      if (manual || disposed) return;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      // 离线期间**不排重试**（空转没意义），等 `online` 事件一到就立刻重连
      closeSocket('offline', false);
      setState('reconnecting', { reason: 'offline', retryInMs: 0 });
    };
    window.addEventListener('online', boundOnline);
    window.addEventListener('offline', boundOffline);
  }

  return client;
}
