import { buildVolumeSeries, computeVolumeRange, readVolume } from '../src/volume';
import { resolveCandleStyle } from '../src/series/CandlestickSeries';
import type { TradingSeriesOption } from '../src/types';

const CANDLES: TradingSeriesOption = {
  id: 'k',
  type: 'candlestick',
  name: 'K 线',
  data: [
    { x: 'D1', o: 100, c: 110, l: 95, h: 115, v: 1200 },
    { x: 'D2', o: 110, c: 105, l: 100, h: 118, v: 800 },
    { x: 'D3', o: 105, c: 120, l: 102, h: 125, v: 3000 },
  ],
};

describe('readVolume', () => {
  it('按字段名读，默认 v', () => {
    expect(readVolume({ v: 1200 })).toBe(1200);
    expect(readVolume({ v: '1200' })).toBe(1200);
  });

  it('认长名 volume，也认自定义字段名', () => {
    expect(readVolume({ volume: 900 })).toBe(900);
    expect(readVolume({ 量: 500 }, { field: '量' })).toBe(500);
  });

  it('读不出 / 负数 / 非数值一律 null', () => {
    expect(readVolume({})).toBeNull();
    expect(readVolume({ v: 'abc' })).toBeNull();
    expect(readVolume({ v: -1 })).toBeNull();
    expect(readVolume([1, 2, 3, 4])).toBeNull();
    expect(readVolume(null)).toBeNull();
  });
});

describe('computeVolumeRange（带宽数学）', () => {
  it('上界是 ratio × 最大量，下界固定 0', () => {
    expect(computeVolumeRange([100, 300, 200], 5)).toEqual({ min: 0, max: 1500 });
  });

  it('ratio 默认 5', () => {
    expect(computeVolumeRange([10])).toEqual({ min: 0, max: 50 });
  });

  it('最大量为 0 / 空数组 / 全是脏数据时返回 null（不给空轴）', () => {
    expect(computeVolumeRange([], 5)).toBeNull();
    expect(computeVolumeRange([0, 0], 5)).toBeNull();
    expect(computeVolumeRange([NaN, Infinity], 5)).toBeNull();
  });

  it('ratio 非法时退回默认值', () => {
    expect(computeVolumeRange([10], 0)).toEqual({ min: 0, max: 50 });
    expect(computeVolumeRange([10], Number.NaN)).toEqual({ min: 0, max: 50 });
  });
});

describe('buildVolumeSeries', () => {
  it('生成 bar 系列，绑到第二 y 轴', () => {
    const volume = buildVolumeSeries(CANDLES)!;
    expect(volume.type).toBe('bar');
    expect(volume.id).toBe('k__volume');
    expect((volume as any).yAxisIndex).toBe(1);
  });

  it('逐项配色：涨用涨色、跌用跌色（默认红涨绿跌）', () => {
    const style = resolveCandleStyle(CANDLES);
    const data = (buildVolumeSeries(CANDLES) as any).data;
    expect(data[0].color).toBe(style.upColor); // D1 涨
    expect(data[1].color).toBe(style.downColor); // D2 跌
    expect(data[2].color).toBe(style.upColor); // D3 涨
  });

  it('自定义 candle 配色会传到成交量柱上', () => {
    const source: TradingSeriesOption = {
      ...CANDLES,
      candle: { upColor: '#00ff00', downColor: '#ff0000' },
    };
    const data = (buildVolumeSeries(source) as any).data;
    expect(data[0].color).toBe('#00ff00');
    expect(data[1].color).toBe('#ff0000');
  });

  it('每根都带上和 K 线相同的 x（类目轴靠它对齐）', () => {
    const data = (buildVolumeSeries(CANDLES) as any).data;
    expect(data.map((d: any) => d.x)).toEqual(['D1', 'D2', 'D3']);
  });

  it('读不出量时返回 null，不出空系列', () => {
    expect(buildVolumeSeries({ ...CANDLES, data: [{ x: 'D1', o: 1, c: 2, l: 0, h: 3 }] })).toBeNull();
    expect(buildVolumeSeries(undefined)).toBeNull();
    expect(buildVolumeSeries({ ...CANDLES, data: [] })).toBeNull();
  });

  it('部分读不出量时该位置给 null，其余照画', () => {
    const source: TradingSeriesOption = {
      ...CANDLES,
      data: [{ x: 'D1', o: 100, c: 110, l: 95, h: 115, v: 1200 }, { x: 'D2', o: 110, c: 105, l: 100, h: 118 }],
    };
    const data = (buildVolumeSeries(source) as any).data;
    expect(data[0].value).toBe(1200);
    expect(data[1].value).toBeNull();
  });

  it('自定义字段名与柱宽生效', () => {
    const source: TradingSeriesOption = { ...CANDLES, data: [{ x: 'D1', o: 1, c: 2, l: 0, h: 3, 量: 777 }] };
    const volume: any = buildVolumeSeries(source, { field: '量', barWidth: 0.4 });
    expect(volume.data[0].value).toBe(777);
    expect(volume.barWidth).toBe(0.4);
  });
});
