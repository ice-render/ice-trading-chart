import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * 库的工具条（`createChartToolbar`）在真实终端页上的**行为**回归。
 *
 * 这条工具条原来是页面自绘的（`.tb-menu` 那一套），现在页面只留业务判断、其余归库
 * （见 `plans/chart-toolbar.md` §6.5 与 `src/toolbar.ts` 的三层定制）。
 *
 * 所以断言量的都是**页面状态真的变了**（`window.__page` 上的字段），而不是"按钮亮没亮"：
 * 工具条如果只是自己变了个样、没把命令送到图上，这些用例必须红。
 */
const PAGE = '/examples/terminal.html';

async function open(page: Page, query = '') {
  await page.goto(PAGE + query, { waitUntil: 'load' });
  // `window.__page` 是在构造函数（含 bindToolbar）之后挂上的，等它就等于等工具条建好
  await page.waitForFunction(() => !!(window as any).__page, null, { timeout: 20_000 });
}

/** 打开某一项的面板，点里面的某一行（`[data-item]` 就是工具条上那一项）。 */
async function pick(page: Page, item: string, attr: string, value: string) {
  await page.click(`.ice-toolbar [data-item="${item}"] .ice-toolbar-btn`);
  await page.click(`.ice-toolbar [data-item="${item}"] .ice-toolbar-panel [${attr}="${value}"]`);
}

const state = (page: Page) =>
  page.evaluate(() => {
    const pg = (window as any).__page;
    return {
      interval: pg.intervalKey,
      domain: pg.stack.chartOf('price').getDomain('x') || [],
      周期文字: (document.querySelector('.ice-toolbar [data-item="intervals"] .lbl') || {}).textContent,
    };
  });

test.describe('库的工具条（终端示例页）', () => {
  test('切周期：图上真的换了（不只是按钮文字变了）', async ({ page }) => {
    await open(page);
    const before = await state(page);
    expect(before.interval).toBe('5m');

    await pick(page, 'intervals', 'data-interval', '1H');
    await page.waitForTimeout(1200);

    const after = await state(page);
    expect(after.interval).toBe('1H');
    expect(after.周期文字).toBe('1H');
    // 图上有东西、且类目换了（换周期会重新灌数据；只改文字的话这两条会露馅）
    expect(after.domain.length).toBeGreaterThan(2);
    expect(after.domain[0] === before.domain[0] && after.domain.length === before.domain.length).toBe(false);
  });

  test('指标开关：图上叠加减少 / 增加，图例也跟着变', async ({ page }) => {
    await open(page);
    const before = await page.evaluate(() => {
      const pg = (window as any).__page;
      return {
        ma: pg.indicators.ma,
        叠加数: pg.stack.chartOf('price').option.series.length,
        图例条数: document.querySelectorAll('.pane-title.legend[data-pane="price"] .item').length,
      };
    });
    expect(before.ma).toBe(true);

    await pick(page, 'indicators', 'data-ind', 'ma');
    await page.waitForTimeout(800);

    const after = await page.evaluate(() => {
      const pg = (window as any).__page;
      return {
        ma: pg.indicators.ma,
        叠加数: pg.stack.chartOf('price').option.series.length,
        图例条数: document.querySelectorAll('.pane-title.legend[data-pane="price"] .item').length,
      };
    });
    expect(after.ma).toBe(false);
    expect(after.叠加数).toBeLessThan(before.叠加数);
    expect(after.图例条数).toBeLessThan(before.图例条数);
  });

  test('画线工具：同一条命令路径（工具条的菜单与左侧图标条都变）', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => (window as any).__page.drawing.mode())).toBeFalsy();

    await pick(page, 'drawings', 'data-tool', 'trend');
    await page.waitForTimeout(500);

    expect(await page.evaluate(() => (window as any).__page.drawing.mode())).toBe('trend');
    // 左侧那条图标条走的是同一个 `setDrawingTool()`，所以必然也是激活态
    await expect(page.locator('#draw-bar [data-tool="trend"]').first()).toHaveClass(/on/);
  });

  test('占带：工具条在 pane 栈顶部那一条，画布从它下面开始（不盖住最上面那几根 K 线）', async ({ page }) => {
    await open(page);
    const geom = await page.evaluate(() => {
      const host = document.getElementById('panes')!;
      const bar = host.querySelector('.ice-toolbar') as HTMLElement;
      const chart = (window as any).__page.stack.chartOf('price');
      const canvas = chart.ice.canvasEl as HTMLCanvasElement;
      const holder = document.querySelector('[data-pane-id="price"]') as HTMLElement;
      const sum = Array.from(document.querySelectorAll('[data-pane-id]')).reduce(
        (total, node) => total + parseFloat((node as HTMLElement).style.height),
        0
      );
      return {
        first: host.firstElementChild === bar,
        barHeight: bar.getBoundingClientRect().height,
        barBottom: bar.getBoundingClientRect().bottom,
        canvasTop: canvas.getBoundingClientRect().top,
        paneHeight: parseFloat(holder.style.height),
        sum,
        hostHeight: host.clientHeight,
      };
    });
    expect(geom.first, '带在容器顶部').toBe(true);
    expect(geom.barHeight).toBeGreaterThan(0);
    expect(geom.barBottom, '带在画布上方').toBeLessThanOrEqual(geom.canvasTop + 1);
    // 图表高度里扣掉了带：三块 pane + 带 + 分隔线 ≈ 容器高
    expect(geom.sum + geom.barHeight).toBeLessThanOrEqual(geom.hostHeight + 3);
  });

  test('三层定制各跑一条路：只减项 / 加自定义项 / 整条替换', async ({ page }) => {
    // 第 1 层：`items` 数组就是「显示哪些、按什么顺序」
    await open(page, '?toolbar=simple');
    const simple = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.ice-toolbar [data-item]')).map((node) => node.getAttribute('data-item'))
    );
    expect(simple).toEqual(['intervals', 'type', 'display']);

    // 第 2 层：加一个「预警」按钮（自定义图标 + 自定义面板 + 自己的状态）
    await open(page, '?toolbar=custom');
    const alerts = await page.evaluate(() => {
      const pg = (window as any).__page;
      return { items: Array.from(document.querySelectorAll('.ice-toolbar [data-item]')).map((n) => n.getAttribute('data-item')), count: pg.alerts.length };
    });
    expect(alerts.items).toContain('alerts');
    expect(alerts.count).toBe(0);
    await pick(page, 'alerts', 'data-alert', 'add');
    await page.waitForTimeout(200);
    const afterAdd = await page.evaluate(() => ({
      count: (window as any).__page.alerts.length,
      角标: document.querySelector('.ice-toolbar [data-item="alerts"] .ice-toolbar-btn')!.classList.contains('on'),
    }));
    expect(afterAdd.count).toBe(1);
    expect(afterAdd.角标, '自定义项的 active 回调驱动角标').toBe(true);

    // 第 3 层：整条替换 —— 条上画什么完全归应用，位置仍由图表的占带给
    await open(page, '?toolbar=replace');
    const replaced = await page.evaluate(() => {
      const host = document.getElementById('panes')!;
      const bar = host.querySelector('.mini-bar') as HTMLElement;
      const canvas = (window as any).__page.stack.chartOf('price').ice.canvasEl as HTMLCanvasElement;
      return {
        lib: host.querySelectorAll('.ice-toolbar').length,
        first: host.firstElementChild === bar,
        above: bar.getBoundingClientRect().bottom <= canvas.getBoundingClientRect().top + 1,
      };
    });
    expect(replaced.lib, '整条替换时不渲染库的那条').toBe(0);
    expect(replaced.first).toBe(true);
    expect(replaced.above).toBe(true);
    await page.click('.mini-bar [data-mini-interval="1H"]');
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => (window as any).__page.intervalKey)).toBe('1H');

    // 完全不要（应用自绘 / 什么都不画）
    await open(page, '?toolbar=none');
    const none = await page.evaluate(() => document.querySelectorAll('#panes .ice-toolbar, #panes .mini-bar').length);
    expect(none).toBe(0);
  });

  test('换语言 / 换肤走变量，不重建工具条 DOM', async ({ page }) => {
    await open(page);
    const handle = await page.evaluateHandle(() => document.querySelector('#panes .ice-toolbar'));

    await pick(page, 'display', 'data-lang', 'en');
    await page.waitForTimeout(300);
    await pick(page, 'display', 'data-theme', 'light');
    await page.waitForTimeout(300);

    const same = await page.evaluate((node) => node === document.querySelector('#panes .ice-toolbar'), handle);
    expect(same, '换语言 / 换肤后还是同一个根节点').toBe(true);
    // 库渲染的文案跟着语言走（工具条上的悬停提示）
    expect(
      await page.evaluate(() => (document.querySelector('.ice-toolbar [data-item="type"] .ice-toolbar-btn') as HTMLElement).title)
    ).toBe('Chart type');
    // 主题色走变量（浅色盘面下不再是深色的那套兜底值）
    expect(
      await page.evaluate(() => {
        const root = document.querySelector('#panes .ice-toolbar') as HTMLElement;
        return root.style.getPropertyValue('--ice-toolbar-panel');
      })
    ).toBeTruthy();
  });
});
