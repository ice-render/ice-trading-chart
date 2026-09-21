import { FakeSocket } from './setup/fake-socket';
import { createRealtimeClient } from '../src/index';
import type { RealtimeState } from '../src/index';

/**
 * 实时客户端：断线重连、心跳看门狗、断线排队、网络状态联动。
 *
 * 判据全是**行为**：状态序列、重连间隔、`readyState`、实际发出去的报文、有没有多余的重连。
 */
describe('createRealtimeClient', () => {
  let restore: (() => void) | null = null;
  let clients: Array<ReturnType<typeof createRealtimeClient>> = [];

  beforeEach(() => {
    jest.useFakeTimers();
    FakeSocket.reset();
  });

  afterEach(() => {
    // ⚠️ 必须 dispose：客户端会挂 window 的 online / offline 监听，不清理会串到下一个用例
    for (const client of clients) client.dispose();
    clients = [];
    if (restore) restore();
    restore = null;
    jest.useRealTimers();
  });

  const mount = (options: Partial<Parameters<typeof createRealtimeClient>[0]> = {}) => {
    const client = createRealtimeClient({
      url: 'wss://example.test/ws',
      createSocket: (url) => new FakeSocket(url),
      reconnect: { minDelayMs: 500, maxDelayMs: 8000, factor: 2, jitter: 0 },
      ...options,
    });
    clients.push(client);
    return client;
  };

  it('连上 → 打开 → 主动关闭：不再重连', () => {
    const states: RealtimeState[] = [];
    const client = mount({ onState: (state) => states.push(state) });
    client.connect();
    expect(client.state()).toBe('connecting');
    FakeSocket.last().open();
    expect(client.state()).toBe('open');
    expect(client.attempts()).toBe(0);

    client.close('bye');
    jest.advanceTimersByTime(20000);
    expect(states).toEqual(['connecting', 'open', 'closed']);
    expect(FakeSocket.instances).toHaveLength(1); // 没有偷偷再连
  });

  it('掉线 → 指数退避重连 → 连上后计数清零；退避间隔逐次变长', () => {
    const client = mount();
    client.connect();
    FakeSocket.last().open();

    FakeSocket.last().drop('server-close');
    expect(client.state()).toBe('reconnecting');
    expect(client.attempts()).toBe(1);

    // 第一次退避 500ms 不够，800ms 够
    jest.advanceTimersByTime(400);
    expect(FakeSocket.instances).toHaveLength(1);
    jest.advanceTimersByTime(200);
    expect(FakeSocket.instances).toHaveLength(2);

    // 还没 open 就又被掐 → 第二次退避 1000ms
    FakeSocket.last().drop('again');
    expect(client.attempts()).toBe(2);
    jest.advanceTimersByTime(900);
    expect(FakeSocket.instances).toHaveLength(2);
    jest.advanceTimersByTime(200);
    expect(FakeSocket.instances).toHaveLength(3);

    FakeSocket.last().open();
    expect(client.state()).toBe('open');
    expect(client.attempts()).toBe(0);
  });

  it('重连次数上限：到顶就 closed 并报错原因，不再空转', () => {
    const client = mount({ reconnect: { maxAttempts: 2, minDelayMs: 100, factor: 1, jitter: 0 } });
    client.connect();
    FakeSocket.last().drop();
    jest.advanceTimersByTime(100);
    FakeSocket.last().drop();
    jest.advanceTimersByTime(100);
    FakeSocket.last().drop();
    jest.advanceTimersByTime(1000);
    expect(client.state()).toBe('closed');
    expect(client.attempts()).toBe(2);
  });

  it('断线期间的消息排队，连上后按序补发（订阅报文不会丢）', () => {
    const client = mount();
    expect(client.send({ op: 'subscribe', key: 'kline' })).toBe(false);
    client.connect();
    expect(client.queued()).toBe(1);
    FakeSocket.last().open();
    expect(client.queued()).toBe(0);
    expect(FakeSocket.last().sent).toEqual([JSON.stringify({ op: 'subscribe', key: 'kline' })]);
  });

  it('队列有上限：满了丢最旧的', () => {
    const client = mount({ queueLimit: 2 });
    client.send({ n: 1 });
    client.send({ n: 2 });
    client.send({ n: 3 });
    client.connect();
    FakeSocket.last().open();
    expect(FakeSocket.last().sent.map((raw) => JSON.parse(raw).n)).toEqual([2, 3]);
  });

  it('心跳：按间隔发报文；长时间收不到任何消息 → 判掉线并重连', () => {
    const client = mount({ heartbeat: { payload: { op: 'ping' }, intervalMs: 1000, timeoutMs: 2500 } });
    client.connect();
    FakeSocket.last().open();
    const first = FakeSocket.last();

    jest.advanceTimersByTime(1000);
    expect(first.sent).toContain(JSON.stringify({ op: 'ping' }));

    // 只发心跳、一直没收到任何服务端消息 → 看门狗在 2500ms 后判定掉线
    jest.advanceTimersByTime(2000);
    expect(client.state()).toBe('reconnecting');
    expect(first.closed).not.toBeNull();

    // 重连成功、又收到消息 → 看门狗重新计时，一切照旧
    jest.advanceTimersByTime(1000);
    FakeSocket.last().open();
    FakeSocket.last().message({ op: 'pong' });
    jest.advanceTimersByTime(1500);
    expect(client.state()).toBe('open');
  });

  it('网络恢复（online 事件）立即重连，不用等退避跑完', () => {
    const client = mount({ reconnect: { minDelayMs: 30000, maxDelayMs: 30000, jitter: 0 } });
    client.connect();
    FakeSocket.last().open();
    FakeSocket.last().drop('offline');
    expect(client.attempts()).toBe(1);

    window.dispatchEvent(new Event('online'));
    expect(FakeSocket.instances).toHaveLength(2);
    expect(client.attempts()).toBe(0);
    FakeSocket.last().open();
    expect(client.state()).toBe('open');
  });

  it('离线期间不空转：offline 之后不排重试，回到在线立刻重连', () => {
    const client = mount();
    client.connect();
    FakeSocket.last().open();

    window.dispatchEvent(new Event('offline'));
    expect(client.state()).toBe('reconnecting');
    // 离线期间不许空转重试（空转既没意义、又会把电池和日志烧掉）
    jest.advanceTimersByTime(20000);
    expect(FakeSocket.instances).toHaveLength(1);

    window.dispatchEvent(new Event('online'));
    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.last().open();
    expect(client.state()).toBe('open');
  });

  it('解码失败只报错，不断连接；decode 可注入（非 JSON 协议）', () => {
    const errors: unknown[] = [];
    const decoded: unknown[] = [];
    const client = mount({
      decode: (raw: string) => {
        if (raw === 'bad') throw new Error('boom');
        return `decoded:${raw}`;
      },
      onMessage: (message) => decoded.push(message),
      onError: (error) => errors.push(error),
    });
    client.connect();
    FakeSocket.last().open();
    FakeSocket.last().message('hello');
    FakeSocket.last().message('bad');
    expect(decoded).toEqual(['decoded:hello']);
    expect(errors).toHaveLength(1);
    expect(client.state()).toBe('open');
  });
});
