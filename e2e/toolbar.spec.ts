import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * 库的工具条（`createChartToolbar`）在真实终端页上的**行为**回归。
 *
 * 走的是并存对照那条路：`?toolbar=lib` 把库的工具条挂上，宿主回调把意图转成页面已有的命令。
 * 因此这三条断言量的都是**页面状态真的变了**（`window.__page` 上的字段），而不是"按钮亮没亮"：
 * 工具条如果只是自己变了个样、没把命令送到图上，这三条必须红。
 */
const PAGE = '/examples/terminal.html?toolbar=lib';

async function open(page: Page) {
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForSelector('#lib-toolbar .ice-toolbar', { timeout: 20_000 });
  await page.waitForFunction(() => !!(window as any).__page, null, { timeout: 20_000 });
}

/** 打开库里那个菜单并点某一项。 */
async function pick(page: Page, item: string, attr: string, value: string) {
  await page.locator(`#lib-toolbar [data-item="${item}"] .ice-toolbar-btn`).click();
  await page.locator(`#lib-toolbar [${attr}="${value}"]`).click();
}

test.describe('库的工具条（并存对照）', () => {
  test('切周期：图上真的换了（不只是按钮文字变了）', async ({ page }) => {
    await open(page);
    const before = await page.evaluate(() => {
      const pg = (window as any).__page;
      const chart = pg.stack.chartOf('price');
      return { interval: pg.intervalKey, n: (chart.getDomain('x') || []).length, first: (chart.getDomain('x') || [])[0] };
    });
    expect(before.interval).toBe('5m');

    await pick(page, 'intervals', 'data-interval', '1H');
    await page.waitForTimeout(1200);

    const after = await page.evaluate(() => {
      const pg = (window as any).__page;
      const chart = pg.stack.chartOf('price');
      const domain = chart.getDomain('x') || [];
      return {
        interval: pg.intervalKey,
        n: domain.length,
        first: domain[0],
        库上的文字: (document.querySelector('#lib-toolbar [data-item="intervals"] .lbl') || {}).textContent,
        自绘上的文字: (document.querySelector('[data-tb="interval"]') || {}).textContent,
      };
    });
    expect(after.interval).toBe('1H');
    expect(after.库上的文字).toBe('1H');
    expect(after.自绘上的文字).toBe('1H');
    // 图上有东西、且类目换了（换周期会重新灌数据；只改文字的话这两条会露馅）
    expect(after.n).toBeGreaterThan(2);
    expect(after.first === before.first && after.n === before.n).toBe(false);
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

    await pick(page, 'indicators', 'data-indicator', 'ma');
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

  test('画线工具：激活的是页面那套工具（不是工具条自己的状态）', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => (window as any).__page.drawing.mode())).toBeFalsy();

    await pick(page, 'drawings', 'data-drawing', 'trend');
    await page.waitForTimeout(500);

    const mode = await page.evaluate(() => (window as any).__page.drawing.mode());
    expect(mode).toBe('trend');
    // 页面自绘那条工具条上，同一个工具也应该是激活态（同一条命令路径）
    // 页面那套工具条的激活类名是 `active`（不是 `on`）—— 断言按页面自己的口径写
    await expect(page.locator('.chart-bar [data-tool="trend"]').first()).toHaveClass(/active/);
  });
});
