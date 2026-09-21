/**
 * 设备像素比。
 *
 * ice-render 的 `dpr` **默认是 1**（`ICE.dpr = 1`），要高分屏不发虚必须显式传 ——
 * `ICEChartOptions.dpr` 存在，但引擎不会自己去读 `window.devicePixelRatio`。
 * 实测：在 devicePixelRatio = 3 的机器上不传 dpr，画布的 backing store 只有 CSS 尺寸，
 * 浏览器把 1x 位图放大 3 倍显示 —— 整张图（含轴线、刻度、K 线）都是糊的。
 *
 * 所以本包**默认按设备像素比渲染**，调用方仍可用 `dpr` 覆盖（传 1 就是旧行为）。
 */

/** 上限：再高的 dpr 只是白烧显存，人眼在 3x 以上基本分不出来。 */
export const MAX_DEVICE_PIXEL_RATIO = 3;

/** 当前环境的设备像素比（拿不到就 1，上限 3）。 */
export function defaultDevicePixelRatio(): number {
  if (typeof window === 'undefined') return 1;
  const raw = Number((window as unknown as { devicePixelRatio?: number }).devicePixelRatio);
  if (!isFinite(raw) || raw <= 0) return 1;
  return Math.min(MAX_DEVICE_PIXEL_RATIO, raw);
}

/** 解析最终使用的 dpr：显式传的优先（含 1），没传就用环境值。 */
export function resolveDpr(value?: number): number {
  if (value === undefined || value === null) return defaultDevicePixelRatio();
  const raw = Number(value);
  if (!isFinite(raw) || raw <= 0) return 1;
  return Math.min(MAX_DEVICE_PIXEL_RATIO, raw);
}
