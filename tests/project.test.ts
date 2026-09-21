import type { ICEChart } from '@damoqiongqiu/ice-chart';
import { createTradingChart } from '../src/index';
import { categoryToX, plotRect, priceToY, xToCategoryIndex, yToPrice } from '../src/project';
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
        { x: 'D1', o: 100, c: 110, l: 95, h: 115 },
        { x: 'D2', o: 110, c: 105, l: 100, h: 118 },
        { x: 'D3', o: 105, c: 120, l: 102, h: 125 },
      ],
    },
  ],
};

describe('project（画布内坐标投影）', () => {
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

  it('plotRect 给出绘图区矩形（画布 CSS 像素）', async () => {
    const c = await mount();
    const rect = plotRect(c)!;
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
    expect(rect.x).toBeGreaterThanOrEqual(0);
  });

  it('价格 → y → 价格 往返一致', async () => {
    const c = await mount();
    for (const price of [95, 100, 110.5, 125]) {
      const y = priceToY(c, price)!;
      expect(y).toBeGreaterThanOrEqual(plotRect(c)!.y - 1);
      expect(y).toBeLessThanOrEqual(plotRect(c)!.y + plotRect(c)!.height + 1);
      expect(yToPrice(c, y)!).toBeCloseTo(price, 6);
    }
  });

  it('价格越高 y 越小（屏幕坐标向下）', async () => {
    const c = await mount();
    expect(priceToY(c, 120)!).toBeLessThan(priceToY(c, 100)!);
  });

  it('类目 → x：逐根递增，且落在绘图区内', async () => {
    const c = await mount();
    const rect = plotRect(c)!;
    const xs = ['D1', 'D2', 'D3'].map((name) => categoryToX(c, name)!);
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(rect.x);
      expect(x).toBeLessThanOrEqual(rect.x + rect.width);
    }
  });

  it('x → 类目下标：与 categoryToX 互为逆运算', async () => {
    const c = await mount();
    for (let i = 0; i < 3; i++) {
      const x = categoryToX(c, ['D1', 'D2', 'D3'][i])!;
      expect(xToCategoryIndex(c, x)).toBe(i);
    }
  });

  it('读不出的输入返回 null，而不是 NaN', async () => {
    const c = await mount();
    expect(priceToY(c, Number.NaN)).toBeNull();
    expect(yToPrice(c, Number.NaN)).toBeNull();
    expect(categoryToX(c, '不存在')).toBeNull();
    expect(xToCategoryIndex(c, 0)).toBeNull(); // 0 不在任何类目带内
  });

  it('成交量轴也能投影（副图落点靠它算）', async () => {
    const c = await mount({
      ...OPTION,
      series: [
        {
          ...OPTION.series[0],
          data: [
            { x: 'D1', o: 100, c: 110, l: 95, h: 115, v: 100 },
            { x: 'D2', o: 110, c: 105, l: 100, h: 118, v: 200 },
            { x: 'D3', o: 105, c: 120, l: 102, h: 125, v: 300 },
          ],
        },
      ],
    });
    const rect = plotRect(c)!;
    const maxVolumeY = priceToY(c, 300, 1)!;
    // 默认 ratio 5 → 最大量正好落在绘图区底部 20% 处
    expect(maxVolumeY).toBeCloseTo(rect.y + rect.height * 0.8, 3);
  });
});
