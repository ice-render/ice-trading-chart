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

## 公开 API

| 导出 | 用途 |
| --- | --- |
| `createTradingChart(target, option, extras?, chartOptions?)` | 建图（注册系列 + 补齐 option） |
| `toTradingOption(option, extras?)` | 只做 option 补齐，自己调 `createChart` 时用 |
| `registerTradingSeries()` | 只注册 `candlestick` 系列（幂等） |
| `readOhlc(raw, option?)` / `hasOhlc` | 数据项 → `[开, 收, 低, 高]` |
| `computePriceRange(seriesList, { padding? })` | 含影线的价格轴范围 |
| `computeVolumeRange(values, ratio?)` / `buildVolumeSeries(source, option?)` | 成交量轴域与系列（副图） |
| `createOhlcTooltipFormatter({ labels?, seriesOption?, volumeSeriesId? })` | OHLC（+量）提示框 formatter |
| `createOhlcReadout(chart, { seriesId?, volume? })` | 光标 / 数据 → 一根 K 线的读数（抬头用） |
| `plotRect` / `priceToY` / `yToPrice` / `categoryToX` / `xToCategoryIndex` | 画布内坐标投影（HTML 外壳对齐用） |
| `formatPrice` / `formatVolume` / `formatSigned` / `formatPct` | 数字格式化 |
| `CandlestickSeries` / `resolveCandleStyle` / `DEFAULT_UP_COLOR` / `DEFAULT_DOWN_COLOR` | 系列组件与配色 |
| `createPaneStack(container, specs, options)` | 真副图：多实例 + 联动 + 横向对齐 |
| `createOverlaySeries` / `createMacdPaneOption` / `createRsiPaneOption` | 指标 option 构造 |
| `sma` / `ema` / `stdev` / `bollinger` / `macd` / `rsi` / `macdRange` | 指标纯函数 |
| `createDrawingLayer(chart, options)` | 画线图层（SVG 覆盖层，数据坐标持久化） |
| `createOrderBook(container, options)` | 盘口组件（买卖十档，自带样式与深度条） |

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

页面里有什么：

| 区域 | 用到的能力 |
| --- | --- |
| 顶部行情条 | 最新价 / 涨跌幅 / 高低 / 量 / 资金费率结算倒计时 / 周期切换（1m~1D）/ 涨跌配色切换 |
| 中间图表 | `createPaneStack` 三块真副图（价格 / 成交量 / MACD 或 RSI）、`createOverlaySeries` 均线、`createDrawingLayer` 画线、`createOhlcReadout` 抬头、`project.ts` 投影（最新价线 / 右轴价签 / 十字光标两侧标签） |
| 拖动平移 | K 线区域可拖动（**横纵都能拖**，纵向拖即手动量程）；绘图区内光标是「可抓」的小手、拖动中变「抓住」；用户拖过之后**图表不再自动向右延伸**，并亮出「回到最新」；往左是**无限画布**（按需补历史，内存里的历史与交给图表的渲染窗口分开，开销恒定） |
| 十字准星 | 两条线都由页面画、**自由跟随指针**（竖线贯穿整摞 pane，是一把时间标尺）；横线只画在**指针所在的那一块**里、读数按那一块的量纲（成交量 pane 上读到的是成交量）；右轴价签 + 底部时间签；抬头实时跟随 |
| 图表顶部工具条 | 常显的收藏周期（一键切换）+ 四组下拉：**周期**（分组列表 / 星标收藏 / 自定义周期）、**指标**（主图叠加多选 + 副图单选）、**画线**、**显示**（涨跌配色 / 阳线空心） |
| 图表右侧盘口 | `createOrderBook` 组件（每侧 10 档、深度条、点价填单） |
| 右上工具栏 | 暂停 / 继续（停行情推流）、重置（重新采样） |
| 右侧下单面板 | 限价 / 市价、全仓 / 逐仓、杠杆滑块、止盈止损、只减仓 |
| 底部三块 | 持仓表（未实现盈亏 / 保证金 / 强平价随现价动）、委托表（可撤单）、画线记录（数据坐标 JSON） |

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
