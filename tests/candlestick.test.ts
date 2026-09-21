import type { ICEChart } from '@damoqiongqiu/ice-chart';
import { createTradingChart } from '../src/index';
import { CandlestickSeries } from '../src/series/CandlestickSeries';
import type { TradingChartOption } from '../src/types';

/** 关掉动画：入场动画期间 `pixelAt` 给的是补间中的位置，会让命中断言飘。 */
const CANDLE_OPTION: TradingChartOption = {
  title: { text: '日 K' },
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

describe('K 线（引擎集成）', () => {
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

  async function mount(option: TradingChartOption, extras = {}): Promise<ICEChart> {
    const c = createTradingChart(canvas, option, extras);
    await c.render();
    return c;
  }

  /** 某个下标在画布上的像素坐标：直接查比例尺，不依赖系列的像素缓存。 */
  function screenOf(c: ICEChart, index: number, price: number): [number, number] {
    const x = c.norm.xAxis.scale!.map(c.norm.series[0].points[index].xValue);
    const y = c.norm.yAxes[0].scale!.map(price);
    return [c.layout.plot.x + x, c.layout.plot.y + y];
  }

  it('用 candlestick 组件渲染（注册的自定义系列真的接管了）', async () => {
    const c = await mount(CANDLE_OPTION);
    expect(c.seriesComponents[0]).toBeInstanceOf(CandlestickSeries);
  });

  it('影线（low/high）进价格轴范围，不会被裁', async () => {
    const c = await mount(CANDLE_OPTION);
    const axis = c.norm.yAxes[0];
    expect(axis.domain[0]).toBeLessThanOrEqual(95);
    expect(axis.domain[1]).toBeGreaterThanOrEqual(125);
  });

  it('命中蜡烛外接矩形（含影线），提示框给四个价', async () => {
    const c = await mount(CANDLE_OPTION);
    const component = c.seriesComponents[0];
    const [sx, sy] = screenOf(c, 1, 110);
    expect(c.ice.hitTest(sx, sy)).toBe(component);
    expect(c.controller.resolveTarget(sx, sy).index).toBe(1);

    c.controller.handlePointerMove(sx, sy);
    const content = c.tooltip!.content!;
    expect(content.rows.map((r) => r.name)).toEqual(['开盘', '收盘', '最低', '最高']);
    expect(content.rows.map((r) => r.value)).toEqual(['110', '105', '100', '118']);
  });

  it('命中判定覆盖影线区间（不是只有实体）', async () => {
    const c = await mount(CANDLE_OPTION);
    // 第二根蜡烛的最高价是 118，收盘价 105：贴着最高价也应当命中
    const [sx, sy] = screenOf(c, 1, 117.5);
    expect(c.controller.resolveTarget(sx, sy).index).toBe(1);
  });

  it('在最高价上方明显处不命中', async () => {
    const c = await mount(CANDLE_OPTION);
    const [sx] = screenOf(c, 0, 110);
    const target = c.controller.resolveTarget(sx, c.layout.plot.y + 2);
    expect(target.index).toBe(-1);
  });

  it('数组形式的数据项同样能画（[开, 收, 低, 高]）', async () => {
    const c = await mount({
      ...CANDLE_OPTION,
      series: [
        {
          id: 'k',
          type: 'candlestick',
          name: 'K 线',
          data: [
            [100, 110, 95, 115],
            [110, 105, 100, 118],
          ],
        },
      ],
    });
    expect(c.seriesComponents[0]).toBeInstanceOf(CandlestickSeries);
    const x = c.norm.xAxis.scale!.map(c.norm.series[0].points[0].xValue);
    const y = c.norm.yAxes[0].scale!.map(110);
    c.controller.handlePointerMove(c.layout.plot.x + x, c.layout.plot.y + y);
    expect(c.tooltip!.content!.rows[0].value).toBe('100');
  });

  it('自定义行名与自定义字段名一路生效', async () => {
    const c = await mount(
      {
        ...CANDLE_OPTION,
        series: [
          {
            id: 'k',
            type: 'candlestick',
            name: 'K 线',
            openField: '开',
            closeField: '收',
            lowField: '低',
            highField: '高',
            data: [
              { x: 'D1', 开: 100, 收: 110, 低: 95, 高: 115 },
              { x: 'D2', 开: 110, 收: 105, 低: 100, 高: 118 },
            ],
          },
        ],
      },
      { priceLabels: { open: 'O', close: 'C', low: 'L', high: 'H' } }
    );
    const x = c.norm.xAxis.scale!.map(c.norm.series[0].points[0].xValue);
    const y = c.norm.yAxes[0].scale!.map(110);
    c.controller.handlePointerMove(c.layout.plot.x + x, c.layout.plot.y + y);
    const content = c.tooltip!.content!;
    expect(content.rows.map((r) => r.name)).toEqual(['O', 'C', 'L', 'H']);
    expect(content.rows[0].value).toBe('100');
  });

  it('价格轴范围随数据变化（appendData 之后重新钉一遍）', async () => {
    const c = await mount(CANDLE_OPTION);
    expect(c.norm.yAxes[0].domain[1]).toBeGreaterThanOrEqual(125);
    c.setData(
      'k',
      CANDLE_OPTION.series[0].data.concat([{ x: 'D4', o: 120, c: 200, l: 118, h: 210 }]) as any
    );
    // setData 只换数据、不重算我们的价格轴；重钉要走 toTradingOption + setOption
    const { toTradingOption } = await import('../src/index');
    c.setOption(
      toTradingOption({
        ...CANDLE_OPTION,
        series: [
          {
            ...CANDLE_OPTION.series[0],
            data: CANDLE_OPTION.series[0].data.concat([{ x: 'D4', o: 120, c: 200, l: 118, h: 210 }]),
          },
        ],
      }) as any,
      { animate: false, preserveView: true }
    );
    await c.render();
    expect(c.norm.yAxes[0].domain[1]).toBeGreaterThanOrEqual(210);
  });

  it('没有 K 线时提示框仍走 ice-chart 默认行为（不装 formatter、不钉价格轴）', async () => {
    const c = await mount({
      ...CANDLE_OPTION,
      yAxis: {},
      series: [{ id: 'l', type: 'line', name: '均线', data: [100, 105, 110] }],
    });
    expect(c.norm.yAxes[0].option.min).toBeUndefined();
    const x = c.norm.xAxis.scale!.map(c.norm.series[0].points[1].xValue);
    const y = c.norm.yAxes[0].scale!.map(105);
    c.controller.handlePointerMove(c.layout.plot.x + x, c.layout.plot.y + y);
    expect(c.tooltip!.content).not.toBeNull();
  });
});
