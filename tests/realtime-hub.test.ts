import { FakeSocket, installFakeRaf } from './setup/fake-socket';
import { createCandleTopic, createDepthTopic, createPositionTopic, createRealtimeHub } from '../src/index';
import type { CandleDatum, CandleStream, DepthStore, PositionStore, RealtimeChange } from '../src/index';

/**
 * 实时中枢：订阅记账（重连重放）、按帧合并、多 topic 分流。
 *
 * 这里钉的都是「应用最容易各写一遍、又最容易写错」的部分。
 */
const candleTopic = () =>
  createCandleTopic({
    subscribe: (params) => ({ op: 'sub', ch: `kline.${params.interval}`, sym: params.symbol }),
    decode: (message: any) =>
      message && message.ch === 'kline'
        ? { key: `${message.sym}:${message.interval}`, bar: message.bar as CandleDatum, closed: !!message.closed }
        : null,
  });

const depthTopic = () =>
  createDepthTopic({
    subscribe: (params) => ({ op: 'sub', ch: 'depth', sym: params.symbol }),
    decode: (message: any) => (message && message.ch === 'depth' ? { key: message.sym, message: message.data } : null),
  });

const positionTopic = () =>
  createPositionTopic({
    subscribe: () => ({ op: 'sub', ch: 'positions' }),
    decode: (message: any) => (message && message.ch === 'positions' ? { key: 'account', positions: message.data } : null),
  });

describe('createRealtimeHub', () => {
  let restoreRaf: (() => void) | null = null;
  let hub: ReturnType<typeof createRealtimeHub> | null = null;

  beforeEach(() => {
    jest.useFakeTimers();
    FakeSocket.reset();
    restoreRaf = installFakeRaf();
  });

  afterEach(() => {
    if (hub) hub.dispose();
    hub = null;
    if (restoreRaf) restoreRaf();
    restoreRaf = null;
    jest.useRealTimers();
  });

  const mount = (onData: (changes: RealtimeChange[]) => void, flush: 'frame' | number = 'frame') => {
    hub = createRealtimeHub({
      clientOptions: {
        url: 'wss://example.test/ws',
        createSocket: (url) => new FakeSocket(url),
        reconnect: { minDelayMs: 100, maxDelayMs: 1000, factor: 2, jitter: 0 },
      },
      topics: [candleTopic(), depthTopic(), positionTopic()],
      flush,
      onData,
    });
    (hub.client as any).constructor; // 保持引用，避免 lint 抱怨
    return hub;
  };

  it('订阅：算 key、发订阅报文、未连上时排队；连上后自动重放（重连同理）', () => {
    const changes: RealtimeChange[] = [];
    const hub1 = mount((list) => changes.push(...list));
    hub1.subscribe('kline', { symbol: 'BTCUSDT', interval: '1m' });
    hub1.subscribe('depth', { symbol: 'BTCUSDT' });
    expect(hub1.keys()).toEqual(['kline:BTCUSDT:1m', 'depth:BTCUSDT']);

    // 没连上：不在这里发（等连接打开时统一重放），也不占客户端的发送队列
    expect(hub1.client.queued()).toBe(0);
    expect(FakeSocket.instances).toHaveLength(0);
    hub1.subscribe('kline', { symbol: 'BTCUSDT', interval: '1m' });
    // 重复订阅同一个 key 只记一次
    expect(hub1.keys()).toHaveLength(2);

    hub1.client.connect();
    FakeSocket.last().open();
    // 打开时重放全部订阅
    expect(FakeSocket.last().sent.map((raw) => JSON.parse(raw).ch)).toEqual(['kline.1m', 'depth']);

    // 掉线重连 → 全部订阅重放
    FakeSocket.last().drop();
    jest.advanceTimersByTime(100);
    FakeSocket.last().open();
    expect(FakeSocket.last().sent.map((raw) => JSON.parse(raw).ch)).toEqual(['kline.1m', 'depth']);
    expect(changes).toHaveLength(0);
  });

  it('按帧合并：一帧内推 100 条只通知一次，且 store 是最新的', () => {
    const batches: RealtimeChange[][] = [];
    const hub2 = mount((list) => batches.push(list));
    hub2.client.connect();
    FakeSocket.last().open();
    hub2.subscribe('kline', { symbol: 'BTCUSDT', interval: '1m' });

    for (let i = 0; i < 100; i++) {
      FakeSocket.last().message({
        ch: 'kline',
        sym: 'BTCUSDT',
        interval: '1m',
        bar: { x: '10:00', o: 100, c: 100 + i, l: 99, h: 120, v: i },
      });
    }
    expect(batches).toHaveLength(0);
    jest.advanceTimersByTime(16);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
    const stream = hub2.data<CandleStream>('kline:BTCUSDT:1m')!;
    expect(stream.last()!.c).toBe(199);
    expect(stream.last()!.v).toBe(99);
  });

  it('多 topic 分流：同一连接上 kline / depth / positions 各回各家', () => {
    const seen: string[] = [];
    const hub3 = mount((list) => {
      for (const change of list) seen.push(`${change.topic}:${change.kind}`);
    });
    hub3.client.connect();
    FakeSocket.last().open();
    hub3.subscribe('kline', { symbol: 'BTCUSDT', interval: '1m' });
    hub3.subscribe('depth', { symbol: 'BTCUSDT' });
    hub3.subscribe('positions', {});

    FakeSocket.last().message({ ch: 'depth', sym: 'BTCUSDT', data: { type: 'snapshot', seq: 1, bids: [{ price: 99, size: 1 }], asks: [] } });
    FakeSocket.last().message({ ch: 'positions', data: [{ symbol: 'BTCUSDT', side: 'long', size: 1 }] });
    FakeSocket.last().message({ ch: 'kline', sym: 'BTCUSDT', interval: '1m', bar: { x: '10:00', o: 1, c: 2, l: 1, h: 2 } });
    // 没订阅过的 key / 别人的频道：直接丢
    FakeSocket.last().message({ ch: 'kline', sym: 'ETHUSDT', interval: '1m', bar: { x: '10:00', o: 1, c: 2, l: 1, h: 2 } });
    FakeSocket.last().message({ ch: 'unknown' });

    jest.advanceTimersByTime(16);
    expect(seen.sort()).toEqual(['depth:snapshot', 'kline:update', 'positions:positions']);
    expect((hub3.data<DepthStore>('depth:BTCUSDT')!.book() as any).bids).toEqual([{ price: 99, size: 1 }]);
    expect(hub3.data<PositionStore>('positions:account')!.list()).toHaveLength(1);
  });

  it('深度序列号跳号：hub 把 `resync` 原样抛给应用（应用据此重取快照）', () => {
    const kinds: string[] = [];
    const hub4 = mount((list) => {
      for (const change of list) kinds.push(change.kind);
    });
    hub4.client.connect();
    FakeSocket.last().open();
    hub4.subscribe('depth', { symbol: 'BTCUSDT' });
    FakeSocket.last().message({ ch: 'depth', sym: 'BTCUSDT', data: { type: 'snapshot', seq: 5, bids: [], asks: [] } });
    FakeSocket.last().message({ ch: 'depth', sym: 'BTCUSDT', data: { type: 'diff', seq: 8, prevSeq: 6, bids: [], asks: [] } });
    jest.advanceTimersByTime(16);
    // 同一个 key 一帧内只报**最后一次**变更：应用拿到的是最新 store + 最新 kind
    // （resync 之后紧跟的数据不会把 resync 盖掉 —— 盖掉的是更早的 snapshot，那正是我们要的）
    expect(kinds).toEqual(['resync']);
  });

  it('flush 给毫秒数：按时间合并，不必等帧', () => {
    const batches: RealtimeChange[][] = [];
    const hub5 = mount((list) => batches.push(list), 50);
    hub5.client.connect();
    FakeSocket.last().open();
    hub5.subscribe('kline', { symbol: 'BTCUSDT', interval: '1m' });
    FakeSocket.last().message({ ch: 'kline', sym: 'BTCUSDT', interval: '1m', bar: { x: '10:00', o: 1, c: 2, l: 1, h: 2 } });
    FakeSocket.last().message({ ch: 'kline', sym: 'BTCUSDT', interval: '1m', bar: { x: '10:00', o: 1, c: 3, l: 1, h: 3 } });
    jest.advanceTimersByTime(50);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
  });

  it('keyOf：参数 → key（应用不必自己拼字符串）；topic 名拼错要响', () => {
    const errors: unknown[] = [];
    hub = createRealtimeHub({
      clientOptions: {
        url: 'wss://example.test/ws',
        createSocket: (url) => new FakeSocket(url),
      },
      topics: [candleTopic(), depthTopic()],
      onData: () => undefined,
      onError: (error) => errors.push(error),
    });
    // 订阅时用的 key 与查 store 用的 key 是同一个来源
    expect(hub.keyOf('kline', { symbol: 'BTCUSDT', interval: '1m' })).toBe('kline:BTCUSDT:1m');
    expect(hub.keyOf('depth', { symbol: 'BTCUSDT' })).toBe('depth:BTCUSDT');
    expect(hub.keyOf('unknown', {})).toBeNull();

    // 拼错 topic 名要报出来：静默返回 null 的话页面会安静地什么都不发生
    expect(hub.subscribe('klines', { symbol: 'BTCUSDT', interval: '1m' })).toBeNull();
    expect(errors).toHaveLength(1);
    expect(String((errors[0] as Error).message)).toContain('klines');
  });
});
