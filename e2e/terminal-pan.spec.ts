import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * K 线终端示例页：平移（含「未来空位」）与光标。
 *
 * 三条判据都直接量**行为**，不量实现：
 * 1. 光标**按住主键才**变小手（悬停不给）；
 * 2. 视窗停在最新 K 上时，向左拖依然有效 —— 右侧是「未来空位」，
 *    拖过去应该看到空白，且**跨度不变**（是平移，不是缩放）；
 * 3. 拖到未来深处时三块 pane 仍然**同窗**，且都真的什么都没画（像素为 0）。
 *    这一条照的是两个真踩过的坑：副图的类目比别人短 → 联动窗口在它那儿解析不出来
 *    （要么被拉成整幅、要么停在老窗口上，三块图错位）；渲染窗口里一根真实 K 都没有 →
 *    量程失去依据（价格轴掉到 `[-148, 451]`）。
 */
const PAGE = '/examples/terminal.html';

/** 类目/量程 + 可见窗口里真实 K 的根数。 */
async function snapshot(page: Page) {
  return page.evaluate(() => {
    const pg = (window as any).__page;
    const panes: Record<string, { n: number; first: string; last: string; y: number[] }> = {};
    for (const id of ['price', 'volume', 'indicator']) {
      const chart = pg.stack.chartOf(id);
      const domain = chart.getDomain('x') || [];
      panes[id] = {
        n: domain.length,
        first: domain[0],
        last: domain[domain.length - 1],
        y: (chart.getDomain('y') || []).filter((v: unknown) => typeof v === 'number') as number[],
      };
    }
    const visible = pg.visibleCandles();
    const real = visible.filter((row: any) => row.o !== undefined).length;
    const index = (key: string) => pg.poolIndexOf(key);
    return {
      panes,
      follow: pg.follow as boolean,
      slots: pg.futureSlots.length as number,
      real: pg.candles.length as number,
      newestKey: pg.candles[pg.candles.length - 1].x as string,
      visibleReal: real,
      left: index(panes.price.first),
      right: index(panes.price.last),
    };
  });
}

/** 绘图区里「系列颜色」的像素数（饱和彩色 = 涨跌色 / 均线色；网格与轴字是灰蓝，不算）。 */
async function seriesInk(page: Page) {
  return page.evaluate(() => {
    const pg = (window as any).__page;
    const dpr = pg.dpr || 1;
    const out: Record<string, number> = {};
    for (const id of ['price', 'volume', 'indicator']) {
      const canvas = pg.stack.chartOf(id).ice.canvasEl;
      const ctx = canvas.getContext('2d');
      const x0 = Math.round(12 * dpr);
      const y0 = Math.round(8 * dpr);
      const w = Math.max(1, Math.round(canvas.width - 32 * dpr));
      const h = Math.max(1, Math.round(canvas.height - 16 * dpr));
      const data = ctx.getImageData(x0, y0, w, h).data;
      let ink = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max > 90 && max - min > 60) ink += 1;
      }
      out[id] = ink;
    }
    return out;
  });
}

async function paneCenter(page: Page) {
  return page.evaluate(() => {
    const pg = (window as any).__page;
    const host = document.getElementById('panes')!.getBoundingClientRect();
    return {
      x: Math.round(host.left + pg.chromeOrigin.x + pg.canvasBox.width / 2),
      y: Math.round(host.top + pg.chromeOrigin.y + pg.paneGeom.price.height / 2),
    };
  });
}

/** 从 pane 中心按住往左拖 `pixels`（左拖 = 看更新的数据 = 未来空位的方向）。 */
async function dragLeft(page: Page, pixels: number) {
  const at = await paneCenter(page);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  const steps = 16;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(at.x - (pixels * i) / steps, at.y, { steps: 1 });
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
}

test.describe('K 线终端示例页', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__page && (window as any).__page.stack));
    await page.waitForTimeout(800);
  });

  test('光标只在按住主键时变成小手', async ({ page }) => {
    const at = await paneCenter(page);
    const cursor = () => page.evaluate(() => document.getElementById('panes')!.style.cursor);

    await page.mouse.move(at.x, at.y);
    await page.waitForTimeout(120);
    expect(await cursor(), '悬停不该变手').toBe('');

    await page.mouse.down();
    await page.waitForTimeout(80);
    expect(await cursor(), '按下就该变手').toBe('grabbing');

    await page.mouse.move(at.x - 60, at.y, { steps: 6 });
    expect(await cursor(), '拖动中保持手').toBe('grabbing');

    await page.mouse.up();
    await page.waitForTimeout(120);
    expect(await cursor(), '松手收回').toBe('');
  });

  test('停在最新 K 上时向左拖进未来空位，窗口跨度不变', async ({ page }) => {
    const start = await snapshot(page);
    expect(start.follow, '起手应当跟盘').toBe(true);
    expect(start.panes.price.last, '跟盘时右端就是最新 K').toBe(start.newestKey);
    expect(start.right, '起手右端还是真实 K').toBeLessThan(start.real);

    await dragLeft(page, 260);
    const after = await snapshot(page);

    expect(after.follow, '自己拖过就不再跟盘').toBe(false);
    expect(after.slots, '未来空位要有货').toBeGreaterThan(0);
    expect(after.right, '窗口右端应当已经进到未来空位里').toBeGreaterThanOrEqual(after.real);
    expect(after.panes.price.n, '跨度不许被改写').toBe(start.panes.price.n);
    expect(after.left, '左端不许飞到最老一根').toBeGreaterThan(start.left);
  });

  test('拖到未来深处：三块 pane 同窗，且都是空白', async ({ page }) => {
    await dragLeft(page, 380);
    await dragLeft(page, 380);
    await dragLeft(page, 380);
    const deep = await snapshot(page);
    expect(deep.visibleReal, '深处的视窗里不该还有真实 K').toBe(0);

    const { price, volume, indicator } = deep.panes;
    expect(volume.first, '量图要和主图同窗').toBe(price.first);
    expect(indicator.first, '副图要和主图同窗').toBe(price.first);
    expect(volume.last).toBe(price.last);
    expect(indicator.last).toBe(price.last);

    for (const [id, pane] of Object.entries(deep.panes)) {
      expect(pane.y.length, `${id} 的量程不能塌`).toBeGreaterThan(0);
      for (const value of pane.y) expect(Number.isFinite(value), `${id} 量程是 NaN`).toBe(true);
    }
    expect(deep.panes.price.y[0], '价格轴还应当在价格量级上').toBeGreaterThan(1000);

    const ink = await seriesInk(page);
    expect(ink.price, '未来区不该有 K 线').toBe(0);
    expect(ink.volume, '未来区不该有量柱').toBe(0);
    expect(ink.indicator, '未来区不该有指标').toBe(0);
  });

  test('回到最新：重新跟盘并贴住最新 K', async ({ page }) => {
    await dragLeft(page, 380);
    await dragLeft(page, 380);
    await page.click('#btn-latest');
    await page.waitForTimeout(600);
    const home = await snapshot(page);
    expect(home.follow).toBe(true);
    expect(home.panes.price.last).toBe(home.newestKey);
    expect(home.panes.price.n).toBeGreaterThan(50);
    expect(home.visibleReal).toBe(home.panes.price.n);
  });
});
