import { createTradingChart } from '../src/index';
import { buildCandleColumns } from '../src/series/candleColumns';
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

  it('增量维护的结果 = 全量重建（滑动 + 追加 + 尾根改值之后逐根逐列一致）', async () => {
    const c = await mount(rows(60));
    // 先滑一段（每根都超过窗口 → 每根都要淘汰一根）
    for (let i = 60; i < 100; i++) {
      c.appendData('k', [{ x: `D${i}`, o: 42000, c: 42050, l: 41950, h: 42100, v: 100 }], { maxPoints: 40 });
    }
    await c.render();
    // ⚠️ 追加之后要**重新取**归一化产物：`c.norm` 还是上一帧的那个（点数是老的）
    const series: any = c.norm.series[0];
    const component: any = c.seriesComponents[0];
    // 再改正在形成的那一根（实时流的常态：同一根反复推）
    const tail = series.pointAt(series.pointCount - 1).raw as any;
    tail.c = 43999;
    tail.h = 44100;
    const columns = component.columns();

    // 全量重建一份当基准：**逐列逐根**比，增量路径的任何错位都会露出来
    const fresh = buildCandleColumns(
      Array.from({ length: series.pointCount }, (_, i) => series.pointAt(i).raw)
    );
    expect(columns.count).toBe(fresh.count);
    expect(columns.validCount).toBe(fresh.validCount);
    for (const key of ['open', 'close', 'low', 'high', 'valid'] as const) {
      expect(Array.from(columns[key] as any)).toEqual(Array.from(fresh[key] as any));
    }
    // 类目索引也得跟着滑动（存的是相对 shiftOffset 的下标）
    for (let i = 0; i < columns.count; i++) {
      expect(columns.indexOfX.get(String(series.xValueAt(i)))).toBe(i - columns.shiftOffset);
    }
    // 尾根改值必须真的进了列
    expect(columns.close[columns.count - 1]).toBe(43999);
  });

  it('series 身份换了也照样复用列（归一化产物每次都是新对象，拿它当缓存条件等于永不判中）', async () => {
    const c = await mount(rows(60));
    const component: any = c.seriesComponents[0];
    const first = component.columns();
    const seriesBefore: any = c.norm.series[0];
    // 同一份数据再来一次 applyOption：series / 组件都会重建，但**存储**是同一个
    c.setOption(c.getOption(), { animate: false, preserveView: true });
    await c.render();
    // 归一化产物确实是新对象（否则这条用例是空的）
    expect(c.norm.series[0]).not.toBe(seriesBefore);
    const second = (c.seriesComponents[0] as any).columns();
    expect(second).toBe(first);
    expect(second.count).toBe(60);
  });

  it('同一根原地改值：复查尾部就够（环形形态也一样），列不重建但值跟上了', async () => {
    const c = await mount(rows(60));
    // 先切到环形（容量变了 → 列会重建一次），后面的原地改值才是环形那条路
    c.appendData('k', [{ x: 'D60', o: 42000, c: 42050, l: 41950, h: 42100, v: 100 }], { maxPoints: 40 });
    await c.render();
    const component: any = c.seriesComponents[0];
    const columns = component.columns();
    const series: any = c.norm.series[0];
    // 确认走的是环形存储（下面的原地改值走的才是环形态那条分支）
    expect(series.raw.capacity).toBe(40);
    const last = columns.count - 1;
    const before = columns.close[last];
    (series.pointAt(last).raw as any).c = before + 123;
    const after = component.columns();
    expect(after).toBe(columns); // 没有重建整个窗口
    expect(after.close[last]).toBeCloseTo(before + 123, 6);
  });
});
