# Changelog

## Unreleased

> 下一个版本发布前，改动在这里累积。

## 0.1.0 - 2026-09-21

首版。交易能力从 `ice-chart` 整体迁出到本包，`ice-chart` 从此不承载金融交易图表。

### 变更

- **K 线（`type: 'candlestick'`）**：作为 ice-chart 的**自定义系列**接入
  （`registerSeriesType`），命中判定 / 悬停高亮 / 提示框 / 图例 / 序列化全部沿用
  ice-chart 既有链路。类型名沿用 ice-chart 0.28 之前的内置名，用户 option 不用改。
- **数据契约**：数据项是 `{ x, o, c, l, h }`（也认 `[开, 收, 低, 高]` 数组、
  也认 `open/close/low/high` 长名）。字段名可用 `openField` / `closeField` /
  `lowField` / `highField` 覆盖。读不出的数据项不画，不补 0。
- **含影线的价格轴量程**：`computePriceRange` 按全量数据的最低价的低点 → 最高价的高点
  算出范围（默认 6% 留白），通过公开的 `yAxis.min` / `yAxis.max` 落下去 ——
  否则 ice-chart 的自动量程只看收盘价，影线会被裁。
  可用 `{ autoPriceRange: false }` 关掉。
- **OHLC 提示框**：`createOhlcTooltipFormatter` 走公开的 `tooltip.formatter`，
  行名「开盘 / 收盘 / 最低 / 最高」可用 `{ priceLabels }` 换；只返回 `rows`，
  标题仍由 ice-chart 按坐标轴格式化给出。
- **时间轴**：默认 `xAxis: { type: 'category' }` —— 等宽 K 线、跳过非交易时段。
- 公开 API：`createTradingChart` / `toTradingOption` / `registerTradingSeries` /
  `readOhlc` / `hasOhlc` / `computePriceRange` / `createOhlcTooltipFormatter` /
  `CandlestickSeries`。
- **成交量副图**：数据项带 `v` 就自动加一个绑到第二 y 轴的 `bar` 系列，轴域钉成
  `[0, ratio × 最大量]` 且 `show:false`，柱子落在绘图区底部 `1/ratio`（默认 20%）。
  可配 `volume: { field, ratio, upColor, downColor, axisIndex, barWidth }`，`volume: false` 关闭。
  柱子按 `close ≥ open` 逐项上色。
- **图表外壳的数据侧**：`createOhlcReadout()` 给出「当前光标那一根」的读数
  （开高低收 / 量 / 涨跌额 / 涨跌幅 / 涨跌方向），供页面画抬头。
- **画布内坐标投影**：`plotRect` / `priceToY` / `yToPrice` / `categoryToX` / `xToCategoryIndex`，
  让页面用 HTML 画的外壳（价签、横线、标签）能与图表精确对齐。
- **格式化**：`formatPrice` / `formatVolume` / `formatSigned` / `formatPct`。
- 提示框默认触发器改为 `axis`（整列读数）—— 与引擎默认一致，抬头跟随十字光标靠它；
  行名与顺序统一为 开 / 高 / 低 / 收（+ 量），量按成交量格式化而不是价格格式化。
- **真副图（pane 栈）**：`createPaneStack` 把容器切成纵向堆叠的多块画布，每块一个 `ICEChart`，
  x 轴类目共享、`linkCharts` 联动 hover / zoom / pan。横向对齐由「等宽字体 + 定宽刻度标签」
  保证（`fixedWidthAxisFormatter`）；更新走 `stack.refresh()`，由栈负责重新注入对齐信息。
- **技术指标**：纯函数 `sma` / `ema` / `stdev` / `bollinger` / `macd` / `rsi`（预热期为 `null`，
  长度与输入一致），以及 `createOverlaySeries`（主图叠加 MA / EMA / BOLL）、
  `createMacdPaneOption`（柱 + DIF + DEA）、`createRsiPaneOption`（RSI + 参考线）、`macdRange`。
  派生系列数据带 `x`，且默认裁掉首尾 `null` —— 引擎会把 null 点当成 0 画出一条竖直假线。
- **画线工具**：`createDrawingLayer` 用 SVG 覆盖层实现水平线 / 垂直线 / 趋势线 / 区间矩形，
  支持选中、拖锚点、整条平移、删除，按**数据坐标**序列化（`dump()` / `load()`），
  缩放平移后按当前比例尺重投影。
- **坐标投影补强**：`xToCategoryIndex` 改用 `scale.invert`（命中不到取最近类目）——
  类目带之间有 20% 空隙，`indexAt` 落在空隙里返回 -1。
- **默认按设备像素比渲染**：引擎的 `dpr` 默认是 1 且不会自己读 `window.devicePixelRatio`，
  不传的话高分屏上整张图是糊的（1x 位图被浏览器放大）。`createTradingChart` /
  `createPaneStack` 现在默认取环境 dpr（上限 3），显式传 `dpr: 1` 可退回旧行为。
- **蜡烛画法重做**（用户反馈「画得很难看」）：
  - 实体改为**纯填充、不描边** —— 同色描边会向外各撑半条线，相邻蜡烛几乎贴在一起；
  - 去掉阳线的半透明（原本 0.55），半透明会让均线从蜡烛里透出来，很脏；
  - 影线改为**实体上下两段**并平头端对，不再从实体中间穿过（空心阳线时那条竖线尤其明显）；
  - 实体边缘与影线对齐设备像素：不传 dpr 时模糊，传了 dpr 又会有 1/3 像素的细线，
    所以线宽统一改按 CSS 像素语义（`cssUnit() = unit() * dpr`）；
  - 新增 `candle.hollowUp`（阳线空心，国内传统画法），示例里给了开关。
- 示例：**只保留一个综合示例** `examples/terminal.html`（完整交易终端屏）——
  行情条（含周期切换 1m~1D、涨跌配色切换）＋ 盘口十档（深度渐变、点价填单）＋ 三 pane 真副图
  （价格 / 成交量 / MACD 或 RSI，严格对齐 + 联动）＋ 均线开关 ＋ 画线工具（水平线 / 垂直线 /
  趋势线 / 区间，可拖可删、数据坐标可导出）＋ 最新价线 / 右轴价签 / OHLC 抬头 / 十字光标两侧
  标签 ＋ 下单面板（限价·市价 / 全仓·逐仓 / 杠杆 / 止盈止损 / 只减仓）＋ 持仓表（盈亏、保证金、
  强平价随现价动）＋ 委托表（可撤单、现价穿过自动撮合）＋ 收盘倒计时。
  分页示例（candlestick / panes / drawing）已删除，内容都整合进来了。

### 其它

- peer 依赖 `@damoqiongqiu/ice-chart@^0.28.0` 与 `ice-render@^4.1.0`；
  `dependencies` 恒为空（家族约定：运行时依赖一律走 peer）。
- 已知边界：价格轴按**全量数据**钉量程，缩放时不自适应。要做「随可见区间自适应」，
  监听 `zoom:change` / `pan:change` 后重算并 `setOption`。
