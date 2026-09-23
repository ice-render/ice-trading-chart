import { createChartToolbar } from '../src/toolbar';
import type { ChartToolbar, ToolbarContext } from '../src/toolbar';

describe('图表工具条（toolbar）', () => {
  let host: HTMLDivElement;
  let bar: ChartToolbar | null = null;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (bar) bar.destroy();
    bar = null;
    if (host.parentNode) host.parentNode.removeChild(host);
  });

  const mount = (options: Parameters<typeof createChartToolbar>[0] = {}) => {
    bar = createChartToolbar(options);
    if (bar.element) host.appendChild(bar.element);
    return bar;
  };
  const itemIds = () =>
    Array.from(host.querySelectorAll('[data-item]')).map((el) => el.getAttribute('data-item'));
  const btnOf = (id: string) => host.querySelector('[data-item="' + id + '"] .ice-toolbar-btn') as HTMLButtonElement;
  const panelOf = (id: string) =>
    host.querySelector('[data-item="' + id + '"] .ice-toolbar-panel') as HTMLElement;

  it('默认五项，顺序与币安那条一致（周期 / 类型 / 指标 / 画线 / 显示）', () => {
    mount();
    expect(itemIds()).toEqual(['intervals', 'type', 'indicators', 'drawings', 'display']);
  });

  it('items 的数组顺序就是显示顺序；不在数组里的内置项不显示', () => {
    mount({ items: ['display', 'intervals'] });
    expect(itemIds()).toEqual(['display', 'intervals']);
  });

  it('第 2 层：自定义项与内置项同权，onClick 拿到 ctx（含 refresh）', () => {
    const seen: ToolbarContext[] = [];
    mount({
      items: ['intervals', { id: 'alerts', label: '预警', onClick: (ctx) => seen.push(ctx) }, 'display'],
      host: { chart: { tag: 'chart-instance' } },
    });
    expect(itemIds()).toEqual(['intervals', 'alerts', 'display']);
    btnOf('alerts').click();
    expect(seen).toHaveLength(1);
    expect(typeof seen[0].refresh).toBe('function');
    expect((seen[0].chart as { tag: string }).tag).toBe('chart-instance');
    expect(panelOf('alerts')).toBeNull();
  });

  it('铁律：外部状态变了 update() 跟上，且不重建结构', () => {
    let interval = '5m';
    mount({
      items: ['intervals'],
      host: {
        interval: () => interval,
        onIntervalChange: (next: string) => {
          interval = next;
        },
      },
    });
    const rootBefore = host.querySelector('.ice-toolbar');
    const btnBefore = btnOf('intervals');
    expect(btnBefore.textContent).toContain('5m');

    interval = '1H';
    bar!.update();
    expect(btnOf('intervals').textContent).toContain('1H');
    expect(host.querySelector('.ice-toolbar')).toBe(rootBefore);
    expect(btnOf('intervals')).toBe(btnBefore);
  });

  it('周期面板：点一项抛 onIntervalChange，并把当前项标 on', () => {
    const picked: string[] = [];
    mount({
      items: ['intervals'],
      host: { interval: () => '5m', onIntervalChange: (next: string) => picked.push(next) },
    });
    btnOf('intervals').click();
    const panel = panelOf('intervals');
    expect(panel.hidden).toBe(false);
    expect(panel.querySelectorAll('.ice-toolbar-opt').length).toBeGreaterThan(1);
    expect(panel.querySelector('[data-interval="5m"]')!.classList.contains('on')).toBe(true);
    (panel.querySelector('[data-interval="1H"]') as HTMLElement).click();
    expect(picked).toEqual(['1H']);
  });

  it('指标面板：勾选抛 onToggleIndicator(id, next)，next 是取反后的值', () => {
    const calls: Array<[string, boolean]> = [];
    mount({
      items: ['indicators'],
      host: {
        indicators: () => [
          { id: 'ma', label: 'MA', on: true },
          { id: 'boll', label: 'BOLL', on: false },
        ],
        onToggleIndicator: (id: string, next: boolean) => calls.push([id, next]),
      },
    });
    btnOf('indicators').click();
    (panelOf('indicators').querySelector('[data-indicator="ma"]') as HTMLElement).click();
    (panelOf('indicators').querySelector('[data-indicator="boll"]') as HTMLElement).click();
    expect(calls).toEqual([
      ['ma', false],
      ['boll', true],
    ]);
  });

  it('第 3 层：render 整条替换（element / update 都被用上）', () => {
    const element = document.createElement('div');
    element.className = 'my-bar';
    let updates = 0;
    mount({
      render: () => ({
        element,
        update: () => {
          updates += 1;
        },
      }),
    });
    expect(bar!.element).toBe(element);
    expect(host.querySelector('.ice-toolbar')).toBeNull();
    bar!.update();
    expect(updates).toBe(1);
  });

  it('show:false 时什么都不渲染（应用完全自绘）', () => {
    mount({ show: false });
    expect(bar!.element).toBeNull();
    expect(host.querySelector('.ice-toolbar')).toBeNull();
  });
});
