import { resolveTerminalMessages } from './messages';
import type { TerminalMessages } from './messages';
import { resolveTerminalTheme } from './theme';
import type { TerminalTheme } from './theme';

/**
 * **图表工具条**（周期 / 图表类型 / 指标 / 画线 / 显示）。
 *
 * 为什么在库里而不是页面里：这条工具条是"图表的一部分"（用户 2026-09-23 定），
 * 每个接入方各画一遍的代价是**四件事必然各不相同**：图标、主题、文案、状态同步。
 * 放在库里的收益就是这四件统一，而**定制**靠下面三层，不靠改库代码。
 *
 * ## 三层定制（按侵入度递增，见 `plans/chart-toolbar.md`）
 * 1. **声明式**：`items` 数组的顺序即显示顺序，不写就不显示；
 * 2. **自定义项**：同一个数组里混入 `{ id, label, icon, onClick(ctx), active(ctx) }`，
 *    与内置项走同一套渲染、同一套主题与文案；
 * 3. **整条替换**：`render(ctx) => { element, update }`，位置仍由图表给（见 `host`）。
 *
 * ## 一条铁律
 * **工具条不自己存图状态**。周期、图表类型、指标显隐的真相永远是图表 option：
 * 内置项只做「发意图（`onIntervalChange` / `onToggleIndicator`…）+ 读状态（`host.read*`）」，
 * 所以外部改了 option，下一次 `update()` 必须自己跟上 —— 否则迟早出现
 * 「工具条显示 5m、图上是 1H」。
 *
 * ## 与既有约定的一致性
 * 样式注入一次（id 守卫）+ 颜色全走 `--ice-toolbar-*` 变量、结构只建一次、变更按签名去重、
 * 文案走 `messages` 目录、主题走 `theme` token —— 与 `orderBook` / `Highlight` 同一套。
 */

/** 内置项名字（顺序无关，显示顺序由 `items` 决定）。 */
export type ToolbarItemName = 'intervals' | 'type' | 'indicators' | 'drawings' | 'display';

/** 自定义项：与内置项混在同一个 `items` 数组里。 */
export interface ToolbarCustomItem {
  id: string;
  /**
   * 按钮上的文字（与 `icon` 二选一或并存）。
   *
   * 可以给**函数**：需要跟着状态变的按钮走这条（周期按钮上的 `5m` 就是这种）——
   * 函数在每次 `update()` 时重新求值，所以外部把周期改成 `1H` 之后，按钮上的字自己跟上。
   */
  label?: string | ((ctx: ToolbarContext) => string);
  /**
   * 图标：内置名（见 `TOOLBAR_ICONS`）或一段 SVG 字符串。
   * 内置名先查表，查不到就当 SVG 原样注入 —— 这样"用现成图标"和"带自己的图标"是同一个字段。
   */
  icon?: string;
  /** 悬停提示（没给就用 `label`）。 */
  title?: string;
  /** 点了做什么。`ctx` 是读写图表状态的正规入口，**不要直接摸 DOM**。 */
  onClick?: (ctx: ToolbarContext) => void;
  /**
   * 自定义面板：给就拿它当这个项的下拉内容（容器、定位、主题、点外部关闭都由库负责），
   * **每次打开时调用**，所以应用可以按当前状态现建 —— 参数输入框、语言/主题这类
   * 「要放控件、不是简单开关」的项就走这条，不必自己搭一个浮层。
   *
   * 给了 `menu` 就不再触发 `onClick`（触发器只负责开关面板）。
   */
  menu?: (ctx: ToolbarContext) => HTMLElement;
  /** 是否高亮/带角标（例如"有未读预警"）。每次 `update()` 会重算。 */
  active?: (ctx: ToolbarContext) => boolean;
}

export type ToolbarItemSpec = ToolbarItemName | ToolbarCustomItem;

/** 指标面板里的一项（勾选式）。 */
export interface ToolbarIndicator {
  id: string;
  label: string;
  on?: boolean;
}

/**
 * 工具条与图表之间的**正规入口**：由图表（或应用）注入。
 *
 * 为什么不让工具条直接吃图表实例：`ice-chart` / `ice-trading-chart` 的实例形状会演进，
 * 而这层接口是我们**承诺给使用方**的东西（第 2 层自定义项拿到的就是它）——
 * 把它钉住，两边各自演进都不会互相拽着。
 */
export interface ToolbarHost {
  /** 当前周期（读）。 */
  interval?: () => string | undefined;
  /** 请求切周期（写意图）。库不碰数据源 —— 重订阅是应用的事。 */
  onIntervalChange?: (interval: string, ctx: ToolbarContext) => void;
  /** 当前图表类型（读）。 */
  chartType?: () => string | undefined;
  /** 请求换图表类型。 */
  onChartTypeChange?: (type: string, ctx: ToolbarContext) => void;
  /** 指标清单 + 开关状态（读）。 */
  indicators?: () => ToolbarIndicator[];
  /** 请求开关指标。 */
  onToggleIndicator?: (id: string, next: boolean, ctx: ToolbarContext) => void;
  /** 画线工具：当前工具（读）与切换（写）。 */
  drawingTool?: () => string | undefined;
  onDrawingToolChange?: (tool: string, ctx: ToolbarContext) => void;
  /** 「显示」菜单里的开关（对数刻度 / 百分比 / 水印…）由应用给，库不认识它们。 */
  displayItems?: () => { id: string; label: string; on: boolean }[];
  onToggleDisplay?: (id: string, next: boolean, ctx: ToolbarContext) => void;
  /** 图表实例：给自定义项留的逃生口（`toggleSeries` / `setDomain…` 都是它的公开 API）。 */
  chart?: unknown;
  /** 副图栈（多 pane 场景）。 */
  stack?: unknown;
}

export interface ToolbarOptions {
  /** 默认 true。`false` 时本组件不渲染任何东西（应用自绘）。 */
  show?: boolean;
  /** 显示哪些项、按什么顺序；不在数组里的内置项不显示。默认见 `DEFAULT_ITEMS`。 */
  items?: ToolbarItemSpec[];
  /** 周期按钮的候选（默认 1m/5m/15m/1H/4H/1D，与币安同序）。 */
  intervals?: string[];
  /** 图表类型的候选。 */
  chartTypes?: { id: string; label: string }[];
  /** 第 3 层：整条替换。返回的元素由**调用方**放进图表给的槽位。 */
  render?: (ctx: ToolbarContext) => { element: HTMLElement; update?: (ctx: ToolbarContext) => void };
  host?: ToolbarHost;
  messages?: Partial<TerminalMessages> | 'zh' | 'en';
  theme?: Partial<TerminalTheme>;
}

export interface ChartToolbar {
  /** 根元素（`show:false` 或整条替换时可能为 null，此时用替换层的 element）。 */
  readonly element: HTMLElement | null;
  /** 按当前状态刷新（激活态 / 角标 / 周期文字）。**不重建结构**。 */
  update(): void;
  /** 换配置（`items` 变了才重建按钮）。 */
  setOptions(next: Partial<ToolbarOptions>): void;
  destroy(): void;
}

const STYLE_ID = 'ice-trading-toolbar-style';

const STYLE = `
.ice-toolbar {
  display: flex; align-items: center; gap: 2px; padding: 2px 6px;
  font: 11px/1.6 var(--ice-toolbar-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  color: var(--ice-toolbar-muted, rgba(132, 142, 156, 0.9));
  border-bottom: 1px solid var(--ice-toolbar-line-soft, rgba(255, 255, 255, 0.06));
  user-select: none;
}
.ice-toolbar-item { position: relative; display: inline-flex; align-items: center; }
.ice-toolbar-btn {
  display: inline-flex; align-items: center; gap: 3px; background: none; border: 0; cursor: pointer;
  color: inherit; font: inherit; padding: 2px 5px; border-radius: 3px;
}
.ice-toolbar-btn:hover { background: var(--ice-toolbar-hover, rgba(255, 255, 255, 0.05)); }
.ice-toolbar-btn.on { color: var(--ice-toolbar-text, #eaecef); }
.ice-toolbar-btn svg { width: 13px; height: 13px; display: block; }
.ice-toolbar-sep { width: 1px; height: 12px; margin: 0 4px; background: var(--ice-toolbar-line, rgba(255, 255, 255, 0.08)); }
.ice-toolbar-panel {
  position: absolute; left: 0; top: calc(100% + 4px); z-index: 20; min-width: 92px;
  background: var(--ice-toolbar-panel, #161a1e); border: 1px solid var(--ice-toolbar-line, rgba(255, 255, 255, 0.1));
  border-radius: 4px; padding: 4px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
}
.ice-toolbar-panel[hidden] { display: none; }
.ice-toolbar-opt {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%;
  background: none; border: 0; cursor: pointer; color: inherit; font: inherit; text-align: left;
  padding: 3px 6px; border-radius: 3px;
}
.ice-toolbar-opt:hover { background: var(--ice-toolbar-hover, rgba(255, 255, 255, 0.05)); }
.ice-toolbar-opt.on { color: var(--ice-toolbar-accent, #f0b90b); }
.ice-toolbar-opt .tick { opacity: 0; }
.ice-toolbar-opt.on .tick { opacity: 1; }
`;

/** 内置图标（细线风格，与示例页那条自绘工具条同一观感）。 */
export const TOOLBAR_ICONS: Record<string, string> = {
  candles:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M5 2.4v11.2M11 3.4v9.2" stroke-linecap="round"/><rect x="3.3" y="5" width="3.4" height="6" rx="0.4" fill="currentColor" stroke="none"/><rect x="9.3" y="5.8" width="3.4" height="4.4" rx="0.4" fill="currentColor" stroke="none"/></svg>',
  clock:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.4V8l2.6 1.6" stroke-linecap="round"/></svg>',
  indicators:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3.2 12.4V8.6M8 12.4V3.6M12.8 12.4v-5.2"/></svg>',
  drawing:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M3.4 12.6l1-2.8 5-5 1.8 1.8-5 5z"/><path d="M10.4 3.8l1.8 1.8"/></svg>',
  display:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2.6 8s2-4.2 5.4-4.2S13.4 8 13.4 8s-2 4.2-5.4 4.2S2.6 8 2.6 8z"/><circle cx="8" cy="8" r="1.7"/></svg>',
};

const DEFAULT_ITEMS: ToolbarItemName[] = ['intervals', 'type', 'indicators', 'drawings', 'display'];
const DEFAULT_INTERVALS = ['1m', '5m', '15m', '1H', '4H', '1D'];

function ensureStyle(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

function iconMarkup(icon?: string): string {
  if (!icon) return '';
  return TOOLBAR_ICONS[icon] || icon;
}

/**
 * 自定义项按钮上的文字：固定串或 `(ctx) => string` 都收。
 *
 * 为什么要有函数这一档：内置项的「当前值」（周期的 `5m`）是库自己读 host 得来的，
 * 而自定义项如果把周期面板整个接过去（收藏 / 自定义周期那种），就同样需要「按钮上的字
 * 跟着状态走」—— 否则会出现「图上 1H、按钮上 5m」。函数在读的时候求值，天然不会存状态。
 */
function customCaption(spec: ToolbarCustomItem, ctx: ToolbarContext): string {
  const label = spec.label;
  if (typeof label === 'function') {
    const text = label(ctx);
    return text === null || text === undefined ? '' : String(text);
  }
  return label || '';
}

/** 一个内置项的渲染结果：触发器 + 可选面板。 */
interface BuiltItem {
  id: string;
  root: HTMLElement;
  button: HTMLButtonElement;
  panel: HTMLElement | null;
  spec: ToolbarItemSpec;
}

/**
 * 建一条工具条。
 *
 * ```ts
 * const toolbar = createChartToolbar({
 *   items: ['intervals', { id: 'alerts', label: '预警', onClick: (ctx) => … }, 'display'],
 *   host: { interval: () => '5m', onIntervalChange: (next) => resubscribe(next) },
 * });
 * panel.append(toolbar.element);
 * ```
 */
export function createChartToolbar(options: ToolbarOptions = {}): ChartToolbar {
  let opts: ToolbarOptions = { ...options };
  /** 刷新实现（第 3 层整条替换时不存在，用空实现兜住 —— 否则 `ctx.refresh` 会踩 TDZ）。 */
  let refreshImpl: () => void = () => undefined;
  const messages = () => resolveTerminalMessages(opts.messages);
  const theme = () => resolveTerminalTheme(opts.theme);

  const external = opts.render ? opts.render(context()) : null;
  if (opts.show === false || external) {
    return {
      element: external ? external.element : null,
      update: () => external && external.update && external.update(context()),
      setOptions: () => undefined,
      destroy: () => {
        const el = external && external.element;
        if (el && el.parentNode) el.parentNode.removeChild(el);
      },
    };
  }

  ensureStyle();
  const root = document.createElement('div');
  root.className = 'ice-toolbar';
  const itemsHost = document.createElement('div');
  itemsHost.style.display = 'contents';
  root.appendChild(itemsHost);

  let items: BuiltItem[] = [];
  let openPanelId: string | null = null;
  let signature = '';
  let themeSignature = '';

  /**
   * 主题 → 根节点上的 `--ice-toolbar-*` 变量（与 `orderBook` 同一套姿势：结构只建一次、
   * 颜色走变量）。换肤只要重写这几个变量，不必重建 DOM —— 也不必让使用方自己写色值。
   *
   * 按签名去重：每帧推数据都会 `update()`，没换主题时一次 DOM 都不写。
   */
  const paintTheme = () => {
    const tokens = theme();
    const next = `${tokens.text}|${tokens.muted}|${tokens.line}|${tokens.lineSoft}|${tokens.panel2}|${tokens.accent}|${tokens.monoFamily}`;
    if (next === themeSignature) return;
    themeSignature = next;
    const vars: Record<string, string> = {
      '--ice-toolbar-text': tokens.text,
      '--ice-toolbar-muted': tokens.muted,
      '--ice-toolbar-line': tokens.line,
      '--ice-toolbar-line-soft': tokens.lineSoft,
      '--ice-toolbar-hover': tokens.panel2,
      '--ice-toolbar-panel': tokens.panel2,
      '--ice-toolbar-accent': tokens.accent,
      '--ice-toolbar-mono': tokens.monoFamily,
    };
    for (const key of Object.keys(vars)) root.style.setProperty(key, vars[key]);
  };

  function context(): ToolbarContext {
    return {
      chart: opts.host && opts.host.chart,
      stack: opts.host && opts.host.stack,
      messages: messages(),
      theme: theme(),
      refresh: () => refreshImpl(),
      closeMenu: () => closePanels(),
    };
  }

  const closePanels = () => {
    openPanelId = null;
    for (const item of items) if (item.panel) item.panel.hidden = true;
  };

  const togglePanel = (id: string, open: boolean) => {
    openPanelId = open ? id : null;
    for (const item of items) if (item.panel) item.panel.hidden = item.id !== openPanelId;
  };

  /** 面板内容：内置项自己填，自定义项没有面板。 */
  const fillPanel = (item: BuiltItem) => {
    if (!item.panel) return;
    if (item.id === 'intervals') {
      const list = opts.intervals || DEFAULT_INTERVALS;
      const current = opts.host && opts.host.interval ? opts.host.interval() : '';
      item.panel.innerHTML = list
        .map(
          (value) =>
            `<button type="button" class="ice-toolbar-opt${value === current ? ' on' : ''}" data-interval="${value}">` +
            `<span>${value}</span><span class="tick">✓</span></button>`
        )
        .join('');
      return;
    }
    if (item.id === 'indicators') {
      const list = (opts.host && opts.host.indicators ? opts.host.indicators() : []) || [];
      item.panel.innerHTML = list.length
        ? list
            .map(
              (one) =>
                `<button type="button" class="ice-toolbar-opt${one.on ? ' on' : ''}" data-indicator="${one.id}">` +
                `<span>${one.label}</span><span class="tick">✓</span></button>`
            )
            .join('')
        : `<span class="ice-toolbar-opt">${messages().toolbar.none}</span>`;
      return;
    }
    if (item.id === 'display') {
      const list = (opts.host && opts.host.displayItems ? opts.host.displayItems() : []) || [];
      item.panel.innerHTML = list
        .map(
          (one) =>
            `<button type="button" class="ice-toolbar-opt${one.on ? ' on' : ''}" data-display="${one.id}">` +
            `<span>${one.label}</span><span class="tick">✓</span></button>`
        )
        .join('');
      return;
    }
    if (item.id === 'drawings') {
      const current = opts.host && opts.host.drawingTool ? opts.host.drawingTool() : '';
      const list = messages().toolbar.drawingTools;
      item.panel.innerHTML = list
        .map(
          (one) =>
            `<button type="button" class="ice-toolbar-opt${one.id === current ? ' on' : ''}" data-drawing="${one.id}">` +
            `<span>${one.label}</span><span class="tick">✓</span></button>`
        )
        .join('');
      return;
    }
    if (item.id === 'type') {
      const current = opts.host && opts.host.chartType ? opts.host.chartType() : '';
      const list = opts.chartTypes || messages().toolbar.chartTypes;
      item.panel.innerHTML = list
        .map(
          (one) =>
            `<button type="button" class="ice-toolbar-opt${one.id === current ? ' on' : ''}" data-type="${one.id}">` +
            `<span>${one.label}</span><span class="tick">✓</span></button>`
        )
        .join('');
    }
  };

  /** 按钮上的"当前值"（只在内置项里用）。 */
  const captionOf = (id: string): string => {
    if (id === 'intervals') return (opts.host && opts.host.interval && opts.host.interval()) || '';
    return '';
  };

  const iconOf = (id: string): string => {
    if (id === 'intervals') return 'clock';
    if (id === 'type') return 'candles';
    if (id === 'indicators') return 'indicators';
    if (id === 'drawings') return 'drawing';
    if (id === 'display') return 'display';
    return '';
  };

  const labelOf = (id: string): string => {
    const dict = messages().toolbar;
    if (id === 'intervals') return dict.intervals;
    if (id === 'type') return dict.type;
    if (id === 'indicators') return dict.indicators;
    if (id === 'drawings') return dict.drawings;
    if (id === 'display') return dict.display;
    return id;
  };

  /** 建按钮（**只在 `items` 变化时**调一次）。 */
  const build = () => {
    // 重建之前先记下开着的是哪一张：应用改 items（例如收藏的周期变了）时，
    // 用户手里开着的那张面板不该凭空消失 —— 下面按同一个 id 重新挂上。
    const wasOpen = openPanelId;
    itemsHost.innerHTML = '';
    items = [];
    openPanelId = null;
    const list: ToolbarItemSpec[] = opts.items && opts.items.length ? opts.items : DEFAULT_ITEMS;
    for (const spec of list) {
      const custom = typeof spec === 'object' && spec ? (spec as ToolbarCustomItem) : null;
      const id = custom ? custom.id : (spec as string);
      const root_ = document.createElement('div');
      root_.className = 'ice-toolbar-item';
      root_.dataset.item = id;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ice-toolbar-btn';
      const built: BuiltItem = { id, root: root_, button, panel: null, spec };
      // 内置项都带下拉面板；自定义项给了 `menu` 也带（容器/定位/关闭时机由库统一负责）
      const isMenu = !custom || !!custom.menu;
      const svg = custom ? custom.icon : iconMarkup(iconOf(id));
      const label = custom ? customCaption(custom, context()) : captionOf(id);
      button.innerHTML =
        (svg ? `<span class="ico">${iconMarkup(svg)}</span>` : '') +
        (label ? `<span class="lbl">${label}</span>` : '');
      button.title = custom ? custom.title || label || id : labelOf(id);
      button.setAttribute('aria-label', button.title);
      if (isMenu) {
        const panel = document.createElement('div');
        panel.className = 'ice-toolbar-panel';
        panel.hidden = true;
        built.panel = panel;
      }
      button.addEventListener('click', (evt) => {
        evt.stopPropagation();
        if (custom) {
          if (custom.menu) {
            const next = openPanelId !== id;
            if (next && built.panel) {
              const content = custom.menu(context());
              built.panel.innerHTML = '';
              if (content) built.panel.appendChild(content);
            }
            togglePanel(id, next);
            return;
          }
          if (custom.onClick) custom.onClick(context());
          return;
        }
        const next = openPanelId !== id;
        fillPanel(built);
        togglePanel(id, next);
      });
      if (built.panel) {
        built.panel.addEventListener('click', (evt) => {
          // 面板内的点击**不冒泡到 document**：文档那层监听是「点空白处收起」，
          // 不拦住的话勾一个指标就把面板关了（多选要能连着勾几个）。
          evt.stopPropagation();
          const target = evt.target as HTMLElement;
          const pick = (attr: string) => {
            const node = target.closest ? (target.closest(`[${attr}]`) as HTMLElement | null) : null;
            return node ? node.getAttribute(attr) : null;
          };
          const interval = pick('data-interval');
          if (interval && opts.host && opts.host.onIntervalChange) {
            opts.host.onIntervalChange(interval, context());
            togglePanel(id, false);
            refresh();
            return;
          }
          const indicator = pick('data-indicator');
          if (indicator && opts.host && opts.host.onToggleIndicator) {
            const list2 = (opts.host.indicators ? opts.host.indicators() : []) || [];
            const now = list2.some((one) => one.id === indicator && one.on);
            opts.host.onToggleIndicator(indicator, !now, context());
            fillPanel(built);
            refresh();
            return;
          }
          const display = pick('data-display');
          if (display && opts.host && opts.host.onToggleDisplay) {
            const list3 = (opts.host.displayItems ? opts.host.displayItems() : []) || [];
            const now = list3.some((one) => one.id === display && one.on);
            opts.host.onToggleDisplay(display, !now, context());
            fillPanel(built);
            refresh();
            return;
          }
          const drawing = pick('data-drawing');
          if (drawing && opts.host && opts.host.onDrawingToolChange) {
            opts.host.onDrawingToolChange(drawing, context());
            togglePanel(id, false);
            refresh();
            return;
          }
          const type = pick('data-type');
          if (type && opts.host && opts.host.onChartTypeChange) {
            opts.host.onChartTypeChange(type, context());
            togglePanel(id, false);
            refresh();
          }
        });
      }
      root_.appendChild(button);
      if (built.panel) root_.appendChild(built.panel);
      itemsHost.appendChild(root_);
      items.push(built);
    }
    if (wasOpen) {
      const again = items.find((item) => item.id === wasOpen && item.panel);
      if (again) {
        const custom = typeof again.spec === 'object' ? (again.spec as ToolbarCustomItem) : null;
        if (custom && custom.menu) {
          const content = custom.menu(context());
          again.panel!.innerHTML = '';
          if (content) again.panel!.appendChild(content);
        } else {
          fillPanel(again);
        }
        togglePanel(wasOpen, true);
      }
    }
  };

  /** 按签名刷新（**不重建**）：周期文字、激活态、角标。 */
  const refresh = () => {
    paintTheme();
    const ctx = context();
    const captionOfItem = (item: BuiltItem) => {
      const custom = typeof item.spec === 'object' ? (item.spec as ToolbarCustomItem) : null;
      return custom ? customCaption(custom, ctx) : captionOf(item.id);
    };
    /**
     * 悬停提示也是**文字**：换语言时它得跟着变（内置项的文字来自 `messages`）。
     * 自定义项没显式给 `title` 时用当前文字，给了就用它自己的。
     */
    const titleOfItem = (item: BuiltItem, caption: string) => {
      const custom = typeof item.spec === 'object' ? (item.spec as ToolbarCustomItem) : null;
      if (!custom) return labelOf(item.id);
      return custom.title || caption || custom.id;
    };
    const next = items
      .map((item) => {
        const custom = typeof item.spec === 'object' ? (item.spec as ToolbarCustomItem) : null;
        const active = custom && custom.active ? custom.active(ctx) : false;
        const caption = captionOfItem(item);
        return `${item.id}:${active ? 1 : 0}:${caption}:${titleOfItem(item, caption)}`;
      })
      .join('|');
    const changed = next !== signature;
    signature = next;
    if (!changed) return;
    for (const item of items) {
      const custom = typeof item.spec === 'object' ? (item.spec as ToolbarCustomItem) : null;
      const active = custom && custom.active ? custom.active(ctx) : false;
      item.button.classList.toggle('on', !!active);
      const label = captionOfItem(item);
      const title = titleOfItem(item, label);
      const node = item.button.querySelector('.lbl');
      if (node) node.textContent = label;
      else if (label) {
        // 一开始没有文字（例如还没读到周期）、后来有了：补一个 `.lbl`，不重建整个按钮
        const span = document.createElement('span');
        span.className = 'lbl';
        span.textContent = label;
        item.button.appendChild(span);
      }
      if (item.button.title !== title) {
        item.button.title = title;
        item.button.setAttribute('aria-label', item.button.title);
      }
    }
  };

  const onDocClick = () => closePanels();
  /** Esc 收起（与「点空白处收起」同一条约定，见 `plans/chart-toolbar.md`）。 */
  const onDocKey = (evt: KeyboardEvent) => {
    if (evt.key === 'Escape') closePanels();
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onDocKey);
  }

  refreshImpl = refresh;
  build();
  refresh();

  return {
    element: root,
    update: () => refresh(),
    setOptions: (next: Partial<ToolbarOptions>) => {
      const itemsChanged = next.items !== undefined && next.items !== opts.items;
      opts = { ...opts, ...next };
      if (itemsChanged) build();
      signature = '';
      refresh();
    },
    destroy: () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('click', onDocClick);
        document.removeEventListener('keydown', onDocKey);
      }
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

/** 第 2 层自定义项拿到的上下文（见表头说明）。 */
export interface ToolbarContext {
  chart?: unknown;
  stack?: unknown;
  messages: TerminalMessages;
  theme: TerminalTheme;
  /** 状态变了让工具条按签名刷新（自定义项改完自己调一次）。 */
  refresh: () => void;
  /**
   * 收起当前面板（自定义项执行完动作后调它）。
   *
   * 内置项的动作由库自己收起（选周期 / 选画线工具 / 执行操作），而自定义面板的内容归应用 ——
   * 「点完要不要关」只有应用知道（指标多选要连着勾几个，选语言就该关掉），所以给一个显式的口子。
   */
  closeMenu: () => void;
}
