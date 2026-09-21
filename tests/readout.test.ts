import type { ICEChart } from '@damoqiongqiu/ice-chart';
import { createOhlcReadout, createTradingChart } from '../src/index';
import type { TradingChartOption } from '../src/types';

const OPTION: TradingChartOption = {
  legend: { show: false },
  animation: { enabled: false },
  xAxis: { type: 'category' },
  yAxis: { name: '价格' },
  series: [
    {
      id: 'k',
      type: 'candlestick',
      name: 'K 线',
      data: [
        { x: 'D1', o: 100, c: 110, l: 95, h: 115, v: 1200 },
        { x: 'D2', o: 110, c: 105, l: 100, h: 118, v: 800 },
        { x: 'D3', o: 105, c: 120, l: 102, h: 125, v: 3000 },
      ],
    },
  ],
};

describe('createOhlcReadout（抬头数据源）', () => {
  let canvas: HTMLCanvasElement;
  let chart: ICEChart | null = null;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 400;
    document.body.appendChild(canvas);
  });

  afterEach(() => {
    if (chart) chart.destroy();
    chart = null;
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  });

  async function mount(option: TradingChartOption = OPTION): Promise<ICEChart> {
    const c = createTradingChart(canvas, option);
    await c.render();
    return c;
  }

  it('没有光标时读最后一根', async () => {
    const c = await mount();
    const readout = createOhlcReadout(c);
    const reading = readout.read()!;
    expect(reading.index).toBe(2);
    expect(reading.xValue).toBe('D3');
    expect([reading.open, reading.high, reading.low, reading.close]).toEqual([105, 125, 102, 120]);
    expect(reading.volume).toBe(3000);
  });

  it('涨跌以**上一根收盘**为基准', async () => {
    const c = await mount();
    const readout = createOhlcReadout(c);
    // D3：收 120，上一根收 105 → +15
    const third = readout.read(2)!;
    expect(third.change).toBeCloseTo(15, 6);
    expect(third.changePct).toBeCloseTo((15 / 105) * 100, 6);
    expect(third.rising).toBe(true);
    // D2：收 105，上一根收 110 → −5
    const second = readout.read(1)!;
    expect(second.change).toBeCloseTo(-5, 6);
    expect(second.rising).toBe(false);
  });

  it('第一根退化成「收 − 开」', async () => {
    const c = await mount();
    const readout = createOhlcReadout(c);
    const first = readout.read(0)!;
    expect(first.change).toBeCloseTo(10, 6); // 110 - 100
    expect(first.changePct).toBeCloseTo(10, 6);
  });

  it('下标越界会被夹到有效范围', async () => {
    const c = await mount();
    const readout = createOhlcReadout(c);
    expect(readout.read(99)!.index).toBe(2);
    expect(readout.read(-5)!.index).toBe(0);
  });

  it('光标落在某一列时跟随光标', async () => {
    const c = await mount();
    const readout = createOhlcReadout(c);
    const x = c.norm.xAxis.scale!.map('D1');
    const y = c.norm.yAxes[0].scale!.map(110);
    c.controller.handlePointerMove(c.layout.plot.x + x, c.layout.plot.y + y);
    expect(readout.read()!.index).toBe(0);
    expect(readout.read()!.xValue).toBe('D1');
  });

  it('光标离开后回落到最后一根', async () => {
    const c = await mount();
    const readout = createOhlcReadout(c);
    const x = c.norm.xAxis.scale!.map('D1');
    const y = c.norm.yAxes[0].scale!.map(110);
    c.controller.handlePointerMove(c.layout.plot.x + x, c.layout.plot.y + y);
    expect(readout.read()!.index).toBe(0);
    c.clearHover();
    expect(readout.read()!.index).toBe(2);
  });

  it('subscribe 在光标变化时推新读数，取消订阅后不再推', async () => {
    const c = await mount();
    const readout = createOhlcReadout(c);
    const seen: number[] = [];
    const off = readout.subscribe((reading) => seen.push(reading ? reading.index : -1));
    const x = c.norm.xAxis.scale!.map('D2');
    const y = c.norm.yAxes[0].scale!.map(105);
    c.controller.handlePointerMove(c.layout.plot.x + x, c.layout.plot.y + y);
    expect(seen).toContain(1);
    off();
    const before = seen.length;
    c.clearHover();
    expect(seen.length).toBe(before);
  });

  it('volume: false 时不给量', async () => {
    const c = await mount(OPTION);
    const readout = createOhlcReadout(c, { volume: false });
    expect(readout.read()!.volume).toBeNull();
  });

  it('数据里没有量时 volume 是 null', async () => {
    const c = await mount({
      ...OPTION,
      series: [{ ...OPTION.series[0], data: [{ x: 'D1', o: 100, c: 110, l: 95, h: 115 }] }],
    });
    const readout = createOhlcReadout(c);
    expect(readout.read()!.volume).toBeNull();
  });

  it('没有 K 线系列时返回 null', async () => {
    const c = await mount({
      legend: { show: false },
      xAxis: { type: 'category' },
      yAxis: {},
      series: [{ id: 'l', type: 'line', data: [1, 2, 3] }],
    });
    expect(createOhlcReadout(c).read()).toBeNull();
  });

  it('seriesId 指定读哪个系列', async () => {
    const c = await mount();
    const readout = createOhlcReadout(c, { seriesId: '不存在' });
    // 指定了不存在的 id 时退回第一个 candlestick 系列，而不是返回 null
    expect(readout.read()!.index).toBe(2);
  });
});
