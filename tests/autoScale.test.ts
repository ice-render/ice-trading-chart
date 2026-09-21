import type { ICEChart } from '@damoqiongqiu/ice-chart';
import { createTradingChart, resetAutoScale } from '../src/index';
import type { TradingChartOption } from '../src/types';

/**
 * 右侧数值标尺双击 = 自适应（`resetAutoScale`）。
 *
 * 判据全部走**公开 API 的行为**，不看内部字段：
 * 1. 纵向拖出来的手动 y 窗口被清掉（量程回到 option 给的那一段）；
 * 2. x 窗口**一根不差**地保留（自适应只管 y）；
 * 3. 清掉之后 y 轴真的回到「自动」—— 换一条 option 时量程跟着走。这条是**关键**：
 *    如果实现只是把 y 窗口「写成当前自动值」，量程依旧被视图状态钉住，这条就会挂。
 */

function option(range: { min: number; max: number }): TradingChartOption {
  return {
    legend: { show: false },
    animation: { enabled: false },
    xAxis: { type: 'category' },
    yAxis: { position: 'right', ...range },
    series: [
      {
        id: 'k',
        type: 'candlestick',
        data: [
          { x: 'D1', o: 100, c: 110, l: 95, h: 115 },
          { x: 'D2', o: 110, c: 105, l: 100, h: 118 },
          { x: 'D3', o: 105, c: 120, l: 102, h: 125 },
          { x: 'D4', o: 120, c: 115, l: 111, h: 128 },
          { x: 'D5', o: 115, c: 125, l: 112, h: 130 },
        ],
      },
    ],
  };
}

describe('resetAutoScale（数值轴自适应）', () => {
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

  async function mount(opt: TradingChartOption): Promise<ICEChart> {
    const c = createTradingChart(canvas, opt);
    await c.render();
    chart = c;
    return c;
  }

  it('清掉纵向拖出来的手动 y 窗口，x 窗口原样保留', async () => {
    const c = await mount(option({ min: 90, max: 135 }));
    const auto = c.getDomain('y');
    const x = c.getDomain('x');
    expect(auto[0]).toBeLessThanOrEqual(95);
    expect(auto[1]).toBeGreaterThanOrEqual(130);

    // 模拟纵向拖动（引擎把窗口记进视图状态）
    c.setDomain('y', [110, 125], 'pan');
    expect(c.getDomain('y')).toEqual([110, 125]);

    expect(resetAutoScale(c)).toBe(true);
    // 量程回到 option 给的那一段
    expect(c.getDomain('y')).toEqual(auto);
    // x 窗口一根都不许动
    expect(c.getDomain('x')).toEqual(x);
  });

  it('清掉之后量程真的跟着 option 走（不是「写成当前值」）', async () => {
    const c = await mount(option({ min: 90, max: 135 }));
    c.setDomain('y', [110, 125], 'pan');
    resetAutoScale(c);

    // 页面每次 refresh 都会按可见窗口重算 min/max，再走 preserveView:true 应用
    c.setOption(option({ min: 108, max: 132 }), { animate: false, preserveView: true });
    const next = c.getDomain('y');
    expect(next[0]).toBeLessThanOrEqual(108);
    expect(next[1]).toBeGreaterThanOrEqual(132);
    // 不该还钉在手动窗口上
    expect(next[0]).toBeGreaterThan(100);
  });

  it('没有手动窗口时是幂等的（量程与 x 都不变）', async () => {
    const c = await mount(option({ min: 90, max: 135 }));
    const before = { y: c.getDomain('y'), x: c.getDomain('x') };
    expect(resetAutoScale(c)).toBe(true);
    expect(c.getDomain('y')).toEqual(before.y);
    expect(c.getDomain('x')).toEqual(before.x);
  });
});
