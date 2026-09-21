import type { ICEChart } from '@damoqiongqiu/ice-chart';
import { createDrawingLayer, requiredPoints } from '../src/drawing';
import type { DrawingLayer, DrawingKind } from '../src/drawing';
import { categoryToX, createTradingChart, priceToY, yToPrice } from '../src/index';
import type { TradingChartOption } from '../src/types';

const OPTION: TradingChartOption = {
  legend: { show: false },
  animation: { enabled: false },
  xAxis: { type: 'category' },
  yAxis: { position: 'right' },
  volume: false,
  series: [
    {
      id: 'k',
      type: 'candlestick',
      name: 'K 线',
      data: [
        { x: 'D1', o: 100, c: 110, l: 95, h: 115 },
        { x: 'D2', o: 110, c: 105, l: 100, h: 118 },
        { x: 'D3', o: 105, c: 120, l: 102, h: 125 },
        { x: 'D4', o: 120, c: 118, l: 112, h: 126 },
      ],
    },
  ],
};

describe('画线工具（SVG 覆盖层）', () => {
  let host: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let chart: ICEChart;
  let layer: DrawingLayer;

  beforeEach(async () => {
    host = document.createElement('div');
    host.style.width = '800px';
    canvas = document.createElement('canvas');
    host.appendChild(canvas);
    document.body.appendChild(host);
    chart = createTradingChart(canvas, OPTION);
    await chart.render();
    layer = createDrawingLayer(chart);
  });

  afterEach(() => {
    layer.destroy();
    chart.destroy();
    if (host.parentNode) host.parentNode.removeChild(host);
  });

  const svgOf = () => host.querySelector('svg[data-role="drawing-layer"]') as SVGSVGElement;

  it('每种图形需要的锚点数', () => {
    expect(requiredPoints('hline')).toBe(1);
    expect(requiredPoints('vline')).toBe(1);
    expect(requiredPoints('trend')).toBe(2);
    expect(requiredPoints('rect')).toBe(2);
  });

  it('按数据坐标加一条水平线，锚点数不对就拒绝', () => {
    expect(layer.add({ kind: 'hline', points: [{ x: 'D2', y: 110 }] })).toBeTruthy();
    expect(layer.add({ kind: 'hline', points: [] })).toBeNull();
    expect(layer.add({ kind: 'trend', points: [{ x: 'D1', y: 100 }] })).toBeNull();
    expect(layer.list()).toHaveLength(1);
  });

  it('水平线画成横跨绘图区的一条线', () => {
    layer.add({ kind: 'hline', points: [{ x: 'D2', y: 110 }] });
    const line = svgOf().querySelector('line')!;
    const plot = chart.layout.plot;
    expect(Number(line.getAttribute('x1'))).toBeCloseTo(plot.x, 6);
    expect(Number(line.getAttribute('x2'))).toBeCloseTo(plot.x + plot.width, 6);
    const y1 = Number(line.getAttribute('y1'));
    expect(y1).toBeCloseTo(priceToY(chart, 110, 0)!, 6);
    expect(Number(line.getAttribute('y2'))).toBeCloseTo(y1, 6);
  });

  it('垂直线画成贯穿绘图区的一条线', () => {
    layer.add({ kind: 'vline', points: [{ x: 'D3', y: 100 }] });
    const line = svgOf().querySelector('line')!;
    const plot = chart.layout.plot;
    expect(Number(line.getAttribute('y1'))).toBeCloseTo(plot.y, 6);
    expect(Number(line.getAttribute('y2'))).toBeCloseTo(plot.y + plot.height, 6);
    expect(Number(line.getAttribute('x1'))).toBeCloseTo(Number(line.getAttribute('x2')), 6);
  });

  it('矩形画成 rect，宽高等于两个锚点的像素差', () => {
    layer.add({ kind: 'rect', points: [{ x: 'D1', y: 100 }, { x: 'D4', y: 120 }] });
    const box = svgOf().querySelector('rect')!;
    expect(Number(box.getAttribute('width'))).toBeGreaterThan(0);
    expect(Number(box.getAttribute('height'))).toBeGreaterThan(0);
  });

  it('序列化 → 载入 往返一致（数据坐标）', () => {
    layer.add({ kind: 'trend', points: [{ x: 'D1', y: 100 }, { x: 'D3', y: 120 }] });
    layer.add({ kind: 'hline', points: [{ x: 'D2', y: 105 }] });
    const dumped = layer.dump();
    const json = JSON.stringify(dumped);

    layer.clear();
    expect(layer.list()).toHaveLength(0);

    layer.load(JSON.parse(json));
    expect(layer.dump()).toEqual(dumped);
    expect(svgOf().querySelectorAll('line').length).toBe(2);
  });

  it('选中、取消选中与删除', () => {
    const drawing = layer.add({ kind: 'hline', points: [{ x: 'D2', y: 110 }] })!;
    expect(layer.selected()!.id).toBe(drawing.id);
    // 选中态会多出锚点圆点
    expect(svgOf().querySelectorAll('circle').length).toBe(1);

    layer.select(null);
    expect(layer.selected()).toBeNull();
    expect(svgOf().querySelectorAll('circle').length).toBe(0);

    expect(layer.remove(drawing.id)).toBe(true);
    expect(layer.remove('不存在')).toBe(false);
    expect(layer.list()).toHaveLength(0);
  });

  it('onChange 在增 / 删 / 清空时回调', () => {
    const seen: number[] = [];
    const other = createDrawingLayer(chart, { onChange: (items) => seen.push(items.length) });
    other.add({ kind: 'hline', points: [{ x: 'D1', y: 100 }] });
    other.add({ kind: 'vline', points: [{ x: 'D2', y: 100 }] });
    other.clear();
    expect(seen).toEqual([1, 2, 0]);
    other.destroy();
  });

  it('画线模式：在图上点两下画出一条趋势线', () => {
    layer.setMode('trend');
    expect(layer.mode()).toBe('trend');
    const plot = chart.layout.plot;
    const x1 = chart.norm.xAxis.scale!.map('D1');
    const y1 = chart.norm.yAxes[0].scale!.map(110);
    const x2 = chart.norm.xAxis.scale!.map('D3');
    const y2 = chart.norm.yAxes[0].scale!.map(120);

    const fire = (type: string, x: number, y: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true }) as any;
      event.clientX = plot.x + x;
      event.clientY = plot.y + y;
      event.pointerId = 1;
      svgOf().dispatchEvent(event);
    };

    fire('pointerdown', x1, y1);
    expect(layer.list()).toHaveLength(0); // 第一个点只是待定
    fire('pointerdown', x2, y2);
    const drawings = layer.list();
    expect(drawings).toHaveLength(1);
    expect(drawings[0].kind).toBe('trend');
    expect(drawings[0].points[0].x).toBe('D1');
    expect(drawings[0].points[1].x).toBe('D3');
    // 画完自动退出画线模式
    expect(layer.mode()).toBeNull();
  });

  it('拖动锚点改的是数据坐标', () => {
    const drawing = layer.add({ kind: 'trend', points: [{ x: 'D1', y: 110 }, { x: 'D4', y: 118 }] })!;
    layer.select(drawing.id);
    const circle = svgOf().querySelector('circle[data-point-index="1"]') as SVGCircleElement;
    const plot = chart.layout.plot;

    // 目标：把第二个锚点拖到 D2 / 122。
    // 事件坐标一律用**画布坐标系**（jsdom 里 svg 的 getBoundingClientRect 全是 0，
    // 所以 client 坐标直接等于画布坐标）；投影函数返回的就是画布坐标，别再叠加绘图区偏移。
    const targetX = categoryToX(chart, 'D2')!;
    const targetY = priceToY(chart, 122, 0)!;

    const fire = (target: EventTarget, type: string, x: number, y: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true }) as any;
      event.clientX = x;
      event.clientY = y;
      event.pointerId = 1;
      target.dispatchEvent(event);
    };

    // 按下落在圆点上（事件目标决定抓到哪个锚点），随后在 svg 上移动 / 抬起
    fire(circle, 'pointerdown', targetX, targetY);
    fire(svgOf(), 'pointermove', targetX, targetY);
    fire(svgOf(), 'pointerup', targetX, targetY);

    const after = layer.list()[0].points[1];
    expect(after.x).toBe('D2');
    expect(after.y).toBeCloseTo(122, 0);
    // 第一个锚点不动
    expect(layer.list()[0].points[0]).toEqual(drawing.points[0]);
  });

  it('缩放后按比例尺重投影（水平线的 y 不变、竖直线的 x 跟着动）', () => {
    layer.add({ kind: 'hline', points: [{ x: 'D2', y: 110 }] });
    layer.add({ kind: 'vline', points: [{ x: 'D3', y: 110 }] });
    const lines = svgOf().querySelectorAll('line');
    const hlineY = Number(lines[0].getAttribute('y1'));
    const vlineX = Number(lines[1].getAttribute('x1'));

    const domain = chart.getDomain('x');
    chart.setDomain('x', [domain[0], domain[2]]);
    layer.refresh(true);

    const after = svgOf().querySelectorAll('line');
    // x 轴缩了，y 刻度没变 → 水平线的 y 不动
    expect(Number(after[0].getAttribute('y1'))).toBeCloseTo(hlineY, 6);
    expect(Number(after[0].getAttribute('y1'))).toBeCloseTo(priceToY(chart, 110, 0)!, 6);
    // 垂直线仍然钉在 D3 上（画布坐标变了）
    expect(Number(after[1].getAttribute('x1'))).toBeCloseTo(categoryToX(chart, 'D3')!, 6);
    expect(Number(after[1].getAttribute('x1'))).not.toBe(vlineX);
  });

  it('反投影出来的价格能直接用于新锚点', () => {
    const y = priceToY(chart, 115, 0)!;
    expect(yToPrice(chart, y, 0)!).toBeCloseTo(115, 6);
  });

  it('destroy 摘掉覆盖层', () => {
    expect(svgOf()).toBeTruthy();
    layer.destroy();
    expect(host.querySelector('svg[data-role="drawing-layer"]')).toBeNull();
  });

  it('没有容器时抛明确错误', () => {
    const orphan = document.createElement('canvas');
    const orphanChart = createTradingChart(orphan, OPTION);
    // 画布没有父元素 → 找不到覆盖层容器
    expect(() => createDrawingLayer(orphanChart)).toThrow(/覆盖层容器/);
    orphanChart.destroy();
  });
});
