import type { WebSocketLike } from '../../src/realtime/client';

/**
 * 假 WebSocket：测试里用来把「重连 / 心跳 / 排队 / 订阅重放」全跑一遍。
 *
 * 行为对齐真实 `WebSocket`：**close / error 是异步派发**的（`setTimeout 0`），
 * 所以客户端不能依赖「close 同步回调」来排重试 —— 这条正是实际会踩的坑。
 */
export class FakeSocket implements WebSocketLike {
  public static instances: FakeSocket[] = [];
  public static reset(): void {
    FakeSocket.instances = [];
  }
  public static last(): FakeSocket {
    return FakeSocket.instances[FakeSocket.instances.length - 1];
  }

  public readyState = 0;
  public sent: string[] = [];
  public closed: { code?: number; reason?: string } | null = null;
  private listeners = new Map<string, Set<(event: any) => void>>();

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  public addEventListener(type: string, listener: (event: any) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  public removeEventListener(type: string, listener: (event: any) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  public send(data: any): void {
    this.sent.push(String(data));
  }

  public close(code = 1000, reason = ''): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closed = { code, reason };
    setTimeout(() => this.dispatch('close', { code, reason }), 0);
  }

  // ---- 测试辅助 ----
  public open(): void {
    this.readyState = 1;
    this.dispatch('open', {});
  }

  public message(payload: unknown): void {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.dispatch('message', { data });
  }

  /** 模拟服务端 / 网络把连接掐掉（不带 code 的异常关闭）。 */
  public drop(reason = 'network-drop'): void {
    this.readyState = 3;
    this.closed = { code: 1006, reason };
    this.dispatch('close', { code: 1006, reason });
  }

  private dispatch(type: string, event: any): void {
    for (const listener of Array.from(this.listeners.get(type) || [])) {
      try {
        listener(event);
      } catch {
        /* ignore */
      }
    }
  }
}

/** 把 `requestAnimationFrame` 换成 setTimeout，便于用假时钟测「按帧合并」。 */
export function installFakeRaf(): () => void {
  const originalRaf = (globalThis as any).requestAnimationFrame;
  const originalCancel = (globalThis as any).cancelAnimationFrame;
  (globalThis as any).requestAnimationFrame = (fn: (time: number) => void) => setTimeout(() => fn(Date.now()), 16) as any;
  (globalThis as any).cancelAnimationFrame = (handle: any) => clearTimeout(handle);
  return () => {
    (globalThis as any).requestAnimationFrame = originalRaf;
    (globalThis as any).cancelAnimationFrame = originalCancel;
  };
}
