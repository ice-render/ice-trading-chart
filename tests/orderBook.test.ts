import { createOrderBook } from '../src/orderBook';
import type { OrderBook } from '../src/orderBook';

function makeBook(levels: number, mid = 42000) {
  const asks = [];
  const bids = [];
  for (let i = 0; i < levels; i += 1) {
    asks.push({ price: mid + 1 + i, size: 1 + i * 0.1 });
    bids.push({ price: mid - 1 - i, size: 2 + i * 0.1 });
  }
  return { asks, bids };
}

describe('createOrderBook（盘口组件）', () => {
  let host: HTMLDivElement;
  let book: OrderBook;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    book.destroy();
    if (host.parentNode) host.parentNode.removeChild(host);
  });

  const rowsOf = (side: 'ask' | 'bid') => Array.from(host.querySelectorAll(`.ice-book-side[data-side="${side}"] .ice-book-row`)) as HTMLElement[];
  const priceOf = (row: HTMLElement) => row.querySelector('.ice-book-px')!.textContent;

  it('默认每侧 10 档（组件默认值就是 10）', () => {
    book = createOrderBook(host);
    expect(rowsOf('ask')).toHaveLength(10);
    expect(rowsOf('bid')).toHaveLength(10);
  });

  it('levels 可配，且档数不足时多余的行隐藏', () => {
    book = createOrderBook(host, { levels: 3 });
    expect(rowsOf('ask')).toHaveLength(3);
    book.update(makeBook(2));
    const rows = rowsOf('bid');
    expect(rows[0].style.display).toBe('');
    expect(rows[1].style.display).toBe('');
    expect(rows[2].style.display).toBe('none');
  });

  it('卖盘倒序渲染：最优价贴着中间价那一行', () => {
    book = createOrderBook(host, { levels: 3 });
    book.update(makeBook(3, 42000));
    // 组件内部按「最优在前」收数据，展示时最远价在上、最优价在下
    expect(priceOf(rowsOf('ask')[0])).toBe('42003.00');
    expect(priceOf(rowsOf('ask')[2])).toBe('42001.00');
    // 买盘正序：最优价在上
    expect(priceOf(rowsOf('bid')[0])).toBe('41999.00');
    expect(priceOf(rowsOf('bid')[2])).toBe('41997.00');
  });

  it('中间行给中间价与价差', () => {
    book = createOrderBook(host);
    book.update(makeBook(2, 42000));
    expect(host.querySelector('.ice-book-mid b')!.textContent).toBe('42000.00');
    expect(host.querySelector('.ice-book-mid span')!.textContent).toBe('价差 2.00');
    expect(book.spread()).toBe(2);
    expect(book.mid()).toBe(42000);
  });

  it('深度条按「两侧最大量」归一化', () => {
    book = createOrderBook(host, { levels: 2 });
    book.update({
      asks: [
        { price: 101, size: 10 },
        { price: 102, size: 5 },
      ],
      bids: [{ price: 99, size: 5 }],
    });
    // 卖盘展示时「最远价在上、最优价贴着中间价」，所以下标 0 是 102（量 5），下标 1 是 101（量 10）
    const askTop = rowsOf('ask')[0].querySelector('.ice-book-depth') as HTMLElement;
    const askBottom = rowsOf('ask')[1].querySelector('.ice-book-depth') as HTMLElement;
    const bidTop = rowsOf('bid')[0].querySelector('.ice-book-depth') as HTMLElement;
    expect(askTop.style.width).toBe('50%');
    expect(askBottom.style.width).toBe('100%');
    expect(bidTop.style.width).toBe('50%');
  });

  it('showDepth: false 时不画深度条', () => {
    book = createOrderBook(host, { levels: 1, showDepth: false });
    book.update({ asks: [{ price: 101, size: 10 }], bids: [{ price: 99, size: 5 }] });
    const depth = rowsOf('ask')[0].querySelector('.ice-book-depth') as HTMLElement;
    expect(depth.style.width).toBe('0px');
  });

  it('点击某一档把价格与方向抛给应用', () => {
    const picked: Array<[number, 'ask' | 'bid']> = [];
    book = createOrderBook(host, { levels: 2, onPickPrice: (price, side) => picked.push([price, side]) });
    book.update(makeBook(2, 42000));
    rowsOf('ask')[1].click();
    rowsOf('bid')[0].click();
    expect(picked).toEqual([
      [42001, 'ask'],
      [41999, 'bid'],
    ]);
  });

  it('换配色会改价格行颜色（下一次 update 生效）', () => {
    book = createOrderBook(host, { levels: 1, upColor: '#ff0000', downColor: '#00ff00' });
    book.update({ asks: [{ price: 101, size: 1 }], bids: [{ price: 99, size: 1 }] });
    expect((rowsOf('ask')[0].querySelector('.ice-book-px') as HTMLElement).style.color).toBe('rgb(255, 0, 0)');
    book.setPalette({ upColor: '#0000ff', downColor: '#ffff00' });
    book.update({ asks: [{ price: 101, size: 1 }], bids: [{ price: 99, size: 1 }] });
    expect((rowsOf('ask')[0].querySelector('.ice-book-px') as HTMLElement).style.color).toBe('rgb(0, 0, 255)');
  });

  it('数据没变时一次 DOM 都不写（签名去重）', () => {
    book = createOrderBook(host, { levels: 2 });
    const data = makeBook(2, 42000);
    book.update(data, { mid: 42000 });
    const row = rowsOf('ask')[0];
    priceOf(row);
    // 手动改掉 DOM：若组件又写一遍，这里会被覆盖
    (row.querySelector('.ice-book-px') as HTMLElement).textContent = 'MUTATED';
    book.update(data, { mid: 42000 });
    expect(priceOf(row)).toBe('MUTATED');
  });

  it('最新价的颜色由调用方给（组件不知道该跟谁比）', () => {
    book = createOrderBook(host, { levels: 1 });
    book.update({ asks: [{ price: 101, size: 1 }], bids: [{ price: 99, size: 1 }] }, { mid: 100, midColor: 'rgb(240, 68, 56)' });
    const mid = host.querySelector('.ice-book-mid b') as HTMLElement;
    expect(mid.style.color).toBe('rgb(240, 68, 56)');
    expect(mid.textContent).toBe('100.00');
  });

  it('空数据不炸', () => {
    book = createOrderBook(host);
    book.update({ asks: [], bids: [] });
    expect(host.querySelector('.ice-book-mid b')!.textContent).toBe('-');
    expect(book.spread()).toBeNull();
  });

  it('destroy 摘掉根元素', () => {
    book = createOrderBook(host);
    expect(host.querySelector('.ice-book')).toBeTruthy();
    book.destroy();
    expect(host.querySelector('.ice-book')).toBeNull();
  });

  it('自带样式只注入一次（多个盘口共用一个 style 标签）', () => {
    book = createOrderBook(host);
    const other = createOrderBook(document.createElement('div'));
    expect(document.querySelectorAll('#ice-trading-order-book-style')).toHaveLength(1);
    other.destroy();
  });
});
