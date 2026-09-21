import { MAX_DEVICE_PIXEL_RATIO, defaultDevicePixelRatio, resolveDpr } from '../src/device';
import { createTradingChart } from '../src/index';
import { createPaneStack } from '../src/panes';
import { resolveCandleStyle } from '../src/series/CandlestickSeries';
import type { TradingChartOption } from '../src/types';

const OPTION: TradingChartOption = {
  legend: { show: false },
  animation: { enabled: false },
  xAxis: { type: 'category' },
  yAxis: {},
  volume: false,
  series: [
    {
      id: 'k',
      type: 'candlestick',
      name: 'K 线',
      data: [
        { x: 'D1', o: 100, c: 110, l: 95, h: 115 },
        { x: 'D2', o: 110, c: 105, l: 100, h: 118 },
      ],
    },
  ],
};

describe('resolveDpr', () => {
  it('不传时用环境值，上限 3（再高只是白烧显存）', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    Object.defineProperty(window, 'devicePixelRatio', { value: 5, configurable: true });
    expect(defaultDevicePixelRatio()).toBe(MAX_DEVICE_PIXEL_RATIO);
    expect(resolveDpr()).toBe(MAX_DEVICE_PIXEL_RATIO);
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    expect(resolveDpr()).toBe(2);
    if (original) Object.defineProperty(window, 'devicePixelRatio', original);
  });

  it('显式传的优先（传 1 就是旧行为）', () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true });
    expect(resolveDpr(1)).toBe(1);
    expect(resolveDpr(2)).toBe(2);
  });

  it('非法值退回 1', () => {
    expect(resolveDpr(0)).toBe(1);
    expect(resolveDpr(-2)).toBe(1);
    expect(resolveDpr(Number.NaN)).toBe(1);
  });
});

describe('默认按设备像素比渲染', () => {
  it('createTradingChart 会把环境 dpr 传给引擎（不传就是 1x 位图被浏览器放大 = 糊）', async () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const chart = createTradingChart(canvas, OPTION);
    await chart.render();
    expect(chart.ice.dpr).toBe(2);
    chart.destroy();
  });

  it('显式 extras.dpr 可以覆盖（截图对比 / 省显存）', async () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true });
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const chart = createTradingChart(canvas, OPTION, { dpr: 1 });
    await chart.render();
    expect(chart.ice.dpr).toBe(1);
    chart.destroy();
  });

  it('pane 栈的每一块都用同一个 dpr（否则各 pane 的清晰度不一致）', async () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    const host = document.createElement('div');
    host.style.width = '600px';
    document.body.appendChild(host);
    const stack = createPaneStack(
      host,
      [
        { id: 'a', primary: true, option: OPTION },
        { id: 'b', option: { legend: { show: false }, xAxis: { type: 'category' }, yAxis: {}, series: [{ id: 's', type: 'line', data: [1, 2] }] } },
      ],
      { height: 400, link: false }
    );
    for (const chart of stack.charts) await chart.render();
    expect(stack.charts.map((chart) => chart.ice.dpr)).toEqual([2, 2]);
    stack.destroy();
  });
});

describe('蜡烛样式（resolveCandleStyle）', () => {
  it('默认：红涨绿跌、1px 线、实心', () => {
    const style = resolveCandleStyle({ id: 'k', type: 'candlestick' });
    expect(style.upColor).toBe('#EF4444');
    expect(style.downColor).toBe('#10B981');
    expect(style.borderWidth).toBe(1);
    expect(style.hollowUp).toBe(false);
  });

  it('hollowUp 只有显式 true 才开', () => {
    expect(resolveCandleStyle({ id: 'k', type: 'candlestick', candle: { hollowUp: true } }).hollowUp).toBe(true);
    expect(resolveCandleStyle({ id: 'k', type: 'candlestick', candle: { hollowUp: false } }).hollowUp).toBe(false);
    expect(resolveCandleStyle(undefined).hollowUp).toBe(false);
  });
});
