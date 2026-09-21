import { createCandleStream, createDepthStore, createPositionStore } from '../src/index';
import type { CandleDatum } from '../src/index';

/**
 * topic store 的合并语义 —— 这是「实时行情」里最容易做错、也最难在页面上看出来的一块：
 * 同一根反复推、换成新的一根、旧报文乱序到达、快照与增量对账、仓位平掉。
 */
const bar = (x: string, o: number, c: number, l: number, h: number, v = 1): CandleDatum =>
  ({ x, o, c, l, h, v }) as CandleDatum;

describe('CandleStream（K 线流）', () => {
  it('同一根反复推：就地改，事件是 update / close', () => {
    const stream = createCandleStream();
    const events: string[] = [];
    stream.on((event) => events.push(`${event.type}:${event.bar.x}`));

    stream.apply(bar('10:00', 100, 101, 99, 102));
    const updated = stream.apply(bar('10:00', 100, 105, 99, 106));
    stream.apply(bar('10:00', 100, 105, 98, 106), true);

    expect(updated.type).toBe('update');
    expect(stream.size()).toBe(1);
    expect(stream.last()!.c).toBe(105);
    expect(events).toEqual(['update:10:00', 'update:10:00', 'close:10:00']);
  });

  it('换了 x：接一根新的（append），并把内存封顶', () => {
    const stream = createCandleStream({ limit: 3 });
    stream.apply(bar('10:00', 1, 1, 1, 1));
    stream.apply(bar('10:01', 1, 1, 1, 1));
    const third = stream.apply(bar('10:02', 1, 1, 1, 1));
    expect(third.type).toBe('append');
    stream.apply(bar('10:03', 1, 1, 1, 1));
    expect(stream.size()).toBe(3);
    expect(stream.bars().map((item) => item.x)).toEqual(['10:01', '10:02', '10:03']);
  });

  it('乱序（比最后一根更旧）直接丢，画面不回退', () => {
    const stream = createCandleStream();
    stream.apply(bar('10:05', 1, 1, 1, 1));
    const late = stream.apply(bar('10:04', 9, 9, 9, 9));
    expect(late.type).toBe('ignored');
    expect(stream.size()).toBe(1);
    expect(stream.last()!.x).toBe('10:05');
  });

  it('快照合并：按 x 去重、可整体替换（REST 历史 / 重连回补）', () => {
    const stream = createCandleStream();
    stream.apply(bar('10:02', 1, 1, 1, 1));
    stream.load([bar('10:00', 2, 2, 2, 2), bar('10:01', 3, 3, 3, 3), bar('10:02', 4, 4, 4, 4)]);
    expect(stream.bars().map((item) => item.x)).toEqual(['10:00', '10:01', '10:02']);
    expect(stream.bars()[2].o).toBe(4);

    stream.load([bar('11:00', 5, 5, 5, 5)], { replace: true });
    expect(stream.bars().map((item) => item.x)).toEqual(['11:00']);
  });
});

describe('DepthStore（深度：快照 + 增量 + 序列号对账）', () => {
  it('快照建立 + 增量接上：价格档 upsert、size 0 删除、排序与深度封顶', () => {
    const store = createDepthStore({ depth: 3 });
    expect(store.apply({ type: 'snapshot', seq: 1, bids: [{ price: 99, size: 1 }], asks: [{ price: 101, size: 2 }] }).type).toBe(
      'snapshot'
    );
    const applied = store.apply({
      type: 'diff',
      seq: 2,
      prevSeq: 1,
      bids: [
        { price: 98, size: 3 },
        { price: 99, size: 0 },
      ],
      asks: [
        { price: 100, size: 5 },
        { price: 101, size: 0 },
      ],
    });
    expect(applied.type).toBe('applied');
    expect(store.book()!.bids).toEqual([{ price: 98, size: 3 }]);
    expect(store.book()!.asks).toEqual([{ price: 100, size: 5 }]);

    // 超出深度的档被裁掉（只留每侧 3 档）
    store.apply({
      type: 'diff',
      seq: 3,
      prevSeq: 2,
      bids: [97, 96, 95, 94].map((price) => ({ price, size: 1 })),
      asks: [],
    });
    expect(store.book()!.bids.map((level) => level.price)).toEqual([98, 97, 96]);
  });

  it('序列号跳号 → resync（应用据此重取快照，而不是悄悄错下去）', () => {
    const store = createDepthStore();
    const events: string[] = [];
    store.on((event) => events.push(event.type));
    store.apply({ type: 'snapshot', seq: 10, bids: [], asks: [] });
    const gap = store.apply({ type: 'diff', seq: 12, prevSeq: 11, bids: [{ price: 1, size: 1 }], asks: [] });
    expect(gap.type).toBe('resync');
    expect(events).toEqual(['snapshot', 'resync']);
  });

  it('没有快照就来增量 → resync', () => {
    const store = createDepthStore();
    expect(store.apply({ type: 'diff', seq: 2, prevSeq: 1, bids: [], asks: [] }).type).toBe('resync');
  });
});

describe('PositionStore（仓位）', () => {
  it('按 symbol + 方向 upsert；size<=0 视为平掉', () => {
    const store = createPositionStore();
    const snapshots: number[] = [];
    store.on((positions) => snapshots.push(positions.length));

    store.apply([
      { symbol: 'SYNUSDT', side: 'long', size: 1, entryPrice: 100 },
      { symbol: 'SYNUSDT', side: 'short', size: 2, entryPrice: 110 },
    ]);
    expect(store.list()).toHaveLength(2);

    store.apply({ symbol: 'SYNUSDT', side: 'long', size: 3, entryPrice: 101 });
    expect(store.list().length).toBe(2);
    expect(store.list().find((item) => item.side === 'long')!.size).toBe(3);

    store.apply({ positions: [{ symbol: 'SYNUSDT', side: 'short', size: 0 }] });
    expect(store.list().map((item) => item.side)).toEqual(['long']);
    expect(snapshots).toEqual([2, 2, 1]);
  });
});
