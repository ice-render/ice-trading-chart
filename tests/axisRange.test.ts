import { computePriceRange, DEFAULT_PRICE_PADDING } from '../src/axisRange';
import type { TradingSeriesOption } from '../src/types';

const series = (data: unknown[], extra: TradingSeriesOption = {}): TradingSeriesOption => ({
  id: 'k',
  type: 'candlestick',
  data,
  ...extra,
});

describe('computePriceRange（含影线的价格轴范围）', () => {
  it('下界取最低价、上界取最高价（不是收盘价）', () => {
    const range = computePriceRange([series([{ o: 100, c: 110, l: 95, h: 115 }])], { padding: 0 });
    expect(range).toEqual({ min: 95, max: 115 });
  });

  it('多根蜡烛取全局极值', () => {
    const range = computePriceRange(
      [series([
        { o: 100, c: 110, l: 95, h: 115 },
        { o: 110, c: 105, l: 100, h: 118 },
        { o: 105, c: 120, l: 102, h: 125 },
      ])],
      { padding: 0 }
    );
    expect(range).toEqual({ min: 95, max: 125 });
  });

  it('默认上下各留 6% 的留白', () => {
    // 极差 30，留白 1.8
    const range = computePriceRange([series([{ o: 100, c: 110, l: 95, h: 125 }])]);
    expect(range!.min).toBeCloseTo(95 - 30 * DEFAULT_PRICE_PADDING, 6);
    expect(range!.max).toBeCloseTo(125 + 30 * DEFAULT_PRICE_PADDING, 6);
  });

  it('多个系列一起参与（跨系列比较时两根都看得见）', () => {
    const range = computePriceRange(
      [series([{ o: 100, c: 110, l: 95, h: 115 }]), series([{ o: 50, c: 60, l: 45, h: 65 }])],
      { padding: 0 }
    );
    expect(range).toEqual({ min: 45, max: 115 });
  });

  it('忽略非 K 线系列', () => {
    const range = computePriceRange(
      [series([{ o: 100, c: 110, l: 95, h: 115 }]), { id: 'l', type: 'line', data: [1, 2, 3] }],
      { padding: 0 }
    );
    expect(range).toEqual({ min: 95, max: 115 });
  });

  it('全平行情给一个对称的可见区间（避免刻度退化成一条线）', () => {
    const range = computePriceRange([series([{ o: 100, c: 100, l: 100, h: 100 }], {})], { padding: 0 });
    expect(range!.min).toBeLessThan(100);
    expect(range!.max).toBeGreaterThan(100);
    expect(range!.max - 100).toBeCloseTo(100 - range!.min, 6);
  });

  it('没有有效蜡烛时返回 null（把量程交还给 ice-chart）', () => {
    expect(computePriceRange([])).toBeNull();
    expect(computePriceRange([series([])])).toBeNull();
    expect(computePriceRange([series([{ o: 1, c: 2, l: 3 }])])).toBeNull();
    expect(computePriceRange([{ id: 'l', type: 'line', data: [1, 2] }])).toBeNull();
  });
});
