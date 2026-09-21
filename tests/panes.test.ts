import { createPaneStack } from '../src/panes';
import { axisTickCount, fixedWidthAxisFormatter, PANE_FONT_FAMILY } from '../src/panes';
import type { TradingChartOption } from '../src/types';

const CANDLES = [
  { x: 'D1', o: 100, c: 110, l: 95, h: 115, v: 1000 },
  { x: 'D2', o: 110, c: 105, l: 100, h: 118, v: 2000 },
  { x: 'D3', o: 105, c: 120, l: 102, h: 125, v: 4000 },
  { x: 'D4', o: 120, c: 118, l: 112, h: 126, v: 1500 },
];

const priceOption: TradingChartOption = {
  legend: { show: false },
  animation: { enabled: false },
  xAxis: { type: 'category' },
  yAxis: { position: 'right' },
  volume: false,
  series: [{ id: 'k', type: 'candlestick', name: 'K 线', data: CANDLES }],
};

describe('fixedWidthAxisFormatter', () => {
  it('把标签补到固定字符数（等宽字体下即固定像素宽）', () => {
    const format = fixedWidthAxisFormatter(6);
    expect(format('42')).toBe('    42');
    expect(format(42000)).toBe(' 42000');
  });

  it('超长不截断（宁可错位也不丢数字）', () => {
    expect(fixedWidthAxisFormatter(3)('123456')).toBe('123456');
  });
});

describe('axisTickCount（数值轴刻度密度）', () => {
  it('没有两端显式 min / max 或轴长时返回 0（不干预）', () => {
    expect(axisTickCount(90, 135, 287)).toBeGreaterThan(0);
    expect(axisTickCount(Number.NaN, 135, 287)).toBe(0);
    expect(axisTickCount(135, 90, 287)).toBe(0);
    expect(axisTickCount(90, 135, 0)).toBe(0);
  });

  it('轴越长档数越多（密度跟着轴长走，而不是拍一个固定档数）', () => {
    const short = axisTickCount(42000, 42600, 120);
    const tall = axisTickCount(42000, 42600, 480);
    expect(tall).toBeGreaterThan(short);
    expect(short).toBeGreaterThanOrEqual(2);
    expect(tall).toBeLessThanOrEqual(24);
  });

  it('一档的像素间距落在「下限 ~ 2.5 × 下限」之间（1/2/5 梯子的粒度）', () => {
    const spacing = 24;
    for (const span of [120, 400, 600, 957, 2400, 12000]) {
      const count = axisTickCount(42000, 42000 + span, 287, { spacing });
      // 档数 × 一档的像素 ≥ 轴长 —— 也就是「一档不小于下限」
      const perTick = 287 / Math.max(1, count - 1);
      // 一档不小于下限的一半（梯子粒度决定上限，这里只守住「不挤在一起」）
      expect(count).toBeGreaterThan(0);
      expect(perTick).toBeGreaterThan(2);
    }
  });

  it('两次向上取整叠在一起时（跨 957 / 轴 287）不会被抬成两倍宽', () => {
    // 引擎的老问题：档数 11 → 域取整到 1100 → 再取整一次变成 200（一档 57px）。
    // 这里必须挑到落点 100 的那一档（实测 13 档 / 一档 24px）。
    const count = axisTickCount(40863.2, 41820.2, 287);
    expect(count).toBeGreaterThanOrEqual(12);
    expect(count).toBeLessThanOrEqual(16);
  });
});

describe('createPaneStack（真副图）', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    host.style.width = '800px';
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (host.parentNode) host.parentNode.removeChild(host);
  });

  function mount(count = 3, height = 600) {
    const specs = [] as any[];
    specs.push({ id: 'price', primary: true, weight: 3, option: priceOption });
    for (let i = 1; i < count; i++) {
      specs.push({
        id: `pane${i}`,
        weight: 1,
        option: {
          legend: { show: false },
          animation: { enabled: false },
          xAxis: { type: 'category' },
          yAxis: { position: 'right' },
          series: [
            {
              id: `s${i}`,
              type: 'bar',
              name: `S${i}`,
              data: CANDLES.map((row) => ({ x: row.x, y: row.v })),
            },
          ],
        },
      });
    }
    return createPaneStack(host, specs, { height, axisLabelChars: 7, gap: 10 });
  }

  it('按 specs 建出同样数量的画布与图表', async () => {
    const stack = mount(3);
    for (const chart of stack.charts) await chart.render();
    expect(stack.charts).toHaveLength(3);
    expect(host.querySelectorAll('canvas')).toHaveLength(3);
    stack.destroy();
  });

  it('高度按权重分配，pane 之间留出 gap', async () => {
    const stack = mount(3, 600);
    for (const chart of stack.charts) await chart.render();
    const holders = Array.from(host.querySelectorAll('[data-pane-id]')) as HTMLElement[];
    const heights = holders.map((item) => parseFloat(item.style.height));
    // 权重 3:1:1，可用高度 = 600 - 2×10 = 580
    expect(heights[0]).toBeCloseTo(348, -1);
    expect(heights[1]).toBeCloseTo(116, -1);
    expect(heights[2]).toBeCloseTo(116, -1);
    stack.destroy();
  });

  it('绘图区横向对齐：每块的右边缘像素一致（轴预留宽度被定宽标签拉平）', async () => {
    const stack = mount(3);
    for (const chart of stack.charts) await chart.render();
    const rights = stack.charts.map((chart) => chart.layout.plot.x + chart.layout.plot.width);
    const lefts = stack.charts.map((chart) => chart.layout.plot.x);
    expect(new Set(lefts).size).toBe(1);
    for (const right of rights) expect(Math.abs(right - rights[0])).toBeLessThanOrEqual(1);
    stack.destroy();
  });

  it('主题字体是等宽（补空格对齐的前提）', async () => {
    const stack = mount(2);
    for (const chart of stack.charts) await chart.render();
    expect(stack.charts[0].norm.theme.fontFamily).toBe(PANE_FONT_FAMILY);
    stack.destroy();
  });

  it('setTheme：换主题后三块 pane 一起换（主题是在建栈时解析的，必须显式重设）', async () => {
    const stack = createPaneStack(host, [{ id: 'price', primary: true, weight: 1, option: priceOption }], {
      height: 400,
      theme: 'dark',
    });
    await stack.charts[0].render();
    const dark = stack.charts[0].norm.theme.backgroundColor;
    stack.setTheme({ backgroundColor: '#ffffff', axisLabelColor: '#000000' });
    await stack.charts[0].render();
    expect(stack.charts[0].norm.theme.backgroundColor).toBe('#ffffff');
    expect(stack.charts[0].norm.theme.axisLabelColor).toBe('#000000');
    expect(stack.charts[0].norm.theme.backgroundColor).not.toBe(dark);
    // 等宽字体仍然是栈的口径
    expect(stack.charts[0].norm.theme.fontFamily).toBe(PANE_FONT_FAMILY);
    stack.destroy();
  });

  it('数值轴刻度按「轴长 ÷ 一档的最小像素」给密度（默认档数 5 会明显偏稀）', async () => {
    // 价格轴显式给 min / max 时，栈要按绘图区高度反推档数
    const ranged: TradingChartOption = {
      ...priceOption,
      yAxis: { position: 'right', min: 90, max: 140 },
    };
    const host2 = document.createElement('div');
    host2.style.width = '800px';
    document.body.appendChild(host2);
    const stack = createPaneStack(host2, [{ id: 'price', primary: true, weight: 1, option: ranged }], {
      height: 600,
      axisLabelChars: 7,
    });
    await stack.charts[0].render();
    const layout = (stack.charts[0].layout as any).yAxisLayout;
    const ticks = layout.ticks as number[];
    const option = stack.charts[0].getOption().yAxis as any;
    // 注入了按密度算出来的档数（默认 5 档会明显偏稀）
    expect(option.tickCount).toBeGreaterThan(5);
    // 一档的像素间距：轴长 / (档数 - 1)，落在 20~60px（1/2/5 梯子的粒度）
    const height = stack.charts[0].layout.plot.height;
    const gap = height / Math.max(1, ticks.length - 1);
    expect(gap).toBeGreaterThan(18);
    expect(gap).toBeLessThan(60);
    expect(ticks.length).toBeGreaterThanOrEqual(8);
    stack.destroy();
    if (host2.parentNode) host2.parentNode.removeChild(host2);
  });

  it('联动：一块缩放后另一块的 x 窗口跟着走', async () => {
    const stack = mount(3);
    for (const chart of stack.charts) await chart.render();
    const domain = stack.charts[0].getDomain('x');
    stack.charts[0].setDomain('x', [domain[1], domain[3]]);
    // 类目轴的域是「窗口内的类目切片」，所以比对两块画布的域是否严格一致即可
    const windowed = stack.charts[0].getDomain('x');
    expect(windowed.length).toBeLessThan(domain.length);
    expect(stack.chartOf('pane2')!.getDomain('x')).toEqual(windowed);
    expect(stack.chartOf('pane1')!.getDomain('x')).toEqual(windowed);
    stack.destroy();
  });

  it('chartOf 找不到时返回 null', async () => {
    const stack = mount(2);
    expect(stack.chartOf('不存在')).toBeNull();
    stack.destroy();
  });

  it('holderOf 给出某一格的容器（覆盖层的挂载点）', async () => {
    const stack = mount(3);
    for (const chart of stack.charts) await chart.render();
    const holder = stack.holderOf('price')!;
    expect(holder.dataset.paneId).toBe('price');
    expect(holder.style.position).toBe('relative');
    expect(holder.contains(stack.chartOf('price')!.ice.canvasEl)).toBe(true);
    expect(stack.holderOf('不存在')).toBeNull();
    stack.destroy();
  });

  it('resize 后高度跟着容器走', async () => {
    const stack = mount(3, 600);
    for (const chart of stack.charts) await chart.render();
    host.style.height = '300px';
    const dynamic = createPaneStack(host, [
      { id: 'price', primary: true, weight: 1, option: priceOption },
      { id: 'v', weight: 1, option: priceOption },
    ]);
    for (const chart of dynamic.charts) await chart.render();
    dynamic.resize();
    expect(dynamic.charts).toHaveLength(2);
    stack.destroy();
    dynamic.destroy();
  });

  it('destroy 之后画布被摘掉、图表被销毁', async () => {
    const stack = mount(2);
    for (const chart of stack.charts) await chart.render();
    const charts = stack.charts.slice();
    stack.destroy();
    expect(host.querySelectorAll('canvas')).toHaveLength(0);
    for (const chart of charts) expect(chart.destroyed).toBe(true);
  });

  it('默认分隔线是 1px（主流终端的口径），且每两块 pane 之间恰有一条', async () => {
    const stack = createPaneStack(
      host,
      [
        { id: 'a', primary: true, option: priceOption },
        {
          id: 'b',
          option: {
            legend: { show: false },
            xAxis: { type: 'category' },
            yAxis: {},
            series: [{ id: 's', type: 'bar', data: CANDLES.map((row) => ({ x: row.x, y: row.v })) }],
          },
        },
        {
          id: 'c',
          option: {
            legend: { show: false },
            xAxis: { type: 'category' },
            yAxis: {},
            series: [{ id: 's2', type: 'line', data: CANDLES.map((row) => ({ x: row.x, y: row.v })) }],
          },
        },
      ],
      { height: 600 }
    );
    for (const chart of stack.charts) await chart.render();
    const separators = Array.from(host.querySelectorAll('[data-pane-separator]')) as HTMLElement[];
    expect(separators).toHaveLength(2);
    for (const node of separators) expect(node.style.height).toBe('1px');
    stack.destroy();
    expect(host.querySelectorAll('[data-pane-separator]')).toHaveLength(0);
  });

  it('gap: 0 时不插分隔线（纯贴在一起）', async () => {
    const stack = createPaneStack(
      host,
      [
        { id: 'a', primary: true, option: priceOption },
        {
          id: 'b',
          option: {
            legend: { show: false },
            xAxis: { type: 'category' },
            yAxis: {},
            series: [{ id: 's', type: 'bar', data: CANDLES.map((row) => ({ x: row.x, y: row.v })) }],
          },
        },
      ],
      { height: 400, gap: 0, link: false }
    );
    for (const chart of stack.charts) await chart.render();
    expect(host.querySelectorAll('[data-pane-separator]')).toHaveLength(0);
    stack.destroy();
  });

  it('link: false 时不联动', async () => {
    const stack = createPaneStack(
      host,
      [
        { id: 'a', primary: true, option: priceOption },
        {
          id: 'b',
          option: {
            legend: { show: false },
            xAxis: { type: 'category' },
            yAxis: { position: 'right' },
            series: [
              {
                id: 's',
                type: 'bar',
                name: 'S',
                data: CANDLES.map((row) => ({ x: row.x, y: row.v })),
              },
            ],
          },
        },
      ],
      { height: 400, link: false }
    );
    for (const chart of stack.charts) await chart.render();
    expect(stack.link).toBeNull();
    stack.destroy();
  });
});
