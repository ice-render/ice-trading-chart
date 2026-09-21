import {
  bollinger,
  closeSeries,
  createMacdPaneOption,
  createOverlaySeries,
  createRsiPaneOption,
  ema,
  macd,
  macdRange,
  rsi,
  seriesData,
  sma,
  stdev,
} from '../src/indicators';
import type { TradingSeriesOption } from '../src/types';

const closes = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

const CANDLES: TradingSeriesOption = {
  id: 'k',
  type: 'candlestick',
  name: 'K 线',
  data: [
    { x: 'D1', o: 9, c: 10, l: 8, h: 11 },
    { x: 'D2', o: 10, c: 12, l: 9, h: 13 },
    { x: 'D3', o: 12, c: 11, l: 10, h: 13 },
    { x: 'D4', o: 11, c: 14, l: 11, h: 15 },
  ],
};

describe('sma', () => {
  it('预热期是 null，之后是算术平均', () => {
    const out = sma(closes, 3);
    expect(out.slice(0, 2)).toEqual([null, null]);
    expect(out[2]).toBe(11); // (10+11+12)/3
    expect(out[3]).toBe(12);
    expect(out[10]).toBe(19); // (18+19+20)/3
  });

  it('周期 1 等于原序列', () => {
    expect(sma(closes, 1)).toEqual(closes);
  });

  it('周期不合法时整列 null（不抛）', () => {
    expect(sma(closes, 0).every((v) => v === null)).toBe(true);
  });

  it('长度永远与输入一致', () => {
    expect(sma(closes, 5)).toHaveLength(closes.length);
  });
});

describe('ema', () => {
  it('种子是前 period 个值的简单平均', () => {
    const out = ema(closes, 3);
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(11, 6); // (10+11+12)/3
  });

  it('之后按 k = 2/(n+1) 递推', () => {
    const out = ema(closes, 3);
    const k = 2 / 4;
    expect(out[3]).toBeCloseTo(13 * k + 11 * (1 - k), 6);
  });

  it('数据不足整列 null', () => {
    expect(ema([1, 2], 5).every((v) => v === null)).toBe(true);
  });
});

describe('stdev / bollinger', () => {
  it('常数序列的标准差是 0', () => {
    const out = stdev([5, 5, 5, 5], 3);
    expect(out[2]).toBeCloseTo(0, 10);
    expect(out[3]).toBeCloseTo(0, 10);
  });

  it('布林带中轨 = 均线，上下轨对称', () => {
    const band = bollinger(closes, 3, 2);
    const middle = sma(closes, 3);
    for (let i = 0; i < closes.length; i++) expect(band.middle[i]).toEqual(middle[i]);
    const deviation = stdev(closes, 3);
    expect((band.upper[5] as number) - (band.middle[5] as number)).toBeCloseTo(2 * (deviation[5] as number), 10);
    expect((band.middle[5] as number) - (band.lower[5] as number)).toBeCloseTo(2 * (deviation[5] as number), 10);
  });
});

describe('macd', () => {
  it('DIF = EMA(fast) − EMA(slow)', () => {
    const result = macd(closes, 3, 5, 2);
    const fast = ema(closes, 3);
    const slow = ema(closes, 5);
    expect(result.dif[5]).toBeCloseTo((fast[5] as number) - (slow[5] as number), 10);
    expect(result.dif[3]).toBeNull(); // 慢线还没预热完
  });

  it('柱 = (DIF − DEA) × 2', () => {
    const result = macd(closes, 3, 5, 2);
    const i = closes.length - 1;
    expect(result.histogram[i]).toBeCloseTo(((result.dif[i] as number) - (result.dea[i] as number)) * 2, 10);
  });

  it('涨势加速时柱为正（线性上涨的柱会收敛到 0，不是好样本）', () => {
    const accelerating = [10, 10.5, 11.2, 12.1, 13.3, 14.8, 16.6, 18.7, 21.2, 24.1, 27.5];
    const result = macd(accelerating, 3, 5, 2);
    expect(result.histogram[accelerating.length - 1] as number).toBeGreaterThan(0);
  });

  it('涨势减速时柱为负', () => {
    const decelerating = [10, 12, 13.5, 14.4, 15.1, 15.6, 16.0, 16.3, 16.5, 16.6, 16.7];
    const result = macd(decelerating, 3, 5, 2);
    expect(result.histogram[decelerating.length - 1] as number).toBeLessThan(0);
  });

  it('三列长度都与输入一致', () => {
    const result = macd(closes, 3, 5, 2);
    expect(result.dif).toHaveLength(closes.length);
    expect(result.dea).toHaveLength(closes.length);
    expect(result.histogram).toHaveLength(closes.length);
  });
});

describe('rsi', () => {
  it('一路上涨 → 100', () => {
    const out = rsi(closes, 5);
    expect(out[5]).toBeCloseTo(100, 6);
  });

  it('一路下跌 → 0', () => {
    const down = [20, 19, 18, 17, 16, 15, 14];
    const out = rsi(down, 5);
    expect(out[5]).toBeCloseTo(0, 6);
  });

  it('预热期是 null，长度一致', () => {
    const out = rsi(closes, 5);
    expect(out.slice(0, 5).every((v) => v === null)).toBe(true);
    expect(out).toHaveLength(closes.length);
  });

  it('永远落在 0~100', () => {
    const mixed = [10, 12, 11, 13, 12, 14, 13, 15, 14, 16, 15];
    for (const value of rsi(mixed, 3)) {
      if (value === null) continue;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});

describe('closeSeries / seriesData', () => {
  it('收盘价序列按 K 线对齐', () => {
    expect(closeSeries(CANDLES)).toEqual([10, 12, 11, 14]);
  });

  it('seriesData 带上与 K 线相同的 x，并保留中间的空洞', () => {
    const rows = seriesData(CANDLES, [null, 1, null, 3], {}, { trim: false });
    expect(rows.map((row: any) => row.x)).toEqual(['D1', 'D2', 'D3', 'D4']);
    expect(rows.map((row: any) => row.y)).toEqual([null, 1, null, 3]);
  });

  it('默认去掉首尾 null（否则折线会把缺失当成 0 拉出竖直假线）', () => {
    const rows = seriesData(CANDLES, [null, 1, 3, null]);
    expect(rows.map((row: any) => row.x)).toEqual(['D2', 'D3']);
    expect(rows.map((row: any) => row.y)).toEqual([1, 3]);
  });

  it('整列 null 时输出空数组（不是一堆 y:null）', () => {
    expect(seriesData(CANDLES, [null, null, null, null])).toEqual([]);
  });

  it('空系列不炸', () => {
    expect(closeSeries(undefined)).toEqual([]);
    expect(seriesData(undefined, [])).toEqual([]);
  });
});

describe('createOverlaySeries（主图叠加）', () => {
  it('均线绑在价格轴上、类型是 line', () => {
    const series = createOverlaySeries(CANDLES, { ma: [3, 5] }) as any[];
    expect(series).toHaveLength(2);
    expect(series[0].type).toBe('line');
    expect(series[0].yAxisIndex).toBe(0);
    expect(series[0].name).toBe('MA3');
    // MA3 的预热期被裁掉，数据从第一个有效点开始（D3）
    expect(series[0].data.map((row: any) => row.x)).toEqual(['D3', 'D4']);
  });

  it('布林带出三条线', () => {
    const series = createOverlaySeries(CANDLES, { boll: { period: 3 } }) as any[];
    expect(series.map((item) => item.name)).toEqual(['BOLL', 'UP', 'LOW']);
  });

  it('没有 K 线时返回空数组', () => {
    expect(createOverlaySeries(undefined, { ma: [3] })).toEqual([]);
  });
});

describe('createMacdPaneOption（副图）', () => {
  it('柱 + DIF + DEA 三条系列', () => {
    const { series } = createMacdPaneOption(CANDLES, { fast: 2, slow: 3, signal: 2 }) as any;
    expect(series).toHaveLength(3);
    expect(series[0].type).toBe('bar');
    expect(series[1].name).toBe('DIF');
    expect(series[2].name).toBe('DEA');
  });

  it('柱按正负上色', () => {
    const { series } = createMacdPaneOption(CANDLES, { fast: 2, slow: 3, signal: 2 }) as any;
    for (const row of series[0].data) {
      if (row.y === null) continue;
      expect(['#EF4444', '#10B981']).toContain(row.color);
    }
  });

  it('macdRange 给对称的上下界', () => {
    const range = macdRange(CANDLES, { fast: 2, slow: 3, signal: 2 })!;
    expect(range.min).toBeLessThan(0);
    expect(range.max).toBeGreaterThan(0);
    expect(range.max).toBeCloseTo(-range.min, 10);
  });

  it('没有数据时 macdRange 返回 null', () => {
    expect(macdRange(undefined)).toBeNull();
  });
});

describe('createRsiPaneOption（副图）', () => {
  it('一条 RSI + 三条参考线', () => {
    const { series, annotation } = createRsiPaneOption(CANDLES, { period: 2 }) as any;
    expect(series).toHaveLength(1);
    expect(series[0].name).toBe('RSI2');
    expect(annotation.lines.map((line: any) => line.value)).toEqual([70, 50, 30]);
  });
});
