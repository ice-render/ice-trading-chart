import { CANDLE_FIELDS, hasOhlc, readOhlc } from '../src/ohlc';

describe('readOhlc（数据项 → 四个价）', () => {
  it('认数组形式 [open, close, low, high]', () => {
    expect(readOhlc([100, 110, 95, 115])).toEqual([100, 110, 95, 115]);
  });

  it('认短名字段 { o, c, l, h }', () => {
    expect(readOhlc({ x: 'D1', o: 100, c: 110, l: 95, h: 115 })).toEqual([100, 110, 95, 115]);
  });

  it('也认长名字段 { open, close, low, high }', () => {
    expect(readOhlc({ open: 100, close: 110, low: 95, high: 115 })).toEqual([100, 110, 95, 115]);
  });

  it('字段名可以用 option 覆盖', () => {
    const option = { openField: '开', closeField: '收', lowField: '低', highField: '高' };
    expect(readOhlc({ 开: 100, 收: 110, 低: 95, 高: 115 }, option)).toEqual([100, 110, 95, 115]);
  });

  it('配置的字段名优先于长短名', () => {
    const raw = { o: 1, c: 2, l: 3, h: 4, 开: 100, 收: 110, 低: 95, 高: 115 };
    const option = { openField: '开', closeField: '收', lowField: '低', highField: '高' };
    expect(readOhlc(raw, option)).toEqual([100, 110, 95, 115]);
  });

  it('数字字符串也当数值读（表格数据常见）', () => {
    expect(readOhlc({ o: '100', c: '110', l: '95', h: '115' })).toEqual([100, 110, 95, 115]);
  });

  it('缺字段 / 非数值 / 空值一律返回 null，而不是画成 0', () => {
    expect(readOhlc({ o: 100, c: 110, l: 95 })).toBeNull();
    expect(readOhlc({ o: 100, c: 110, l: 95, h: 'abc' })).toBeNull();
    expect(readOhlc({ o: 100, c: 110, l: null, h: 115 })).toBeNull();
    expect(readOhlc([100, 110, 95])).toBeNull();
    expect(readOhlc(null)).toBeNull();
    expect(readOhlc('100,110,95,115')).toBeNull();
    expect(readOhlc(42)).toBeNull();
  });

  it('hasOhlc 与 readOhlc 判断一致', () => {
    expect(hasOhlc([1, 2, 3, 4])).toBe(true);
    expect(hasOhlc({ o: 1, c: 2, l: 3 })).toBe(false);
  });

  it('默认字段名是短名', () => {
    expect(CANDLE_FIELDS).toEqual({ open: 'o', close: 'c', low: 'l', high: 'h' });
  });
});
