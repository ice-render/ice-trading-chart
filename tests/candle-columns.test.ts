import { createTradingChart } from '../src/index';
import { buildCandleColumns, candleColumns, invalidateCandleColumns } from '../src/series/candleColumns';
import { computePriceRange } from '../src/axisRange';
import type { ICEChart } from '@damoqiongqiu/ice-chart';
import type { TradingChartOption } from '../src/types';

/**
 * K 线列存：四个价解析一次，之后渲染 / 命中 / 量程都按标量读。
 *
 * 这一层要守住三件事：
 * ① 读不出的根**不进列**（`valid[i] === 0`）—— 不补 0、不补前值；
 * ② 同一份数据只建一次列（渲染与价格轴量程**共用**同一份，不各扫一遍）；
 * ③ 列存能被正确失效（原地改值要显式失效，换数组 / 改长度自动失效）。
 */
describe('K 线列存（纯函数）', () => {
  const rows = [
    { x: 'D1', o: 100, c: 110, l: 95, h: 115 },
    { x: 'D2', o: 110, c: 105, l: 100, h: 118 },
    { x: 'D3', o: 105, c: 120, l: 102, h: 125 },
  ];

  it('建列：四个价 + 有效标记 + 影线极值 + 类目索引', () => {
    const columns = buildCandleColumns(rows);
    expect(columns.count).toBe(3);
    expect(columns.validCount).toBe(3);
    expect(Array.from(columns.open)).toEqual([100, 110, 105]);
    expect(Array.from(columns.close)).toEqual([110, 105, 120]);
    expect(Array.from(columns.low)).toEqual([95, 100, 102]);
    expect(Array.from(columns.high)).toEqual([115, 118, 125]);
    expect(columns.priceMin).toBe(95);
    expect(columns.priceMax).toBe(125);
    expect(columns.indexOfX.get('D2')).toBe(1);
  });

  it('读不出的根不进列（valid = 0），也不算进极值', () => {
    const columns = buildCandleColumns([rows[0], { x: 'D2', o: 1 }, null, rows[2]]);
    expect(columns.count).toBe(4);
    expect(columns.validCount).toBe(2);
    expect(Array.from(columns.valid)).toEqual([1, 0, 0, 1]);
    expect(columns.priceMin).toBe(95);
    expect(columns.priceMax).toBe(125);
  });

  it('数组形态的数据项同样认（[开, 收, 低, 高]），x 取下标', () => {
    const columns = buildCandleColumns([
      [100, 110, 95, 115],
      [110, 105, 100, 118],
    ]);
    expect(columns.validCount).toBe(2);
    expect(columns.indexOfX.get('1')).toBe(1);
  });

  it('同一份数据只建一次列：渲染与价格轴量程共用（同一把尺子）', () => {
    const data = rows.slice();
    const first = candleColumns(data);
    expect(candleColumns(data)).toBe(first);
    // 价格轴量程读的也是这一份
    expect(computePriceRange([{ id: 'k', type: 'candlestick', data } as any])).toEqual({ min: 93.2, max: 126.8 });
    expect(candleColumns(data)).toBe(first);
  });

  it('换字段名是另一份列；换数组 / 改长度自动失效；原地改值要显式失效', () => {
    const data = rows.slice();
    const byShort = candleColumns(data);
    // 字段名是**回退链**（配置名 → 长名 → 短名），所以这份只有短名的数据两种签名都能读出来，
    // 但它们是两份不同的列（签名进了缓存键）
    const byLong = candleColumns(data, { openField: 'open', closeField: 'close', lowField: 'low', highField: 'high' });
    expect(byLong).not.toBe(byShort);
    expect(byLong.validCount).toBe(3);

    const grown = rows.concat([{ x: 'D4', o: 120, c: 130, l: 118, h: 132 } as any]);
    expect(candleColumns(grown).count).toBe(4);

    const mutated = rows.slice();
    candleColumns(mutated);
    (mutated[0] as any).c = 999;
    expect(candleColumns(mutated).close[0]).toBe(110); // 等长原地改值不会被发现
    invalidateCandleColumns(mutated);
    expect(candleColumns(mutated).close[0]).toBe(999); // 显式失效之后才重建
  });
});

describe('K 线窗口裁剪与压缩模式（引擎集成）', () => {
  let canvas: HTMLCanvasElement;
  let chart: ICEChart | null = null;

  afterEach(() => {
    if (chart) chart.destroy();
    chart = null;
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
  });

  const makeRows = (count: number): any[] =>
    Array.from({ length: count }, (_, i) => {
      // 四价必须**自洽**（low ≤ min(o,c) ≤ max(o,c) ≤ high）：各自独立的正弦会造出
      // 「收盘价高于最高价」的假数据，命中判定按 high/low 卡框时就永远命不中（踩过）
      const open = 100 + Math.sin(i / 7) * 5;
      const close = open + Math.sin(i / 5) * 2;
      return {
        x: `D${i}`,
        o: open,
        c: close,
        l: Math.min(open, close) - 3,
        h: Math.max(open, close) + 3,
      };
    });

  const mount = async (count: number): Promise<ICEChart> => {
    canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 400;
    document.body.appendChild(canvas);
    const option: TradingChartOption = {
      legend: { show: false },
      animation: { enabled: false },
      xAxis: { type: 'category' },
      yAxis: { name: '价格' },
      series: [{ id: 'k', type: 'candlestick', name: 'K 线', data: makeRows(count) }],
    };
    chart = createTradingChart(canvas, option);
    await chart.render();
    return chart;
  };

  it('可见窗口 = 窗口内的类目（缩放后 ≤ 窗口 + 两端留余量），不是全量', async () => {
    const c = await mount(20000);
    const comp: any = c.seriesComponents[0];
    expect(comp.visibleRange().to - comp.visibleRange().from + 1).toBeGreaterThan(1000);

    // 缩到中间 30 根
    c.setDomain('x', ['D10000', 'D10029'], 'api');
    await c.render();
    const range = comp.visibleRange();
    expect(range.from).toBe(9998);
    expect(range.to).toBe(10031);
  });

  it('命中只碰窗口：缩放后窗口外的 x 不再命中', async () => {
    const c = await mount(20000);
    const comp: any = c.seriesComponents[0];
    c.setDomain('x', ['D10000', 'D10029'], 'api');
    await c.render();
    const plot = c.layout.plot;
    // 窗口内第一根的中心
    const x = c.norm.xAxis.scale!.map('D10000');
    const y = c.norm.yAxes[0].scale!.map(comp.columns().close[10000]);
    expect(comp.hitTestIndex(x, y)).toBe(10000);
    // 窗口外（最左端之外）不命中
    expect(comp.hitTestIndex(plot.width + 50, y)).toBe(-1);
  });

  it('极端缩小（一屏几千根）走压缩模式：每像素列一根高低线，不画实体', async () => {
    const c = await mount(20000);
    const comp: any = c.seriesComponents[0];
    const ctx: any = comp.ctx;
    const fillRect = jest.spyOn(ctx, 'fillRect');
    const stroke = jest.spyOn(ctx, 'stroke');
    await c.render();
    // 压缩模式只描线，不填实体
    expect(stroke).toHaveBeenCalled();
    expect(fillRect).not.toHaveBeenCalled();
    fillRect.mockRestore();
    stroke.mockRestore();
  });

  it('压缩模式的落墨量按**像素列**封顶（不随根数涨），且列内极值仍然真实', async () => {
    // 两万根挤在 640px 上：每列约 31 根 —— 逐根扫/逐根画都说不通
    const c = await mount(20000);
    const comp: any = c.seriesComponents[0];
    const ctx: any = comp.ctx;
    const stroke = jest.spyOn(ctx, 'stroke');
    // 塞一根极端影线：列内极值必须带出来（抽样只抽「候选」，不是把极值抽掉）
    const data = (c.getOption().series![0] as any).data as any[];
    data[10000].h = 999;
    data[10000].l = -999;
    c.setData('k', data);
    await c.render();
    // 只数**这一帧**：setData 自己也会触发一次绘制
    stroke.mockClear();
    await c.render();
    const strokes = stroke.mock.calls.length;
    const plotWidth = Math.round(c.layout.plot.width);
    expect(strokes).toBeGreaterThan(0);
    // 落墨量按像素列封顶（同一帧里可能画了两趟：数据变动 + 显式 render，所以留 20% 余量；
    // 逐根画的话这里是 2 万而不是 600 上下）
    expect(strokes).toBeGreaterThan(plotWidth * 0.5);
    expect(strokes).toBeLessThan(plotWidth * 1.2);
    // 那条极值所在像素列的 y 跨度应当明显大于普通列（用 lineTo 的入参看高度）
    const lineTo = jest.spyOn(ctx, 'lineTo');
    await c.render();
    const spans = lineTo.mock.calls
      .filter((call: any[]) => call.length >= 2)
      .map((call: any[]) => Math.abs(Number(call[1]) - Number(call[0])));
    // 极端影线没有被抽掉
    expect(Math.max(...spans)).toBeGreaterThan(c.layout.plot.height * 0.5);
    stroke.mockRestore();
    lineTo.mockRestore();
  });

  it('正常缩放（一屏几十根）仍然逐根画实体', async () => {
    const c = await mount(20000);
    const comp: any = c.seriesComponents[0];
    // 先缩到一屏几十根，否则全量视图走的是压缩模式
    c.setDomain('x', ['D10000', 'D10029'], 'api');
    await c.render();
    const ctx: any = comp.ctx;
    const fillRect = jest.spyOn(ctx, 'fillRect');
    await c.render();
    expect(fillRect).toHaveBeenCalled();
    fillRect.mockRestore();
  });
});
