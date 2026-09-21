import { createChart } from '@damoqiongqiu/ice-chart';
import type { ChartOption } from '@damoqiongqiu/ice-chart';
import { registerTradingSeries, toTradingOption } from '../src/index';
import type { TradingChartOption } from '../src/types';

const CANDLE: TradingChartOption = {
  legend: { show: false },
  xAxis: { type: 'category' },
  yAxis: { name: '价格' },
  series: [
    {
      id: 'k',
      type: 'candlestick',
      name: 'K 线',
      data: [
        { x: 'D1', o: 100, c: 110, l: 95, h: 115 },
        { x: 'D2', o: 110, c: 105, l: 100, h: 118 },
        { x: 'D3', o: 105, c: 120, l: 102, h: 125 },
      ],
    },
  ],
};

describe('toTradingOption', () => {
  it('给 K 线系列补上 yField（默认收盘价字段）', () => {
    const option = toTradingOption(CANDLE);
    expect(option.series[0].yField).toBe('c');
  });

  it('yField 已经写了就不动', () => {
    const option = toTradingOption({
      ...CANDLE,
      series: [{ ...CANDLE.series[0], yField: 'close' }],
    });
    expect(option.series[0].yField).toBe('close');
  });

  it('自定义 closeField 时 yField 跟着走', () => {
    const option = toTradingOption({
      series: [{ id: 'k', type: 'candlestick', closeField: '收', data: [{ x: 'D1', 收: 110 }] }],
    });
    expect(option.series[0].yField).toBe('收');
  });

  it('xAxis 默认类目轴（等宽 K 线、跳过非交易时段）', () => {
    const option = toTradingOption({ series: CANDLE.series });
    expect(option.xAxis).toEqual({ type: 'category' });
  });

  it('用户显式写的 xAxis 不被覆盖', () => {
    const option = toTradingOption({ ...CANDLE, xAxis: { type: 'time' } });
    expect(option.xAxis).toEqual({ type: 'time' });
  });

  it('价格轴按含影线的极值钉住 min / max', () => {
    const option = toTradingOption(CANDLE, { pricePadding: 0 });
    expect(option.yAxis).toMatchObject({ min: 95, max: 125 });
    expect((option.yAxis as any).name).toBe('价格');
  });

  it('用户给了 min / max 的那一侧不被覆盖', () => {
    const option = toTradingOption(
      { ...CANDLE, yAxis: { min: 0, max: 'dataMax' } } as TradingChartOption,
      { pricePadding: 0 }
    );
    // min 是显式数字 → 不动；max 是 'dataMax'（跟随数据）→ 也不该被钉死
    expect((option.yAxis as any).min).toBe(0);
    expect((option.yAxis as any).max).toBe('dataMax');
  });

  it('autoPriceRange: false 时完全不碰 yAxis', () => {
    const option = toTradingOption(CANDLE, { autoPriceRange: false });
    expect((option.yAxis as any).min).toBeUndefined();
    expect((option.yAxis as any).max).toBeUndefined();
  });

  it('yAxis 是数组时只钉第一个轴', () => {
    const option = toTradingOption(
      { ...CANDLE, yAxis: [{ name: '价格' }, { name: '成交量', position: 'right' }] } as TradingChartOption,
      { pricePadding: 0 }
    );
    expect((option.yAxis as any[])[0]).toMatchObject({ min: 95, max: 125 });
    expect((option.yAxis as any[])[1]).not.toHaveProperty('min');
  });

  it('默认装 OHLC 提示框 formatter，且触发方式为 axis（整列读数）', () => {
    const option = toTradingOption(CANDLE);
    expect(option.tooltip!.trigger).toBe('axis');
    expect(typeof option.tooltip!.formatter).toBe('function');
  });

  it('用户自带 formatter 时不覆盖', () => {
    const mine = () => 'x';
    const option = toTradingOption({ ...CANDLE, tooltip: { formatter: mine } });
    expect(option.tooltip!.formatter).toBe(mine);
  });

  it('没有 K 线系列时完全不碰 tooltip 与 yAxis', () => {
    const option = toTradingOption({
      series: [{ id: 'l', type: 'line', data: [1, 2, 3] }],
    });
    expect(option.tooltip).toBeUndefined();
    expect(option.yAxis).toBeUndefined();
  });
});

describe('registerTradingSeries', () => {
  it('把 candlestick 注册成自定义系列（幂等，可重复调用）', () => {
    registerTradingSeries();
    registerTradingSeries();
    const chart = createChart(document.createElement('canvas'), toTradingOption(CANDLE) as ChartOption);
    expect(chart.seriesComponents[0].constructor.name).toBe('CandlestickSeries');
    chart.destroy();
  });
});
