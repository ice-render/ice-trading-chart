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
    expect(typeof seen[0].closeMenu).toBe('function');
    expect((seen[0].chart as { tag: string }).tag).toBe('chart-instance');
    expect(panelOf('alerts')).toBeNull();
  });

  it('第 2 层：label 也可以是函数 —— 按钮上的字跟着状态走（周期那种）', () => {
    let interval = '5m';
    mount({
      items: [
        { id: 'intervals', icon: 'clock', label: () => interval, menu: () => document.createElement('div') },
        'type',
      ],
    });
    expect(btnOf('intervals').textContent).toContain('5m');
    expect(btnOf('intervals').title).toBe('5m');
    interval = '1H';
    bar!.update();
    expect(btnOf('intervals').textContent).toContain('1H');
    // 悬停提示与按钮上的字是同一份真相（不给 title 时跟着走）
    expect(btnOf('intervals').title).toBe('1H');
  });

  it('setOptions 换 items（收藏变了）时：开着的那张面板按同一个 id 重新挂上', () => {
    mount({
      items: ['intervals', { id: 'fav:1m', label: '1m', onClick: () => undefined }],
      host: { interval: () => '5m' },
    });
    btnOf('intervals').click();
    expect(panelOf('intervals').hidden).toBe(false);
    bar!.setOptions({
      items: [
        'intervals',
        { id: 'fav:1m', label: '1m', onClick: () => undefined },
        { id: 'fav:5m', label: '5m', onClick: () => undefined },
      ],
    });
    expect(panelOf('intervals').hidden).toBe(false);
  });

  it('面板内的点击不冒泡到 document：连着勾几个指标时面板不关', () => {
    mount({
      items: ['indicators'],
      host: {
        indicators: () => [
          { id: 'ma', label: 'MA', on: true },
          { id: 'ema', label: 'EMA', on: false },
        ],
        onToggleIndicator: () => undefined,
      },
    });
    btnOf('indicators').click();
    const panel = panelOf('indicators');
    (panel.querySelector('[data-indicator="ema"]') as HTMLElement).click();
    expect(panel.hidden).toBe(false);
  });

  it('Esc 收起面板（与「点空白处收起」同一条约定）', () => {
    mount({ items: ['intervals'], host: { interval: () => '5m' } });
    btnOf('intervals').click();
    const panel = panelOf('intervals');
    expect(panel.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.hidden).toBe(true);
  });

  it('自定义面板里可以用 ctx.closeMenu() 自己收起（应用知道点完要不要关）', () => {
    mount({
      items: [
        {
          id: 'lang',
          label: '语言',
          menu: (ctx) => {
            const box = document.createElement('div');
            box.innerHTML = '<button type="button" class="pick">EN</button>';
            box.querySelector('.pick')!.addEventListener('click', () => ctx.closeMenu());
            return box;
          },
        },
      ],
    });
    btnOf('lang').click();
    const panel = panelOf('lang');
    expect(panel.hidden).toBe(false);
    (panel.querySelector('.pick') as HTMLElement).click();
    expect(panel.hidden).toBe(true);
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

  it('第 2 层进阶：自定义面板（menu）—— 容器/定位/关闭由库负责，内容归应用', () => {
    let built = 0;
    mount({
      items: [
        {
          id: 'lang',
          label: '语言',
          menu: () => {
            built += 1;
            const box = document.createElement('div');
            box.className = 'my-lang';
            box.innerHTML = '<button type="button" data-lang="en">EN</button>';
            return box;
          },
        },
      ],
    });
    btnOf('lang').click();
    const panel = panelOf('lang');
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector('.my-lang')).not.toBeNull();
    expect(built).toBe(1);
    // 再点触发器 = 收起；再点开 = 重新调一次 menu（应用可以按当前状态现建）
    btnOf('lang').click();
    expect(panel.hidden).toBe(true);
    btnOf('lang').click();
    expect(built).toBe(2);
  });

  it('主题走 `--ice-toolbar-*` 变量：换肤改变量，不重建 DOM', () => {
    const toolbar = mount({ items: ['intervals'], theme: { text: '#abcdef', panel2: '#123456' } });
    const root = host.querySelector('.ice-toolbar') as HTMLElement;
    expect(root.style.getPropertyValue('--ice-toolbar-text')).toBe('#abcdef');
    expect(root.style.getPropertyValue('--ice-toolbar-panel')).toBe('#123456');
    toolbar.setOptions({ theme: { text: '#abcdef', panel2: '#654321' } });
    expect(root.style.getPropertyValue('--ice-toolbar-panel')).toBe('#654321');
    expect(host.querySelector('.ice-toolbar')).toBe(root);
  });

  it('换语言：悬停提示跟着 messages 目录走', () => {
    const toolbar = mount({ items: ['type'] });
    expect(btnOf('type').title).toBe('图表类型');
    toolbar.setOptions({ messages: 'en' });
    expect(btnOf('type').title).toBe('Chart type');
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
