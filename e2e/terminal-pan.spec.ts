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

/** 某一格的页面几何：容器原点（对齐到该格画布左上角）+ 该格绘图区（画布 CSS px）。 */
async function paneGeometry(page: Page, id: string) {
  return page.evaluate((paneId) => {
    const pg = (window as any).__page;
    const host = document.getElementById('panes')!.getBoundingClientRect();
    const geom = pg.paneGeom[paneId];
    const plot = pg.stack.chartOf(paneId).layout.plot;
    return {
      left: host.left + pg.chromeOrigin.x,
      top: host.top + pg.chromeOrigin.y + geom.top,
      plot: { x: plot.x, y: plot.y, width: plot.width, height: plot.height },
    };
  }, id);
}

/** 在某一格的绘图区里纵向拖 `pixels`（正数 = 往下拖 = 手动量程）。 */
async function dragVertical(page: Page, id: string, pixels: number) {
  const geo = await paneGeometry(page, id);
  const x = Math.round(geo.left + geo.plot.x + geo.plot.width / 2);
  const y = Math.round(geo.top + geo.plot.y + geo.plot.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  const steps = 16;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x, y + (pixels * i) / steps, { steps: 1 });
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/** 某一格**右侧数值标尺**的中点（标尺 = 绘图区右缘到画布右缘之间那一条）。 */
async function rulerPoint(page: Page, id: string) {
  const geo = await paneGeometry(page, id);
  return {
    x: Math.round(geo.left + geo.plot.x + geo.plot.width + 12),
    y: Math.round(geo.top + geo.plot.y + geo.plot.height / 2),
  };
}

/** 在某一格**右侧数值标尺**上双击。 */
async function dblclickRuler(page: Page, id: string) {
  const at = await rulerPoint(page, id);
  await page.mouse.dblclick(at.x, at.y);
  await page.waitForTimeout(300);
}

/** 在某一格**右侧数值标尺**上滚一格（`delta < 0` = 放大）。 */
async function wheelRuler(page: Page, id: string, delta: number) {
  const at = await rulerPoint(page, id);
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(0, delta);
  await page.waitForTimeout(200);
}

/**
 * 在某一格右侧标尺上按住往上拖 `pixels`（正数 = 往上 = 放大数值轴）。
 *
 * 分成「按下 / 分段移动 / 松手」三步暴露出来，是为了让用例能在拖动**中途**取状态，
 * 也能把指针拖回出发点再松手。
 */
async function dragRulerUp(page: Page, id: string, pixels: number, steps = 16) {
  const at = await rulerPoint(page, id);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(at.x, at.y - (pixels * i) / steps, { steps: 1 });
  }
  await page.mouse.up();
  await page.waitForTimeout(250);
}

/**
 * 数值轴的刻度：步长（数据单位）、**一档占多少像素**、档数、标签、以及三块 pane 的绘图区是否等宽对齐。
 *
 * 像素间距按「首尾两个刻度之间的实际像素 ÷ 间隔数」算 —— 刻度不一定铺满整个数据域
 * （引擎会给数据域留边），直接用轴长 ÷ (档数-1) 会偏。
 */
async function tickState(page: Page) {
  return page.evaluate(() => {
    const pg = (window as any).__page;
    const chart = pg.stack.chartOf('price');
    const layout = chart.layout.yAxisLayout;
    const plot = chart.layout.plot;
    const ticks = (layout.ticks || []).map(Number);
    const domain = chart.getDomain('y').map(Number);
    let step = Infinity;
    for (let i = 1; i < ticks.length; i++) {
      const d = Math.abs(ticks[i] - ticks[i - 1]);
      if (d > 0 && d < step) step = d;
    }
    const pixelSpan =
      ticks.length > 1 && domain[1] > domain[0]
        ? (plot.height * (ticks[ticks.length - 1] - ticks[0])) / (domain[1] - domain[0])
        : 0;
    const plots = ['price', 'volume', 'indicator'].map((id) => pg.stack.chartOf(id).layout.plot);
    const aligned = plots.every(
      (item) => Math.abs(item.x - plots[0].x) < 0.01 && Math.abs(item.width - plots[0].width) < 0.01
    );
    return {
      step: isFinite(step) ? step : 0,
      count: ticks.length,
      spacing: ticks.length > 1 ? pixelSpan / (ticks.length - 1) : 0,
      labels: layout.labels || [],
      aligned,
    };
  });
}

/** 最下面那条**时间轴**上的一点（绘图区下缘往下的标签带里）。 */
async function timeAxisPoint(page: Page) {
  const geo = await paneGeometry(page, 'indicator');
  return {
    x: Math.round(geo.left + geo.plot.x + geo.plot.width / 2),
    y: Math.round(geo.top + geo.plot.y + geo.plot.height + 4),
  };
}

/** 某一格的数据域窗口。 */
async function axisDomain(page: Page, id: string, axis: 'x' | 'y') {
  return page.evaluate(
    ([paneId, which]) => (window as any).__page.stack.chartOf(paneId).getDomain(which),
    [id, axis] as [string, 'x' | 'y']
  );
}

/**
 * 某一格绘图区里「系列颜色」像素的纵向范围（画布 CSS px）。
 *
 * 这就是「K 线有没有铺满绘图区」的行为判据：量程被手动拖跑之后，K 线要么被顶出绘图区
 * 被裁掉、要么缩成一小条，纵向范围立刻变小 —— 不去读任何内部字段。
 */
async function inkBox(page: Page, id: string) {
  return page.evaluate((paneId) => {
    const pg = (window as any).__page;
    const chart = pg.stack.chartOf(paneId);
    const plot = chart.layout.plot;
    const dpr = pg.dpr || 1;
    const ctx = chart.ice.canvasEl.getContext('2d');
    const x0 = Math.round((plot.x + 1) * dpr);
    const y0 = Math.round((plot.y + 1) * dpr);
    const w = Math.max(1, Math.round((plot.width - 2) * dpr));
    const h = Math.max(1, Math.round((plot.height - 2) * dpr));
    const img = ctx.getImageData(x0, y0, w, h).data;
    let top = -1;
    let bottom = -1;
    for (let cy = 0; cy < h; cy++) {
      let ink = 0;
      for (let cx = 0; cx < w; cx++) {
        const i = (cy * w + cx) * 4;
        const max = Math.max(img[i], img[i + 1], img[i + 2]);
        const min = Math.min(img[i], img[i + 1], img[i + 2]);
        if (max > 90 && max - min > 60) ink += 1;
      }
      if (ink > 0) {
        if (top < 0) top = cy;
        bottom = cy;
      }
    }
    return { top: top / dpr, bottom: bottom / dpr, height: (bottom - top + 1) / dpr };
  }, id);
}

/** 在主图上滚 `ticks` 次滚轮（`delta < 0` = 放大）。 */
async function wheel(page: Page, ticks: number, delta: number) {
  const at = await paneCenter(page);
  await page.mouse.move(at.x, at.y);
  for (let i = 0; i < ticks; i++) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(24);
  }
  await page.waitForTimeout(350);
}

/** 绘图区宽度 + 每根占多少像素 + 三块 pane 的窗口。 */
async function zoomState(page: Page) {
  return page.evaluate(() => {
    const pg = (window as any).__page;
    const chart = pg.stack.chartOf('price');
    const domain = chart.getDomain('x') || [];
    const plot = chart.layout.plot;
    const panes: Record<string, string> = {};
    for (const id of ['price', 'volume', 'indicator']) {
      const d = pg.stack.chartOf(id).getDomain('x') || [];
      panes[id] = `${d.length}|${d[0]}|${d[d.length - 1]}`;
    }
    const index = (key: string) => pg.poolIndexOf(key);
    return {
      count: domain.length,
      spacing: plot.width / Math.max(1, domain.length),
      plotWidth: plot.width,
      right: index(domain[domain.length - 1]),
      newest: pg.candles.length - 1,
      panes,
      aligned: panes.price === panes.volume && panes.price === panes.indicator,
      // x 轴标签带里「有墨的连续段」：糊成一条色带时只剩 1 段
      labelRuns: (() => {
        const bottom = pg.stack.chartOf('indicator');
        const c = bottom.ice.canvasEl;
        const ctx = c.getContext('2d');
        const dpr = pg.dpr || 1;
        const p = bottom.layout.plot;
        const y0 = Math.round((p.y + p.height + 6) * dpr);
        const h = Math.max(1, Math.round(14 * dpr));
        const x0 = Math.round(p.x * dpr);
        const w = Math.round(p.width * dpr);
        const data = ctx.getImageData(x0, y0, w, h).data;
        let runs = 0;
        let gap = 999;
        for (let cx = 0; cx < w; cx++) {
          let ink = 0;
          for (let cy = 0; cy < h; cy++) {
            const i = (cy * w + cx) * 4;
            if (data[i] > 90 || data[i + 1] > 90 || data[i + 2] > 90) ink++;
          }
          if (ink > 0) {
            if (gap >= Math.round(4 * dpr)) runs++;
            gap = 0;
          } else {
            gap++;
          }
        }
        return runs;
      })(),
    };
  });
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

  test('右侧标尺上双击：数值轴自适应（x 窗口一根不动）', async ({ page }) => {
    // 暂停推流：像素判据要的是「同一份数据」，最新一根的高低价还在长会干扰比较
    await page.click('#btn-toggle');
    await page.waitForTimeout(200);

    const startY = await axisDomain(page, 'price', 'y');
    const startX = await axisDomain(page, 'price', 'x');
    const startInk = await inkBox(page, 'price');

    // ① 纵向拖过 = 手动量程：K 线不再铺满绘图区
    await dragVertical(page, 'price', 160);
    const draggedY = await axisDomain(page, 'price', 'y');
    const draggedInk = await inkBox(page, 'price');
    expect(draggedY[0]).not.toBe(startY[0]);
    expect(draggedInk.height, '拖过之后 K 线不该还铺满').toBeLessThan(startInk.height - 20);

    // ② 在右侧标尺上双击 = 自适应：量程回到「按可见窗口算出来的那一段」
    await dblclickRuler(page, 'price');
    const auto = await page.evaluate(() => (window as any).__page.visiblePriceRange());
    const fittedY = await axisDomain(page, 'price', 'y');
    expect(fittedY[0], '下端要盖住可见窗口的最低影线').toBeLessThanOrEqual(auto.min + 1e-6);
    expect(fittedY[1], '上端要盖住可见窗口的最高影线').toBeGreaterThanOrEqual(auto.max - 1e-6);
    // 可见窗口没变（纵向拖不改 x），所以量程应当**原样**回到拖之前那一段
    expect(fittedY, '量程回到拖之前的自适应量程').toEqual(startY);
    expect(await axisDomain(page, 'price', 'x'), '自适应只管 y，x 窗口一根不动').toEqual(startX);
    expect((await inkBox(page, 'price')).height, 'K 线又铺回原来的高度').toBeCloseTo(startInk.height, 0);
    expect(
      await page.evaluate(() => document.getElementById('s-hint')!.textContent),
      '给出了手势反馈'
    ).toContain('自适应');

    // ③ 落在绘图区里的双击不是这个手势（手动量程要原样保留）
    await dragVertical(page, 'price', 120);
    const manualY = await axisDomain(page, 'price', 'y');
    const geo = await paneGeometry(page, 'price');
    await page.mouse.dblclick(
      Math.round(geo.left + geo.plot.x + geo.plot.width / 2),
      Math.round(geo.top + geo.plot.y + geo.plot.height / 2)
    );
    await page.waitForTimeout(300);
    expect(await axisDomain(page, 'price', 'y')).toEqual(manualY);
  });

  test('双击标尺不该把「跟盘」踢掉（量程调整不外抛 pan / zoom 事件）', async ({ page }) => {
    const before = await snapshot(page);
    await dblclickRuler(page, 'price');
    const after = await snapshot(page);
    expect(after.follow).toBe(true);
    expect(after.panes.price.first).toBe(before.panes.price.first);
    expect(after.panes.price.last).toBe(before.newestKey);
    expect(await page.evaluate(() => document.getElementById('btn-latest')!.style.display)).toBe('none');
  });

  test('标尺上滚轮：缩放数值轴；绘图区里的滚轮仍是时间轴缩放', async ({ page }) => {
    const beforeX = await axisDomain(page, 'price', 'x');
    const beforeY = await axisDomain(page, 'price', 'y');
    const beforeSpan = Number(beforeY[1]) - Number(beforeY[0]);

    // ① 标尺上往上滚 = 放大数值轴：窗口变窄，时间窗口一根不动
    await wheelRuler(page, 'price', -120);
    const zoomed = await axisDomain(page, 'price', 'y');
    expect(Number(zoomed[1]) - Number(zoomed[0]), '滚上去要把价格轴放大').toBeLessThan(beforeSpan);
    expect(await axisDomain(page, 'price', 'x'), '标尺上的滚轮不该动时间窗口').toEqual(beforeX);
    // 指针停在标尺上时不该出现「准星横线 + 价签」—— 那是绘图区里的读数，标尺上不是
    expect(
      await page.evaluate(() => getComputedStyle(document.querySelector('.hline')!).display),
      '标尺上不该出现悬空的准星横线'
    ).toBe('none');

    // ② 绘图区里的滚轮照旧只动 x（引擎那条路径没被抢走），**手动量程原样保留**
    await wheel(page, 3, -120);
    expect(await axisDomain(page, 'price', 'x'), '绘图区滚轮照旧缩放时间轴').not.toEqual(beforeX);
    expect(await axisDomain(page, 'price', 'y'), '绘图区滚轮不该动数值轴').toEqual(zoomed);

    // ③ 双击标尺把量程还回去 → y 回到「自动」：盖住当前可见窗口那一段
    await dblclickRuler(page, 'price');
    const auto = await page.evaluate(() => (window as any).__page.visiblePriceRange());
    const fitted = await axisDomain(page, 'price', 'y');
    expect(fitted[0]).toBeLessThanOrEqual(auto.min + 1e-6);
    expect(fitted[1]).toBeGreaterThanOrEqual(auto.max - 1e-6);
  });

  test('底部时间轴上双击：重置时间轴（默认根数 + 回到最新）', async ({ page }) => {
    const start = await snapshot(page);
    await wheel(page, 8, -120);
    const zoomed = await snapshot(page);
    expect(zoomed.panes.price.n, '先得真的放大过').toBeLessThan(start.panes.price.n);

    const at = await timeAxisPoint(page);
    await page.mouse.dblclick(at.x, at.y);
    await page.waitForTimeout(500);
    const home = await snapshot(page);
    expect(home.follow, '时间轴重置 = 回到跟盘').toBe(true);
    expect(home.panes.price.last, '右端贴住最新一根').toBe(home.newestKey);
    expect(home.panes.price.n, '回到默认根数').toBe(start.panes.price.n);
    expect(
      await page.evaluate(() => document.getElementById('s-hint')!.textContent),
      '给出了手势反馈'
    ).toContain('时间轴');
  });

  test('标尺上按住上下拖：数值轴跟着缩放（向上拖 = 放大），x 窗口不动', async ({ page }) => {
    await page.click('#btn-toggle');
    await page.waitForTimeout(200);
    const beforeX = await axisDomain(page, 'price', 'x');
    const beforeY = (await axisDomain(page, 'price', 'y')).map(Number);
    const span0 = beforeY[1] - beforeY[0];
    const cursor = () => page.evaluate(() => document.getElementById('panes')!.style.cursor);
    const at = await rulerPoint(page, 'price');

    // 光标：标尺上悬停就是「上下箭头」（那里按下是拖拽缩放，不是平移小手）
    await page.mouse.move(at.x, at.y);
    await page.waitForTimeout(120);
    expect(await cursor(), '悬停标尺要给 ns-resize').toBe('ns-resize');

    // 按住往上拖 80px = 放大；拖动中途指针离开标尺也不许丢
    await page.mouse.down();
    for (let i = 1; i <= 16; i++) {
      await page.mouse.move(at.x - (i > 8 ? 30 : 0), at.y - (80 * i) / 16, { steps: 1 });
    }
    const dragged = (await axisDomain(page, 'price', 'y')).map(Number);
    expect(dragged[1] - dragged[0], '向上拖要把数值轴放大').toBeLessThan(span0);
    expect(await cursor(), '拖动中保持 ns-resize').toBe('ns-resize');
    expect(await axisDomain(page, 'price', 'x'), '标尺拖拽不该动时间窗口').toEqual(beforeX);

    // 指针拖回出发点再松手 = 窗口原样（快照口径，不累积误差）
    await page.mouse.move(at.x, at.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    expect(await axisDomain(page, 'price', 'y'), '拖回去就该还回来').toEqual(beforeY);
    expect(await cursor(), '松手后回到 ns-resize（指针还在标尺上）').toBe('ns-resize');

    // 绘图区里的指针仍然是「按下去才变手」的老规矩
    const center = await paneCenter(page);
    await page.mouse.move(center.x, center.y);
    await page.waitForTimeout(120);
    expect(await cursor(), '绘图区悬停不给 ns-resize').toBe('');
  });

  test('刻度密度：价格轴一档落在 19~47px（默认 5 档那会儿是 57~71px），缩放后仍然稳', async ({ page }) => {
    await page.click('#btn-toggle');
    await page.waitForTimeout(200);
    const before = await tickState(page);
    expect(before.count, '默认就要给足档数（不是 5 档）').toBeGreaterThanOrEqual(8);
    expect(before.spacing, '一档至少 19px').toBeGreaterThan(18);
    expect(before.spacing, '一档最多 47px（1/2/5 梯子的粒度）').toBeLessThan(48);
    expect(before.aligned).toBe(true);

    // 缩放（标尺上按住往上拖）：窗口窄了，密度要跟着重算，而不是固定在某个档数上
    await dragRulerUp(page, 'price', 200);
    const zoomed = await tickState(page);
    expect(zoomed.count, '窄窗口也要有好几档').toBeGreaterThanOrEqual(4);
    expect(zoomed.spacing, '缩到再细也不许挤成一团').toBeGreaterThan(18);
    expect(zoomed.spacing, '缩到再细也不许稀下去').toBeLessThan(48);
    expect(zoomed.step, '放大之后刻度只会更细，不会更粗').toBeLessThanOrEqual(before.step);
    expect(zoomed.labels).not.toEqual(before.labels);
    expect(zoomed.aligned, '标签变长也没把三块图的绘图区挤歪').toBe(true);

    // 双击标尺回到自适应：刻度与三条 pane 的对齐都回到原样
    await dblclickRuler(page, 'price');
    const home = await tickState(page);
    expect(home.step).toBeCloseTo(before.step, 6);
    expect(home.spacing).toBeCloseTo(before.spacing, 0);
    expect(home.aligned).toBe(true);

    // 三块 pane 的档数各自按自己的轴长算：价格轴最密，成交量 / 副图够用就好
    const others = await page.evaluate(() => {
      const pg = (window as any).__page;
      return ['volume', 'indicator'].map((id) => {
        const layout = pg.stack.chartOf(id).layout.yAxisLayout;
        return { id, count: (layout.ticks || []).length };
      });
    });
    for (const pane of others) {
      expect(pane.count, `${pane.id} 至少两档`).toBeGreaterThanOrEqual(2);
      expect(pane.count, `${pane.id} 不该挤成一团`).toBeLessThanOrEqual(10);
    }
  });

  test('只动数值轴不算「动过视窗」：纵向拖之后仍然跟盘', async ({ page }) => {
    await dragVertical(page, 'price', 160);
    const after = await snapshot(page);
    expect(after.follow, '纵向拖不改时间窗口，跟盘不该退出').toBe(true);
    expect(after.panes.price.last, '窗口还贴在最新一根上').toBe(after.newestKey);
    expect(after.visibleReal, '可见窗口里全是真实 K').toBe(after.panes.price.n);

    // 数值轴缩放同理：窗口窄了、但时间轴还是跟着最新一根走
    await wheelRuler(page, 'price', -120);
    const zoomed = await snapshot(page);
    expect(zoomed.follow).toBe(true);
    expect(zoomed.panes.price.last).toBe(zoomed.newestKey);
  });

  test('最新价被推出视野时：虚线不画，价签钉在价格轴的上/下沿', async ({ page }) => {
    await page.click('#btn-toggle');
    await page.waitForTimeout(200);
    // 锚在**离最新价更远的那一端**：连着放大之后，最新价必定被挤出绘图区
    const plan = await page.evaluate(() => {
      const pg = (window as any).__page;
      const chart = pg.stack.chartOf('price');
      const range = pg.visiblePriceRange();
      const last = pg.candles[pg.candles.length - 1].c;
      const anchorPrice = last - range.min >= range.max - last ? range.min : range.max;
      return { y: ICETradingChart.priceToY(chart, anchorPrice, 0), last, min: range.min, max: range.max };
    });
    const geo = await paneGeometry(page, 'price');
    await page.mouse.move(Math.round(geo.left + geo.plot.x + geo.plot.width + 12), Math.round(geo.top + plan.y));
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(250);

    const state = await page.evaluate(() => {
      const pg = (window as any).__page;
      const chart = pg.stack.chartOf('price');
      const plot = chart.layout.plot;
      const last = pg.candles[pg.candles.length - 1];
      const line = document.querySelector('.lastline') as HTMLElement;
      const tag = document.querySelector('.tag.last') as HTMLElement;
      return {
        plot: { y: plot.y, height: plot.height },
        priceY: ICETradingChart.priceToY(chart, last.c, 0),
        lineShown: getComputedStyle(line).display !== 'none',
        tagShown: getComputedStyle(tag).display !== 'none',
        tagCenter: parseFloat(tag.style.top) + tag.offsetHeight / 2,
      };
    });
    expect(
      state.priceY < state.plot.y || state.priceY > state.plot.y + state.plot.height,
      '先确认最新价真的在视野之外'
    ).toBe(true);
    expect(state.lineShown, '虚线不该画到别的 pane 上').toBe(false);
    expect(state.tagShown, '价签要留在价格轴上').toBe(true);
    // 价签以「钉住的那个 y」为中心，所以半个标签可能压在绘图区边上 —— 但必须留在**这一格**里
    expect(state.tagCenter).toBeGreaterThanOrEqual(state.plot.y - 2);
    expect(state.tagCenter).toBeLessThanOrEqual(state.plot.y + state.plot.height + 2);
  });

  test('缩放有上下限：最密 0.5px/根、最粗半幅一根；且不许凭空长出未来空位', async ({ page }) => {
    const start = await zoomState(page);

    // ① 探底：连缩 40 格
    await wheel(page, 40, +120);
    const out = await zoomState(page);
    expect(out.count, '缩小要真的生效').toBeGreaterThan(start.count);
    expect(out.spacing, '最密不许低于 0.5px/根').toBeGreaterThanOrEqual(0.5 - 1e-6);
    expect(out.count, '不得越过 minBarSpacing 对应的根数').toBeLessThanOrEqual(Math.floor(out.plotWidth / 0.5) + 1);
    // 右端不许长进未来空位：缩小时看到的是更多历史，不是一片空白
    expect(out.right, '缩小时右端不许越过最新一根').toBeLessThanOrEqual(out.newest + 1);
    // 三块 pane 依然同窗
    expect(out.aligned, '缩到底时三块 pane 仍要同窗').toBe(true);
    // x 轴标签不能糊成一条色带（糊了的话整条带子只有 1 段连续墨迹）
    expect(out.labelRuns, '轴标签要抽稀成多段，不是一条色带').toBeGreaterThan(3);

    // ② 探顶：连放 40 格
    await wheel(page, 40, -120);
    const back = await zoomState(page);
    expect(back.count, '放到底最少两根').toBeGreaterThanOrEqual(2);
    expect(back.spacing, '最粗不许超过半幅一根').toBeLessThanOrEqual(back.plotWidth / 2 + 1e-6);
    expect(back.aligned, '放到头时三块 pane 仍要同窗').toBe(true);
    expect(back.labelRuns).toBeGreaterThan(1);
  });
});
