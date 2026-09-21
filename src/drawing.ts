import type { ICEChart } from '@damoqiongqiu/ice-chart';
import { categoryToX, plotRect, priceToY, xToCategoryIndex, yToPrice } from './project';

/**
 * 画线工具。
 *
 * 为什么用 **SVG 覆盖层**而不是引擎图元 + marks：
 * - 拖动、命中、选中都是浏览器原生的（`pointerdown` 落在线上就是选中它），不用跟引擎的
 *   脏矩形 / 组件缓存打交道；
 * - 图形按**数据坐标**存（`{ x, y }`，x 是类目、y 是价格），缩放平移后按当前比例尺重投影即可，
 *   既不用重建组件，也不会踩到 `pixelAt()` 的动画插值；
 * - 与图表外壳（抬头 / 价签）同一套机制，一层容器一处同步。
 *
 * 代价：图形画在 DOM 里而不是 canvas 里，导出图片时不会一起导出（本包不承诺这个）。
 *
 * ⚠️ 依赖**类目轴**：x 以类目标签存储、靠 `xToCategoryIndex` 反查下标。数值/时间轴上
 * 请改用其它方案（本包目前只支持类目轴）。
 */

export type DrawingKind = 'hline' | 'vline' | 'trend' | 'rect';

export const DRAWING_KINDS: DrawingKind[] = ['hline', 'vline', 'trend', 'rect'];

export interface DrawingPoint {
  /** 类目标签。带日期的标签由调用方保证唯一。 */
  x: unknown;
  /** 价格。 */
  y: number;
}

export interface Drawing {
  id: string;
  kind: DrawingKind;
  points: DrawingPoint[];
  color?: string;
  label?: string;
}

export interface DrawingLayerOptions {
  /** 覆盖层挂在哪个容器上；默认用画布的父元素（要求它是 `position: relative`）。 */
  container?: HTMLElement;
  /** 默认线色。 */
  color?: string;
  /** 选中态线色。 */
  activeColor?: string;
  /** 锚点半径（px），默认 4。 */
  handleRadius?: number;
  /** 图形集合变化（增 / 删 / 拖完）时回调。 */
  onChange?: (drawings: Drawing[]) => void;
}

export interface DrawingLayer {
  list(): Drawing[];
  add(drawing: Omit<Drawing, 'id'> & { id?: string }): Drawing | null;
  remove(id: string): boolean;
  clear(): void;
  select(id: string | null): void;
  selected(): Drawing | null;
  /** 覆盖整套图形（反序列化）。 */
  load(drawings: Drawing[]): void;
  /** 序列化（可直接 `JSON.stringify` 存盘）。 */
  dump(): Drawing[];
  /** 进入「在图上点两下画一条」的交互模式；`null` 退出。 */
  setMode(kind: DrawingKind | null): void;
  mode(): DrawingKind | null;
  /** 按当前比例尺重画。 */
  refresh(force?: boolean): void;
  destroy(): void;
}

const NS = 'http://www.w3.org/2000/svg';

/** 每种图形需要几个锚点。 */
export function requiredPoints(kind: DrawingKind): number {
  return kind === 'hline' || kind === 'vline' ? 1 : 2;
}

interface DragState {
  id: string;
  /** -1 表示整条平移，>=0 表示拖第几个锚点。 */
  pointIndex: number;
  /** 按下那一刻的原始锚点（整条平移时用它做增量基准，避免累积漂移）。 */
  origin: DrawingPoint[];
  /** 按下那一刻指针所在的数据坐标。 */
  grab: DrawingPoint;
}

export function createDrawingLayer(chart: ICEChart, options: DrawingLayerOptions = {}): DrawingLayer {
  const color = options.color || '#f5a524';
  const activeColor = options.activeColor || '#3b82f6';
  const radius = options.handleRadius === undefined ? 4 : options.handleRadius;

  const canvas = (chart as unknown as { ice?: { canvasEl?: HTMLCanvasElement } }).ice?.canvasEl;
  const host = options.container || (canvas && canvas.parentElement) || null;
  if (!host) {
    throw new Error('[ice-trading-chart] createDrawingLayer：找不到覆盖层容器，请显式传 container。');
  }
  host.style.position = host.style.position || 'relative';

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('data-role', 'drawing-layer');
  svg.style.position = 'absolute';
  svg.style.inset = '0';
  svg.style.width = '100%';
  svg.style.height = '100%';
  // 覆盖层本身不吃事件；只有画出来的图形（与「画线模式」下的底板）吃。
  svg.style.pointerEvents = 'none';
  svg.style.overflow = 'visible';
  host.appendChild(svg);

  let drawings: Drawing[] = [];
  let selectedId: string | null = null;
  let mode: DrawingKind | null = null;
  let pending: DrawingPoint | null = null;
  let seq = 0;
  let drag: DragState | null = null;
  let signature = '';

  const clone = (item: Drawing): Drawing => ({ ...item, points: item.points.map((p) => ({ ...p })) });

  const notify = () => {
    if (options.onChange) options.onChange(drawings.map(clone));
  };

  /** 数据坐标 → 画布 CSS 像素。 */
  const toPixel = (point: DrawingPoint): [number, number] | null => {
    const x = categoryToX(chart, point.x);
    const y = priceToY(chart, point.y, 0);
    if (x === null || y === null) return null;
    return [x, y];
  };

  /** 画布 CSS 像素 → 数据坐标。 */
  const toData = (px: number, py: number): DrawingPoint | null => {
    const price = yToPrice(chart, py, 0);
    const index = xToCategoryIndex(chart, px);
    if (price === null || index === null) return null;
    const domain = chart.getDomain('x');
    if (!domain.length) return null;
    const clamped = Math.max(0, Math.min(domain.length - 1, index));
    return { x: domain[clamped], y: price };
  };

  /** 类目下标差（整条平移用）。 */
  const indexOf = (value: unknown): number => chart.getDomain('x').indexOf(value);

  const shiftX = (value: unknown, delta: number): unknown => {
    if (!delta) return value;
    const domain = chart.getDomain('x');
    const index = domain.indexOf(value);
    if (index < 0) return value;
    return domain[Math.max(0, Math.min(domain.length - 1, index + delta))];
  };

  const localPoint = (event: PointerEvent): [number, number] => {
    const rect = svg.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };

  const geometry = (drawing: Drawing) => {
    const plot = plotRect(chart);
    if (!plot) return null;
    const pixels = drawing.points.map(toPixel);
    if (pixels.some((item) => item === null)) return null;
    const points = pixels as Array<[number, number]>;
    if (drawing.kind === 'hline') {
      return { x1: plot.x, y1: points[0][1], x2: plot.x + plot.width, y2: points[0][1] };
    }
    if (drawing.kind === 'vline') {
      return { x1: points[0][0], y1: plot.y, x2: points[0][0], y2: plot.y + plot.height };
    }
    return { x1: points[0][0], y1: points[0][1], x2: points[1][0], y2: points[1][1] };
  };

  const render = () => {
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    for (const drawing of drawings) {
      const geo = geometry(drawing);
      if (!geo) continue;
      const isActive = drawing.id === selectedId;
      const stroke = drawing.color || (isActive ? activeColor : color);

      if (drawing.kind === 'rect') {
        const box = document.createElementNS(NS, 'rect');
        box.setAttribute('x', String(Math.min(geo.x1, geo.x2)));
        box.setAttribute('y', String(Math.min(geo.y1, geo.y2)));
        box.setAttribute('width', String(Math.abs(geo.x2 - geo.x1)));
        box.setAttribute('height', String(Math.abs(geo.y2 - geo.y1)));
        box.setAttribute('fill', isActive ? 'rgba(59,130,246,0.14)' : 'rgba(245,165,36,0.10)');
        box.setAttribute('stroke', stroke);
        box.setAttribute('stroke-width', '1');
        box.style.pointerEvents = 'auto';
        box.style.cursor = 'move';
        box.dataset.drawingId = drawing.id;
        svg.appendChild(box);
      } else {
        const line = document.createElementNS(NS, 'line');
        line.setAttribute('x1', String(geo.x1));
        line.setAttribute('y1', String(geo.y1));
        line.setAttribute('x2', String(geo.x2));
        line.setAttribute('y2', String(geo.y2));
        line.setAttribute('stroke', stroke);
        line.setAttribute('stroke-width', isActive ? '2' : '1.3');
        line.setAttribute('stroke-dasharray', drawing.kind === 'hline' ? '5 4' : '0');
        line.style.pointerEvents = 'auto';
        line.style.cursor = 'move';
        line.dataset.drawingId = drawing.id;
        svg.appendChild(line);
      }

      if (isActive) {
        drawing.points.forEach((point, index) => {
          const pixel = toPixel(point);
          if (!pixel) return;
          const dot = document.createElementNS(NS, 'circle');
          dot.setAttribute('cx', String(pixel[0]));
          dot.setAttribute('cy', String(pixel[1]));
          dot.setAttribute('r', String(radius));
          dot.setAttribute('fill', '#0b0f16');
          dot.setAttribute('stroke', activeColor);
          dot.setAttribute('stroke-width', '2');
          dot.style.pointerEvents = 'auto';
          dot.style.cursor = 'grab';
          dot.dataset.drawingId = drawing.id;
          dot.dataset.pointIndex = String(index);
          svg.appendChild(dot);
        });
      }
    }

    if (pending) {
      const pixel = toPixel(pending);
      if (pixel) {
        const dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('cx', String(pixel[0]));
        dot.setAttribute('cy', String(pixel[1]));
        dot.setAttribute('r', '3');
        dot.setAttribute('fill', activeColor);
        svg.appendChild(dot);
      }
    }
  };

  /**
   * 重画，但先比几何签名。
   * 图表的 `render` 事件每帧都发，无脑重画会白白重建一遍 DOM。
   */
  const refresh = (force = false) => {
    const plot = plotRect(chart);
    if (!plot) return;
    const xDomain = chart.getDomain('x');
    const next = [
      plot.x,
      plot.y,
      plot.width,
      plot.height,
      xDomain.length,
      xDomain[0],
      xDomain[xDomain.length - 1],
      drawings.length,
      selectedId || '-',
      pending ? `${pending.x}:${pending.y}` : '-',
      drawings.map((item) => `${item.id}:${item.points.map((p) => `${p.x}@${p.y}`).join(',')}`).join('|'),
    ].join('~');
    if (!force && next === signature) return;
    signature = next;
    render();
  };

  const select = (id: string | null) => {
    selectedId = id;
    refresh(true);
  };

  const add = (input: Omit<Drawing, 'id'> & { id?: string }): Drawing | null => {
    const need = requiredPoints(input.kind);
    if (!Array.isArray(input.points) || input.points.length !== need) return null;
    seq += 1;
    const drawing: Drawing = {
      id: input.id || `d${seq}`,
      kind: input.kind,
      points: input.points.map((point) => ({ x: point.x, y: point.y })),
      color: input.color,
      label: input.label,
    };
    drawings = [...drawings, drawing];
    selectedId = drawing.id;
    pending = null;
    refresh(true);
    notify();
    return drawing;
  };

  const hitTest = (target: EventTarget | null): { id: string; pointIndex: number | null } | null => {
    const element = target as HTMLElement | null;
    const id = element && element.dataset ? element.dataset.drawingId : undefined;
    if (!id) return null;
    const raw = element!.dataset.pointIndex;
    return { id, pointIndex: raw === undefined ? null : Number(raw) };
  };

  const onPointerDown = (event: PointerEvent) => {
    const [px, py] = localPoint(event);
    const hit = hitTest(event.target);

    if (hit) {
      const drawing = drawings.find((item) => item.id === hit.id);
      if (!drawing) return;
      const grab = toData(px, py);
      if (!grab) return;
      selectedId = hit.id;
      drag = { id: hit.id, pointIndex: hit.pointIndex === null ? -1 : hit.pointIndex, origin: drawing.points.map((p) => ({ ...p })), grab };
      // 指针捕获在个别环境（jsdom / 老浏览器）没有实现，缺了也不影响拖动本身
      if (typeof (svg as unknown as { setPointerCapture?: unknown }).setPointerCapture === 'function') {
        svg.setPointerCapture(event.pointerId);
      }
      refresh(true);
      event.preventDefault();
      return;
    }

    if (!mode) {
      select(null);
      return;
    }
    const point = toData(px, py);
    if (!point) return;
    if (requiredPoints(mode) === 1) {
      add({ kind: mode, points: [point] });
      mode = null;
      svg.style.pointerEvents = 'none';
      svg.style.cursor = 'default';
      return;
    }
    if (!pending) {
      pending = point;
      refresh(true);
      return;
    }
    add({ kind: mode, points: [pending, point] });
    pending = null;
    mode = null;
    svg.style.pointerEvents = 'none';
    svg.style.cursor = 'default';
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!drag) return;
    const [px, py] = localPoint(event);
    const drawing = drawings.find((item) => item.id === drag!.id);
    if (!drawing) return;
    const target = toData(px, py);
    if (!target) return;

    if (drag.pointIndex >= 0) {
      drawing.points[drag.pointIndex] = target;
    } else {
      const deltaIndex = indexOf(target.x) - indexOf(drag.grab.x);
      const deltaPrice = target.y - drag.grab.y;
      drawing.points = drag.origin.map((point) => ({
        x: shiftX(point.x, deltaIndex),
        y: point.y + deltaPrice,
      }));
    }
    refresh(true);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!drag) return;
    drag = null;
    if (typeof (svg as unknown as { releasePointerCapture?: unknown }).releasePointerCapture === 'function') {
      try {
        svg.releasePointerCapture(event.pointerId);
      } catch (error) {
        void error;
      }
    }
    notify();
  };

  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerUp);
  chart.on('zoom:change', refresh);
  chart.on('pan:change', refresh);
  chart.on('render', refresh);

  refresh(true);

  return {
    list: () => drawings.map(clone),
    add,
    remove: (id: string) => {
      const before = drawings.length;
      drawings = drawings.filter((item) => item.id !== id);
      if (selectedId === id) selectedId = null;
      refresh(true);
      if (drawings.length !== before) notify();
      return drawings.length !== before;
    },
    clear: () => {
      drawings = [];
      selectedId = null;
      pending = null;
      refresh(true);
      notify();
    },
    select,
    selected: () => {
      const found = drawings.find((item) => item.id === selectedId);
      return found ? clone(found) : null;
    },
    load: (next: Drawing[]) => {
      drawings = (next || []).map((item, index) => ({
        id: item.id || `d${index + 1}`,
        kind: item.kind,
        points: (item.points || []).map((point) => ({ x: point.x, y: point.y })),
        color: item.color,
        label: item.label,
      }));
      seq = Math.max(seq, drawings.length);
      selectedId = null;
      refresh(true);
      notify();
    },
    dump: () => drawings.map(clone),
    setMode: (kind: DrawingKind | null) => {
      mode = kind;
      pending = null;
      svg.style.pointerEvents = kind ? 'auto' : 'none';
      svg.style.cursor = kind ? 'crosshair' : 'default';
      refresh(true);
    },
    mode: () => mode,
    refresh,
    destroy: () => {
      chart.off('zoom:change', refresh);
      chart.off('pan:change', refresh);
      chart.off('render', refresh);
      svg.removeEventListener('pointerdown', onPointerDown);
      svg.removeEventListener('pointermove', onPointerMove);
      svg.removeEventListener('pointerup', onPointerUp);
      svg.removeEventListener('pointercancel', onPointerUp);
      if (svg.parentNode) svg.parentNode.removeChild(svg);
    },
  };
}
