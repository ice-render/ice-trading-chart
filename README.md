# ice-trading-chart · 金融交易图表

![npm](https://img.shields.io/badge/npm-ice--trading--chart-blue)
[![license](https://img.shields.io/npm/l/ice-trading-chart.svg)](./LICENSE)

构建在 [ice-chart](https://github.com/ice-render/ice-chart) 之上的**交易图表库**：K 线、影线命中、
OHLC 提示框、含影线的价格轴量程。

它不是又一个图表库 —— 命中测试、事件派发、缩放平移、跨图联动、序列化全部由
`ice-chart` / `ice-render` 承担；本包只做**交易语义**这一层。

依赖方向是单向的，`ice-chart` 不知道交易这件事存在：

```
ice-trading-chart  →  ice-chart  →  ice-render
```

### 内核版本要求：要求 ≥ 0.30.1，推荐 ≥ 0.30.5

**列存（虚拟）系列、惰性原始点、环形缓冲都是 `ice-chart` 的能力**，本包只做交易语义的装配：

| 档 | 版本 | 为什么 |
|---|---|---|
| **要求** | `@damoqiongqiu/ice-chart` **≥ 0.30.1** | 这是**架构完整**的第一版：列存系列 + 惰性原始点（自定义系列也能开列存）+ 环形缓冲。低于它，K 线会退回「每根一个 `DataPoint`」的老路（10 万根多占 5~6MB）。 |
| **推荐** | **≥ 0.30.5** | 在 0.30.1 之上是**性能与外观**改进：更新流水线的增量（类目域 / 索引表、稠密轴标签、**视窗裁剪下的类目查表**）+ 两处裁剪（高亮环、直角坐标系列）。**不影响正确性**，只是更快、更干净。滚动看盘（轴只显示窗口里那一段）**一定吃 0.30.5**：每 tick 1.6ms → 0.3ms（10 万点实测）。 |

`peerDependencies` 里钉的是**要求**那一档（`^0.30.1`）——不把性能改进塞进下限，避免逼应用为
"零功能收益"升级；npm 默认的 caret 解析本来就会装到最新的 `0.30.x`。

## 快速开始

```bash
npm install ice-trading-chart @damoqiongqiu/ice-chart ice-render
```

```ts
import { createTradingChart } from 'ice-trading-chart';

const chart = createTradingChart('canvas-id', {
  title: { text: '近 5 日行情' },
  xAxis: { type: 'category' },
  yAxis: { name: '价格' },
  series: [
    {
      id: 'k',
      type: 'candlestick',
      name: '日 K',
      data: [
        { x: '周一', o: 100, c: 110, l: 95, h: 115 },
        { x: '周二', o: 110, c: 105, l: 100, h: 118 },
        { x: '周三', o: 105, c: 120, l: 102, h: 125 },
      ],
      candle: { upColor: '#EF4444', downColor: '#10B981' },
    },
  ],
});
```

`createTradingChart` 只是「注册 K 线系列 + 补齐 option + 交给 `createChart`」的薄封装，
返回的是标准的 `ICEChart` 实例 —— `chart.on(…)`、`chart.setData(…)`、`chart.toJSON()`
这些用法与直接使用 `ice-chart` 完全一致。

## 成交量副图

数据项里带上成交量，副图**自动**出现（读不出量就什么都不加，不影响 K 线）：

```ts
createTradingChart('canvas-id', {
  xAxis: { type: 'category' },
  yAxis: { position: 'right' },
  volume: { field: 'v', ratio: 5 },   // 不写也自动；写 false 明确不要
  series: [{ id: 'k', type: 'candlestick', data: [{ x: '09:30', o, c, l, h, v }, …] }],
});
```

做法是把成交量放到**第二个 y 轴**、轴域钉成 `[0, ratio × 最大量]` 且 `show:false`：
`v = 最大量` 正好落在绘图区底部 `1/ratio`，柱子在底部、刻度不占横向空间。
`ratio` 默认 5（20%），柱子按 `close ≥ open` 逐项上色。
柱宽默认**铺满类目带宽**（与蜡烛对齐），要更细传 `barWidth`。

> `nice: false` 是必须的：轴域要是走了「取整到好看刻度」，上界会被抬上去，`1/ratio` 的带宽就不准了。

## 数据契约

每个数据项是一个「四个价」，两种写法都认：

```ts
// 对象（推荐：x 与四个价一目了然，字段名可配）
{ x: '2026-09-21', o: 100, c: 110, l: 95, h: 115 }
{ x: '2026-09-21', open: 100, close: 110, low: 95, high: 115 }

// 数组：顺序固定 [开, 收, 低, 高]
[100, 110, 95, 115]
```

字段名用 `openField` / `closeField` / `lowField` / `highField` 覆盖（例如中文表头
`开 / 收 / 低 / 高`）。数字字符串也当数值读。

读不出的数据项（缺字段、非数值）**不画这根蜡烛**，也不会当成 0 —— 假 K 线比空缺更危险。

## 价格轴量程：为什么本包要自己钉

`ice-chart` 的自动量程只看归一化后的 `y`，而本包默认让 `y` 取收盘价。
如果就这么放着，**影线会被裁掉** —— 最高价与最低价落在绘图区之外。

所以 `createTradingChart` 会按「全量数据的最低价的低点 → 最高价的高点」显式给出
`yAxis.min` / `yAxis.max`（含 6% 留白），影线这才完整。

```ts
// 关掉自动量程（改由你自己按可见窗口做价格轴自适应）
createTradingChart('canvas-id', option, { autoPriceRange: false });
```

> 已知边界：本包按**全量数据**的极值钉量程，缩放时价格轴不自适应。要做「随可见区间自适应」，
> 监听 `zoom:change` / `pan:change`（载荷 `ZoomRange.x` 就是可见窗口），重算
> `computePriceRange` 后再 `setOption`。

## 提示框

默认装一个 OHLC formatter（只返回 `rows`，标题仍由 `ice-chart` 按坐标轴格式化给出），
行名是「开盘 / 收盘 / 最低 / 最高」，可用 `priceLabels` 换：

```ts
createTradingChart('canvas-id', option, { priceLabels: { open: 'O', close: 'C', low: 'L', high: 'H' } });
```

自己写了 `tooltip.formatter` 就不会被覆盖。

## 真副图与指标

ice-chart 没有 pane 概念（只有一个绘图区 + 多个 y 轴），所以真副图用**多个图表实例 + 联动**实现：

```ts
const stack = createPaneStack(document.getElementById('panes')!, [
  { id: 'price', primary: true, weight: 5, option: () => priceOption },
  { id: 'volume', weight: 2, option: () => volumeOption },
  { id: 'macd', weight: 2, option: () => macdOption },
], { height: 520, axisLabelChars: 8, gap: 6 });

stack.refresh({ animate: false, preserveView: true });   // 数据变了就调它
```

三块画布各有一个 `ICEChart`，x 轴类目共享、`linkCharts` 联动 hover / zoom / pan。
**横向对齐是这一层的主要工作**：主图刻度是 `42100.5`、成交量是 `2.4K`，右轴预留宽度天然不同，
绘图区就会左右错位。对策是等宽字体 + 定宽刻度标签（`fixedWidthAxisFormatter`），
由 `createPaneStack` 自动注入。

> ⚠️ 更新必须走 `stack.refresh()`。`setOption` 是**整体替换**，应用层直接拿原始 option 调
> 会把栈注入的主题与定宽标签冲掉，对齐随即失效 —— 这也是 `option` 支持传函数的原因。

指标是纯函数 + option 构造器，都在 `src/indicators.ts`：

```ts
createOverlaySeries(candles, { ma: [7, 25], boll: { period: 20 } });  // 主图叠加
createMacdPaneOption(candles, {});                                    // 副图：柱 + DIF + DEA
createRsiPaneOption(candles, { period: 14 });                         // 副图：RSI + 参考线
sma / ema / stdev / bollinger / macd / rsi                            // 纯数列，预热期是 null
```

## 画线工具

画线是 **SVG 覆盖层**，图形按**数据坐标**存，可序列化存盘：

```ts
const layer = createDrawingLayer(chart);
layer.add({ kind: 'hline', points: [{ x: '10:30', y: 42000 }] });
layer.setMode('trend');        // 之后在图上点两下画一条
const saved = JSON.stringify(layer.dump());
layer.load(JSON.parse(saved)); // 换台机器再 load 回来
```

支持 水平线 / 垂直线 / 趋势线 / 区间矩形；选中后拖锚点（或整条平移）改的都是数据坐标，
缩放平移后按当前比例尺重投影。点已有图形 = 选中它，点空白 = 落点。

> 画线依赖**类目轴**（x 以类目标签存储）。数值/时间轴上请另择方案。

## 盘口组件

盘口（买卖十档）是交易专属 UI，也在这个包里 —— 通用图表库不该认识它：

```ts
const book = createOrderBook(document.getElementById('order-book'), {
  levels: 10,                                   // 每侧档数，默认就是 10
  upColor: '#f04438', downColor: '#12d18d',     // 跟随应用的涨跌色
  onPickPrice: (price, side) => { form.price.value = String(price); },
});
book.update({ asks, bids }, { mid: lastPrice, midColor: upColor });   // 推一次行情
book.setPalette({ upColor, downColor });                              // 换配色
```

- 数据契约：`asks` / `bids` 都是**最优价在前**；卖盘展示时自动倒序（最远价在上、最优价贴着中间价）；
- **结构只建一次**（一档一行），`update()` 只改数值与深度条宽度；数据没变时按签名跳过，一次 DOM 都不写；
- 自带样式（注入一次、id 守卫），页面不用为它写 CSS；
- 中间价那一行给中间价与价差；`midColor` 由调用方给（组件不知道该跟谁比）。

## 图表工具条（三层定制 + 占带）

周期 / 图表类型 / 指标 / 画线 / 显示那条工具条也在库里（**它是图表的一部分**，每个接入方
各画一遍会让图标、主题、文案、状态同步四件事各不相同）。**占带**：交给 pane 栈，pane 高度
从容器高度里扣掉它 —— 不悬浮在画布上（悬浮会盖住最上面那几根 K 线）。

```ts
const toolbar = createChartToolbar({
  host: {
    interval: () => currentInterval,                                  // 读状态
    onIntervalChange: (next) => restartFeed(next),                     // 发意图（库不碰数据源）
    indicators: () => [{ id: 'ma', label: 'MA(7,25)', on: true }],
    onToggleIndicator: (id, on) => setIndicator(id, on),
  },
});

const stack = createPaneStack(host, specs, {
  toolbar: { element: toolbar.element, update: () => toolbar.update() },   // 占带
});
stack.refresh();   // 每次 refresh 顺带调一次 update()：图表状态变了，工具条自己跟上
```

三层定制，按侵入度递增（`items` 的数组顺序就是显示顺序）：

| 层 | 写法 | 给谁用 |
|---|---|---|
| 1 · 声明式 | `items: ['intervals', 'type', 'display']` | 只想少放几项 / 换顺序 |
| 2 · 自定义项 | 同一个数组里混 `{ id, label, icon, onClick(ctx), active(ctx), menu(ctx) }`（`label` 可以是 `(ctx) => string`） | 想加自己的按钮 / 面板 |
| 3 · 整条替换 | `render: (ctx) => ({ element, update })`，或 `show: false` | 想整条自己画（位置仍由图表的占带给） |

一条铁律：**工具条不自己存图状态**。周期、类型、指标显隐的真相永远是图表 option ——
内置项只做「发意图 + 读状态」，所以应用外部改了状态，下一次 `update()` 会自己跟上，
而且**不重建结构**（重建会让使用方手里的节点引用失效）。自定义面板的内容归应用，
「点完要不要关」也归应用（`ctx.closeMenu()`）：指标多选要连着勾几个，选周期 / 选语言就该关掉。

## 实时行情（WebSocket）

行情是**一条会断的长连接 + 好几路 topic**。这一层把「重连、订阅记账、按帧合并、快照对账」
一次做完，应用只给**协议**（订阅报文 / 报文解析）和**画法**：

```ts
import { createRealtimeHub, createCandleTopic, createDepthTopic, createPositionTopic } from 'ice-trading-chart';

const hub = createRealtimeHub({
  clientOptions: {
    url: 'wss://example.com/ws',
    heartbeat: { payload: { op: 'ping' }, intervalMs: 15000 },   // 静默超时默认 intervalMs × 2.5
    reconnect: { minDelayMs: 500, maxDelayMs: 15000, factor: 1.8, jitter: 0.2 },
  },
  topics: [
    createCandleTopic({
      subscribe: (p) => ({ op: 'sub', ch: `kline.${p.interval}`, sym: p.symbol }),
      decode: (m) => (m.ch === 'kline' ? { key: `${m.sym}:${m.interval}`, bar: m.bar, closed: m.closed } : null),
    }),
    createDepthTopic({
      subscribe: (p) => ({ op: 'sub', ch: 'depth', sym: p.symbol }),
      decode: (m) => (m.ch === 'depth' ? { key: m.sym, message: m.data } : null),   // 快照 / 增量都走它
    }),
    createPositionTopic({
      subscribe: () => ({ op: 'sub', ch: 'positions' }),
      decode: (m) => (m.ch === 'positions' ? { key: 'account', positions: m.data } : null),
    }),
  ],
  onData: (changes) => {
    for (const change of changes) {
      // 一帧一次，直接拿「这一帧结束时的状态」，不必自己攒增量
      if (change.topic === 'kline') chart.refresh(change.data.bars());
      if (change.topic === 'depth' && change.kind === 'resync') refetchSnapshot();   // 跳号 → 重取快照
      if (change.topic === 'positions') renderPositions(change.data.list());
    }
  },
});

hub.subscribe('kline', { symbol: 'BTCUSDT', interval: '1m' });
hub.subscribe('depth', { symbol: 'BTCUSDT' });
hub.subscribe('positions', { account: 'main' });
hub.client.connect();

hub.data(hub.keyOf('kline', { symbol: 'BTCUSDT', interval: '1m' })!);   // → CandleStream
```

它替应用兜住的四件事：

- **断线重连**：指数退避 + 抖动；`online` 立刻重连、`offline` 期间不空转；`maxAttempts` 到顶就 `closed`
  并给出原因。传输实现可注入（`createSocket`）—— Node 端换成 `ws`、单测里换成假 socket 都行。
- **重连即重放订阅**：订阅关系记在中枢里，每次连上自动重发，应用一行都不用写。
- **按帧合并**：同一条流一秒推几十上百次，中枢**每帧只叫醒应用一次**（`flush: 'frame'`，也可给毫秒数）。
  ⚠️ 代价是一帧内同一条 key 只有**最后一次**变更会送达：K 线的「收盘 + 起新的一根」会合并成一条
  `append`，要从 `change.data.bars()` 里取最后两根来对齐（只按 `payload.bar` 改会丢掉收盘那根的值）。
- **快照对账**：深度增量带 `seq` / `prevSeq`，**跳号就报 `resync`**，应用据此重取快照 ——
  而不是拿一本错账接着画。写盘口时记住：**只 upsert 不删除会穿价**（陈价攒下来，买一最后高于卖一）。

另外两个小方便：`hub.keyOf(topic, params)` 直接给出 store 的 key（应用不必自己拼字符串）；
订阅没注册的 topic 名会报错，而不是静默失败。

> 想接自己的流（成交明细、资金费率、标记价…）：写一个 `{ name, keyOf, subscribe, decode, apply }`
> 塞进 `topics` 即可 —— 订阅记账、重连重放、按帧合并全是白拿的。示例页的「最新成交」就是这么接的。

## 公开 API

| 导出 | 用途 |
| --- | --- |
| `createTradingChart(target, option, extras?, chartOptions?)` | 建图（注册系列 + 补齐 option）；`extras.pricePrecision` 定报价小数位（价格轴刻度与提示框同口径） |
| `toTradingOption(option, extras?)` | 只做 option 补齐，自己调 `createChart` 时用 |
| `registerTradingSeries()` | 只注册 `candlestick` 系列（幂等） |
| `readOhlc(raw, option?)` / `hasOhlc` | 数据项 → `[开, 收, 低, 高]` |
| `computePriceRange(seriesList, { padding? })` | 含影线的价格轴范围 |
| `computeVolumeRange(values, ratio?)` / `buildVolumeSeries(source, option?)` | 成交量轴域与系列（副图） |
| `createOhlcTooltipFormatter({ labels?, seriesOption?, volumeSeriesId? })` | OHLC（+量）提示框 formatter |
| `createOhlcReadout(chart, { seriesId?, volume? })` | 光标 / 数据 → 一根 K 线的读数（抬头用） |
| `plotRect` / `priceToY` / `yToPrice` / `categoryToX` / `xToCategoryIndex` | 画布内坐标投影（HTML 外壳对齐用） |
| `resetAutoScale(chart)` / `zoomValueAxis(chart, { factor, anchorY })` / `beginValueAxisScale(chart, y)` + `applyValueAxisScale(chart, scale, y)` | 数值轴的视图控制：自适应（清掉手动 y 窗口，**x 窗口不动**）/ 以指针为锚点缩放 / 按下-拖动缩放（快照口径，拖回出发点即原样）。右侧标尺「双击 / 滚轮 / 上下拖」三个手势的落点 |
| `panTimeAxis(chart, { bars? })` / `zoomTimeAxis(chart, { factor, anchorX? })` | 时间轴的视图控制：整窗平移（正数向右，贴边滑）/ 按倍数缩放（锚点占绘图区宽度的比例固定）。键盘 ←→ / `+`-` 的落点，上下限由引擎兜（`minBarSpacing`） |
| `formatPrice(value, precision?)` / `formatVolume` / `formatSigned` / `formatPct` | 数字格式化。`formatPrice` 给了 `precision` 就固定小数位、不去尾随 0（报价口径，`DEFAULT_PRICE_PRECISION = 2`） |
| `CandlestickSeries` / `resolveCandleStyle` / `DEFAULT_UP_COLOR` / `DEFAULT_DOWN_COLOR` | 系列组件与配色 |
| `createPaneStack(container, specs, options)` | 真副图：多实例 + 联动 + 横向对齐；`toolbar`（或运行中的 `setToolbar()`）把一条带插进容器顶部 / 底部并**从容器高度里扣掉它**（工具条占带） |
| `createChartToolbar(options)` | 图表工具条（周期 / 类型 / 指标 / 画线 / 显示）。三层定制：`items` 声明式 → 自定义项 `{ id, label, icon, onClick(ctx), active(ctx), menu(ctx) }` → `render(ctx)` 整条替换；`host` 给「读状态 / 写意图」的正规入口 |
| `axisTickCount(min, max, length, { spacing?, nice? })` | 按「轴长 ÷ 一档的最小像素」反推数值轴给几档刻度（pane 栈自动注入 `tickCount`，默认 5 档会明显偏稀） |
| `createOverlaySeries` / `createMacdPaneOption` / `createRsiPaneOption` | 指标 option 构造 |
| `sma` / `ema` / `stdev` / `bollinger` / `macd` / `rsi` / `macdRange` | 指标纯函数 |
| `createDrawingLayer(chart, options)` | 画线图层（SVG 覆盖层，数据坐标持久化） |
| `createOrderBook(container, options)` | 盘口组件（买卖十档，自带样式与深度条）；`theme` / `setTheme()` 吃终端主题 |
| `createRealtimeClient(options)` | 一条 WS 连接的生命周期：退避重连 + 抖动、心跳 + 静默看门狗、断线排队、`online` / `offline` 联动；传输可注入（`createSocket`） |
| `createRealtimeHub(options)` | 多 topic 中枢：订阅记账（**重连自动重放**）、报文分流、**按帧合并**通知（`flush: 'frame'`）；`subscribe` / `unsubscribe` / `keyOf` / `data` / `keys` / `client` |
| `createCandleTopic` / `createDepthTopic` / `createPositionTopic` | 内置 topic 工厂：应用只给 `subscribe` / `decode`（+ 可选 `unsubscribe` / `limit` / `depth`）。想接别的流就自己写一个 `{ name, keyOf, subscribe, decode, apply }` |
| `createCandleStream(options?)` | K 线流：同一根反复推 = 就地改，换 x = 接新的，更旧的丢弃；`load(bars, { replace })` 用于历史 / 重连回补 |
| `createDepthStore({ depth? })` | 深度存储：快照 + 增量、`prevSeq` / 连续 seq 对账、**跳号报 `resync`**、每侧按档数封顶 |
| `createPositionStore()` | 仓位存储：按 `symbol + 方向` upsert，`size <= 0` 视为平掉 |
| `DARK_TERMINAL_THEME` / `LIGHT_TERMINAL_THEME` / `resolveTerminalTheme()` | 终端主题预设与解析（一套 token 驱动图表 / 盘口 / 页面外壳） |
| `terminalThemeToChartTheme(theme)` | 终端主题 → 图表主题（喂给 `createPaneStack({ theme })`，再经 ice-chart 的桥进引擎主题） |
| `ZH_TERMINAL_MESSAGES` / `EN_TERMINAL_MESSAGES` / `resolveTerminalMessages()` | 文案目录（库渲染的文案：提示框四价、盘口表头、指标序列名） |
| `createIntlNumberFormat(locale)` / `DEFAULT_NUMBER_FORMAT` | 数字格式化：按 locale 的千分位与小数分隔符（`createTradingChart(…, { numberFormat })`） |
| `applyTerminalTheme(theme, root?)` | 主题 → CSS 变量（`TERMINAL_THEME_VARS` 是变量名表），页面外壳只写样式表 |

## 图表外壳：数据由库给，排版由页面画

交易图表上的**最新价线、右侧价签、左上角 OHLC 抬头、十字光标的价格/时间标签**通常由应用
用 DOM 画在画布上方（而不是画进 canvas）。本包因此提供两样东西：

- `createOhlcReadout()` —— 「当前光标那一根」的读数（开高低收 / 量 / 涨跌额 / 涨跌幅）；
- `project.ts` 的投影函数 —— 数据坐标 ↔ 画布 CSS 像素，外壳容器只要与画布左上角对齐就能直接定位。

`examples/candlestick.html` 就是这么做的：引擎画 K 线与成交量，页面画抬头、价签、横线与倒计时，
并且**只在几何签名变化时才写 DOM**（每帧无条件重排会掉帧）。

> 为什么不用引擎自带的十字光标标签：它的 y 标签固定画在绘图区**左**边缘，而交易图表的
> 价格轴在右边；另外它的横向准星只走数据点、不跟指针。所以示例里把 `crosshair.showAxisLabel`
> 关掉，横线与两个标签由页面自己画。

## 示例页

只有**一个**：`examples/terminal.html` —— 完整交易终端屏，把库的能力一次串起来。

```bash
npm run build && npx http-server . -p 8102 -c-1
# 打开 http://localhost:8102/examples/terminal.html
```

工具条的三层定制用**查询参数**切换（不必为此另开示例页）：
`?toolbar=simple`（第 1 层：只减项）/ `custom`（第 2 层：加一个「预警」自定义项）/
`replace`（第 3 层：整条替换，位置仍由图表给）/ `none`（完全不要）。

页面里有什么：

| 区域 | 用到的能力 |
| --- | --- |
| 顶部行情条 | 最新价 / 涨跌幅 / 高低 / 量 / 资金费率结算倒计时 / 周期切换（1m~1D）/ 涨跌配色切换 |
| 中间图表 | `createPaneStack` 三块真副图（价格 / 成交量 / MACD 或 RSI）、`createOverlaySeries` 均线、`createDrawingLayer` 画线、`createOhlcReadout` 抬头、`project.ts` 投影（最新价线 / 右轴价签 / 十字光标两侧标签） |
| 拖动平移 | K 线区域可拖动（**横纵都能拖**，纵向拖即手动量程）；绘图区内光标是「可抓」的小手、拖动中变「抓住」；用户拖过之后**图表不再自动向右延伸**，并亮出「回到最新」；往左是**无限画布**（按需补历史，内存里的历史与交给图表的渲染窗口分开，开销恒定） |
| 标尺手势 | 右侧**数值标尺**：**按住上下拖** = 缩放该 pane 的数值轴（向上拖 = 放大，拖回出发点即原样）、**滚轮** = 微调同一个量程（指针指着的价格停在原地）、**双击** = 量程退回自适应（纵向拖过头之后 K 线被挤出绘图区，双击立刻重新铺满、**x 窗口一根不动**）；底部**时间轴双击** = 重置时间轴（默认根数 + 回到最新）。刻度精度跟着窗口走（窗口越细步长越小、步长掉到 1 以下就多带小数位）。三块 pane 各认自己的标尺；只动数值轴**不算**动过时间窗口，跟盘不受影响 |
| 十字准星 | 两条线都由页面画、**自由跟随指针**（竖线贯穿整摞 pane，是一把时间标尺）；横线只画在**指针所在的那一块**里、读数按那一块的量纲（成交量 pane 上读到的是成交量）；右轴价签 + 底部时间签；抬头实时跟随 |
| 图表外壳的两条边界 | 最新价被推出视野时：虚线不画、价签钉在价格轴的上/下沿（不会压到下面的副图上）；指针停在标尺上时不出准星横线（横线的读数只属于绘图区） |
| 盘面布局 | 顶部：行情跑马灯 + 交易对抬头（标记价 / 指数价 / 资金费率与倒计时 / 24h 高·低·量·额）；三栏：**图表 ·（订单簿 + 最新成交）·（下单 + 账户）**；底部：持仓 / 当前委托 / 画线记录三个**选项卡**，横跨图表与盘口两栏 |
| i18n | 「显示」面板里可切**中文 / English**：库渲染的文案走 `TerminalMessages`（盘口表头、抬头行名、指标序列名），页面自己的文案走 `PAGE_MESSAGES` + `data-i18n` / `t()`；数字格式可换成 `Intl.NumberFormat`（`createIntlNumberFormat('de-DE')`） |
| 主题 | 「显示」面板里可切**深色 / 浅色盘面**：一套 `TerminalTheme` token 同时驱动图表（经 ice-chart 主题桥进 ice-render 引擎主题）、盘口、页面外壳 CSS 变量 |
| 盘面配色 | 深色盘面一套变量（底 `#0b0e11`、面板 `#181a20`、边框 `#2b3139`、强调 `#f0b90b`、涨 `#0ecb81`、跌 `#f6465d`），默认**涨绿跌红**；报价千分位 + 两位小数 |
| 盘口 | 表头（价格 / 数量 / 合计）+ 合计列 + 深度条；**卖盘用跌色、买盘用涨色**；中间价一行放大显示最新价与价差；下面接「最新成交」列表（价格 / 数量 / 时间） |
| 下单面板 | 全仓 / 逐仓 / 杠杆胶囊 + 限价 / 市价选项卡 + 委托价格（USDT，带「最优价」）+ 数量（SYN）+ **按可用保证金百分比的菱形滑杆** + 杠杆滑杆 + 止盈止损 / 只减仓 + 买入做多 / 卖出做空 |
| 账户面板 | 保证金比率 / 维持保证金 / 保证金余额（跟着持仓与杠杆走）+ 划转 / 买币 / 兑换 |
| 图表类型 | 蜡烛 / 空心蜡烛 / 折线 / 面积（`renderAs`：只换渲染，影线量程、成交量、抬头与提示框照旧按 K 线算） |
| 价格轴右键菜单 | 在右侧标尺上右键：自动量程 / 线性坐标 / 对数坐标 / 百分比坐标（百分比以可见窗口第一根为基准，只改标签口径） |
| 指标参数 | 「指标」面板里可直接改 MACD 12/26/9、RSI 14、MA(7,25)、EMA(12,26)、BOLL(20)；改完副图、图例、抬头立刻跟着走 |
| 左边缘图标条 | 画线工具（趋势线 / 水平线 / 垂直线 / 区间矩形 + 删除选中 / 清空）竖排在图表左边缘，选中态高亮，Esc 退出 |
| 十字光标 / 成交量 / 时间轴 | 显示面板里三个开关：磁吸最近的开高低收、均量线 MA5/MA10、跨天的会话分隔线 |
| 图表顶部工具条 | **库组件**（`createChartToolbar`，占带在图表顶部）：常显的收藏周期（一键切换）+ **图标按钮**（时钟 = 周期、蜡烛 = 图表类型、柱状 = 指标、铅笔 = 画线、滑杆 = 显示；带悬停提示与「有内容」状态点）打开五组下拉：**周期**（分组列表 / 星标收藏 / 自定义周期）、**指标**（主图叠加多选 + 副图单选 + 参数）、**画线**（工具 + 删除 / 清空）、**显示**（语言 / 盘面 / 涨跌配色 / 三个开关）。三层定制：`items` / 自定义项 / `render` 整条替换 |
| 图表右侧盘口 | `createOrderBook` 组件（每侧 10 档、深度条、点价填单） |
| 数值轴刻度密度 | 价格轴默认就有 8~13 档（一档 17~47px），不再是引擎默认的 5 档 / 57~71px；密度按「轴长 ÷ 一档的最小像素」反推，缩放 / 平移 / 手动量程都会跟着重算，三块 pane 各自按自己的轴长给档数 |
| 报价精度 | 刻度、最新价签、准星价签、抬头 OHLC 四处统一两位小数（`extras.pricePrecision = 2`）：`41800.00` 而不是 `41800`；刻度标签补位预算（`axisLabelChars`）跟着加宽到 9 字符，三块 pane 仍然等宽 |
| 背景方格 | 三块 pane 都开 `grid: { x: true }`：竖线跟**时间标签同一批位置**（引擎的 x 轴抽稀表），三块 pane 的竖线与横向刻度交叉成方格；上面两块藏掉 x 轴也不影响网格 |
| 每块 pane 一行图例 | 主图左上角「SYN/USDT · 周期 + 开高低收量 + 涨跌」、成交量「Vol + 当前量」、副图「MACD 12 26 9 + DIF/DEA/柱值」（值随涨跌上色）；没有悬停时读**最后一根真实 K**。主图中央还有一枚淡水印 |
| 键盘 | `←` / `→` 平移时间轴、`↑` / `↓` 缩放价格轴、`+` / `-` 缩放时间轴、`Home` 回到最新；与鼠标手势共用同一套夹取与「跟盘 → 手动」状态机（引擎自带的键盘导航在示例里关掉） |
| 右上工具栏 | 暂停 / 继续（停行情推流）、重置（重新采样） |
| 右侧下单面板 | 限价 / 市价、全仓 / 逐仓、杠杆滑块、止盈止损、只减仓 |
| 底部三块 | 持仓表（未实现盈亏 / 保证金 / 强平价随现价动）、委托表（可撤单）、画线记录（数据坐标 JSON） |
| 实时行情链路 | 页面自己扮一个 **WebSocket 形状的网关**（`createMarketSocket()`），走的是库里的 `createRealtimeClient` + `createRealtimeHub`：**四条 topic**（K 线 / 深度 / 仓位 / 成交，最后一条是页面自己写的自定义 topic）。订阅 / 按帧合并 / 断线退避重连 / 重连重放订阅 / 深度序列号对账全是真跑的 —— 脚注最右那一格是链路状态（`● 行情 已连接`），**点一下它就模拟断线**，可以看客户端自己重连；盘口偶尔故意丢一个序列号，对账计数（`⟳n`）会 +1 |

布局（左到右）：**图表 · 盘口 · 下单**，下方是持仓 / 委托 / 画线记录。

真交互：点盘口价格填单、限价挂单、市价立即成交、现价穿过限价单自动撮合、拖杠杆重算保证金与强平价、
滚轮缩放任一 pane 其余跟着走。

## 开发

```bash
npm run build && npm run verify   # types:check → build → jest
npm run test:e2e                 # playwright（端口 8102）
npm run verify:full              # verify + e2e
```

示例页在 `examples/`，e2e 会目录驱动地逐页冒烟。**示例加载的是 `dist/`，所以改了 `src`
必须先 `npm run build` 再用浏览器验证**（jest 走 `src`，会掩盖这一点）。
上游联调：把 `devDependencies` 里的 `@damoqiongqiu/ice-chart` 换成 `file:../ice-chart`。

## 许可

MIT
