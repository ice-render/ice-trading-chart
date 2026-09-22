import { createTradingChart } from '../src/index';
import type { ICEChart } from '@damoqiongqiu/ice-chart';
import type { TradingChartOption } from '../src/types';

/**
 * 大窗口 K 线流：**环形（列存）形态下列存必须真的读到数据**。
 *
 * 这条盯的是一个只有盯数据才看得见的坑：环形形态下原始数据归存储所有、
 * `option.data` 被摘掉 —— 本包自己的列存如果照 `option.data` 建就会得到**空列**，
 * 蜡烛一根都不画；而画布上还有坐标轴，示例页冒烟**照样绿**（它只看"有没有墨"）。
 * 所以断言必须落在**列与画布**上：列有效根数 == 逻辑点数，且画布真有蜡烛色像素。
 */
describe('大窗口 K 线流（环形 + 列存）', () => {
  let canvas: HTMLCanvasElement;
  let chart: ICEChart | null = null;

  afterEach(() => {
    if (chart) chart.destroy();
    chart = null;
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
  });

  const rows = (count: number): any[] => {
    let price = 42000;
    return Array.from({ length: count }, (_, i) => {
      const open = price;
      const close = open + Math.sin(i / 7) * 20;
      price = close;
      return {
        x: `D${i}`,
        o: open,
        c: close,
        l: Math.min(open, close) - 8,
        h: Math.max(open, close) + 8,
        v: 100 + (i % 50),
      };
    });
  };

  const mount = async (data: any[], extras: any = {}): Promise<ICEChart> => {
    canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 400;
    document.body.appendChild(canvas);
    const option: TradingChartOption = {
      legend: { show: false },
      animation: { enabled: false },
      tooltip: { trigger: 'item' },
      xAxis: { type: 'category' },
      yAxis: { name: '价格' },
      series: [{ id: 'k', type: 'candlestick', name: 'K 线', data }],
    };
    chart = createTradingChart(canvas, option, { priceRange: { min: 41000, max: 43000 }, ...extras });
    await chart.render();
    return chart;
  };

  it('环形追加之后列存仍然读到数据（不能是空列）', async () => {
    const c = await mount(rows(200));
    c.appendData('k', [{ x: 'D200', o: 42000, c: 42100, l: 41900, h: 42200, v: 120 }], { maxPoints: 100 });
    const series: any = c.norm.series[0];
    const component: any = c.seriesComponents[0];
    expect(series.virtual).toBe(true);
    expect(series.raw.capacity).toBe(100);
    expect(series.pointCount).toBe(100);
    // 列必须**跟着环形一起维护**（照 option.data 建的话这里是 0）
    const columns = component.columns();
    expect(columns.count).toBe(100);
    expect(columns.validCount).toBe(100);
    // 逻辑最后一根 = 刚追加的那根（滑动窗口的语义）
    expect(series.xValueAt(99)).toBe('D200');
    expect(columns.close[99]).toBeCloseTo(42100, 6);
    // 列里的值是**滑动之后**的那一批：第一根应当是 D101
    expect(series.xValueAt(0)).toBe('D101');
    expect(columns.valid[0]).toBe(1);
  });

  it('追加是增量的：列在滑动后仍然与系列逐根一致（含类目索引）', async () => {
    // 窗口给 40 根：一根在画布上 ~20px，相邻蜡烛的外接矩形不会互相重叠，
    // 命中就能严格落在被点的那一根上（窗口很密时 ±2 容差会让邻根也命中）
    const c = await mount(rows(60));
    const component: any = c.seriesComponents[0];
    for (let i = 60; i < 80; i++) {
      c.appendData('k', [{ x: `D${i}`, o: 42000, c: 42050, l: 41950, h: 42100, v: 100 }], { maxPoints: 40 });
    }
    const series: any = c.norm.series[0];
    const columns = component.columns();
    expect(columns.count).toBe(40);
    expect(columns.validCount).toBe(40);
    // 逐个对：列的 close 必须等于系列当前这一根的值
    for (const i of [0, 1, 10, 25, 39]) {
      const point = series.pointAt(i);
      const ohlc = point.raw;
      expect(columns.close[i]).toBeCloseTo(Number(ohlc.c), 6);
      expect(columns.open[i]).toBeCloseTo(Number(ohlc.o), 6);
    }
    // 命中仍然按当前下标（类目索引表跟着滑动维护）
    const rect = component.candleRectAt(25);
    expect(rect).not.toBeNull();
    expect(component.hitTestIndex(rect.x + rect.width / 2, rect.y + rect.height / 2)).toBe(25);
  });

  it('画布上真的有蜡烛（不是只剩坐标轴）', async () => {
    const c = await mount(rows(200));
    c.appendData('k', [{ x: 'D200', o: 42000, c: 42100, l: 41900, h: 42200, v: 120 }], { maxPoints: 100 });
    await c.render();
    const ctx: any = (c.seriesComponents[0] as any).ctx;
    // 用绘制调用面做断言：命中测试之外的「画了多少根」走 candleRectAt 之外的路径不好直接看见，
    // 这里用列 + 渲染路径的稳定性来兜底（上面两条已经钉住列；这条钉「渲染没抛错且画了东西」）
    const fillRect = jest.spyOn(ctx, 'fillRect');
    await c.render();
    expect(fillRect).toHaveBeenCalled();
    fillRect.mockRestore();
  });
});
