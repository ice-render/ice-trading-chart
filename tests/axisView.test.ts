import type { ICEChart } from '@damoqiongqiu/ice-chart';
import {
  applyValueAxisScale,
  beginValueAxisScale,
  createTradingChart,
  resetAutoScale,
  yToPrice,
  zoomValueAxis,
} from '../src/index';
import type { TradingChartOption } from '../src/types';

/**
 * 右侧数值标尺上的两个动作：双击 = 自适应（`resetAutoScale`）、滚轮 = 缩放（`zoomValueAxis`）。
 *
 * 判据全部走**公开 API 的行为**，不看内部字段：
 * 1. 纵向拖出来的手动 y 窗口被清掉（量程回到 option 给的那一段）；
 * 2. x 窗口**一根不差**地保留（自适应只管 y）；
 * 3. 清掉之后 y 轴真的回到「自动」—— 换一条 option 时量程跟着走。这条是**关键**：
 *    如果实现只是把 y 窗口「写成当前自动值」，量程依旧被视图状态钉住，这条就会挂。
 * 4. 缩放：窗口变窄 / 变宽、锚点处的价格纹丝不动、上下限跟着 `interaction.zoom` 走。
 * 5. 拖拽：向上拖 = 放大、向下拖 = 缩小、拖回出发点 = 窗口原样（不累积误差）；
 *    以及「标尺精度跟着窗口走」——窗口一细，刻度标签自动多带小数位。
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

describe('数值轴的视图控制（标尺双击自适应 / 标尺滚轮缩放）', () => {
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

  it('双击语义：清掉纵向拖出来的手动 y 窗口，x 窗口原样保留', async () => {
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

  it('双击语义：清掉之后量程真的跟着 option 走（不是「写成当前值」）', async () => {
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

  it('双击语义：没有手动窗口时是幂等的（量程与 x 都不变）', async () => {
    const c = await mount(option({ min: 90, max: 135 }));
    const before = { y: c.getDomain('y'), x: c.getDomain('x') };
    expect(resetAutoScale(c)).toBe(true);
    expect(c.getDomain('y')).toEqual(before.y);
    expect(c.getDomain('x')).toEqual(before.x);
  });

  it('滚轮语义：以指针为锚点缩放，锚点处的价格不动、时间窗口不动', async () => {
    const c = await mount(option({ min: 90, max: 135 }));
    const x = c.getDomain('x');
    const full = c.fullDomain('y').map(Number);
    const span0 = Number(c.getDomain('y')[1]) - Number(c.getDomain('y')[0]);
    const plot = c.layout.plot;
    const anchorY = plot.y + plot.height / 2;
    const anchor = yToPrice(c, anchorY) as number;
    expect(anchor).toBeGreaterThan(full[0]);
    expect(anchor).toBeLessThan(full[1]);

    // 放大：窗口变窄，指针指着的那个价格还在原处
    expect(zoomValueAxis(c, { factor: 1.2, anchorY })).toBe(true);
    const zoomed = c.getDomain('y').map(Number);
    expect(zoomed[1] - zoomed[0]).toBeLessThan(span0);
    expect(zoomed[1] - zoomed[0]).toBeCloseTo(span0 / 1.2, 6);
    expect(yToPrice(c, anchorY)).toBeCloseTo(anchor, 6);
    expect(c.getDomain('x')).toEqual(x);

    // 缩小：窗口变宽，但**不许超出完整数据域**（maxSpan 默认 1）
    expect(zoomValueAxis(c, { factor: 1 / 3, anchorY })).toBe(true);
    const out = c.getDomain('y').map(Number);
    expect(out[0]).toBeGreaterThanOrEqual(full[0] - 1e-9);
    expect(out[1]).toBeLessThanOrEqual(full[1] + 1e-9);
    expect(out[1] - out[0]).toBeGreaterThan(zoomed[1] - zoomed[0]);
  });

  it('滚轮语义：放大有下限（`interaction.zoom.minSpan`）', async () => {
    const c = await mount(option({ min: 90, max: 135 }));
    const full = c.fullDomain('y').map(Number);
    const minSpan = (full[1] - full[0]) * 0.05;
    for (let i = 0; i < 80; i++) zoomValueAxis(c, { factor: 2, anchorY: 200 });
    const y = c.getDomain('y').map(Number);
    // 完整数据域的 5%，再密就停住
    expect(y[1] - y[0]).toBeGreaterThanOrEqual(minSpan - 1e-9);
    expect(y[1] - y[0]).toBeLessThan(minSpan + 1e-6);
  });

  it('两个动作是一对：缩出来的手动窗口，双击就还回去', async () => {
    const c = await mount(option({ min: 90, max: 135 }));
    const auto = c.getDomain('y');
    zoomValueAxis(c, { factor: 1.5 });
    expect(c.getDomain('y')).not.toEqual(auto);
    expect(resetAutoScale(c)).toBe(true);
    expect(c.getDomain('y')).toEqual(auto);
  });

  it('拖拽语义：向上拖 = 放大、向下拖 = 缩小，窗口中心不动', async () => {
    const c = await mount(option({ min: 90, max: 135 }));
    const before = c.getDomain('y').map(Number);
    const span0 = before[1] - before[0];
    const center0 = (before[0] + before[1]) / 2;
    const plot = c.layout.plot;
    const startY = plot.y + plot.height / 2;
    const scale = beginValueAxisScale(c, startY);
    expect(scale).not.toBeNull();

    // 向上拖（y 变小）= 放大
    expect(applyValueAxisScale(c, scale!, startY - 60)).toBe(true);
    const inSpan = Number(c.getDomain('y')[1]) - Number(c.getDomain('y')[0]);
    expect(inSpan).toBeLessThan(span0);
    expect((Number(c.getDomain('y')[0]) + Number(c.getDomain('y')[1])) / 2).toBeCloseTo(center0, 6);

    // 向下拖（y 变大）= 缩小（从放大态往回走，最宽只到完整数据域）
    expect(applyValueAxisScale(c, scale!, startY + 60)).toBe(true);
    const outSpan = Number(c.getDomain('y')[1]) - Number(c.getDomain('y')[0]);
    expect(outSpan).toBeGreaterThan(inSpan);
    expect(outSpan).toBeLessThanOrEqual(span0);

    // 拖回出发点 = 原样（快照口径，不累积误差）
    expect(applyValueAxisScale(c, scale!, startY)).toBe(true);
    expect(c.getDomain('y')).toEqual(before);
  });

  it('拖拽语义：上下限用 `interaction.zoom` 的 minSpan / maxSpan', async () => {
    const c = await mount(option({ min: 90, max: 135 }));
    const full = c.fullDomain('y').map(Number);
    const plot = c.layout.plot;
    const startY = plot.y + plot.height / 2;
    const scale = beginValueAxisScale(c, startY)!;
    // 拖到最上面（系数 0.1 下限）也不许比 minSpan 更窄
    for (let i = 0; i < 5; i++) applyValueAxisScale(c, scale, plot.y - 400);
    const y = c.getDomain('y').map(Number);
    expect(y[1] - y[0]).toBeGreaterThanOrEqual((full[1] - full[0]) * 0.05 - 1e-9);
    // 拖到最下面也不许比完整数据域更宽
    for (let i = 0; i < 5; i++) applyValueAxisScale(c, scale, plot.y + plot.height + 400);
    const wide = c.getDomain('y').map(Number);
    expect(wide[1] - wide[0]).toBeLessThanOrEqual(full[1] - full[0] + 1e-9);
  });

  it('标尺精度跟着窗口走：窗口一细，刻度标签就多带小数位', async () => {
    // 小价格品种（1~2 一档），才够看到「步长掉到 1 以下」这一步
    const small: TradingChartOption = {
      legend: { show: false },
      animation: { enabled: false },
      xAxis: { type: 'category' },
      yAxis: { position: 'right', min: 1, max: 2 },
      series: [
        {
          id: 'k',
          type: 'candlestick',
          data: [
            { x: 'D1', o: 1.2, c: 1.4, l: 1.1, h: 1.5 },
            { x: 'D2', o: 1.4, c: 1.3, l: 1.25, h: 1.45 },
            { x: 'D3', o: 1.3, c: 1.7, l: 1.28, h: 1.75 },
            { x: 'D4', o: 1.7, c: 1.6, l: 1.55, h: 1.8 },
          ],
        },
      ],
    };
    const c = await mount(small);
    const decimals = (text: string): number => (text.split('.')[1] || '').length;
    const coarse = c.formatAxisValue('y', 1.55);
    expect(decimals(coarse)).toBe(1); // 窗口 1 宽 → 步长 0.2

    // 缩到 1/10：步长掉到 0.02，标签自动多给一位小数
    for (let i = 0; i < 10; i++) zoomValueAxis(c, { factor: 1.26 });
    const fine = c.formatAxisValue('y', 1.55);
    expect(decimals(fine)).toBeGreaterThan(decimals(coarse));
  });
});
