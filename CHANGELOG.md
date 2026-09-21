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
- 示例页 `examples/candlestick.html` 重做为专业交易图表：近黑底、周期切换（1m~1D）、
  涨跌配色切换、K 线 + 成交量副图、最新价线 + 右轴价签、左上角 OHLC 抬头、
  十字光标横线与两侧标签、收盘倒计时、伪实时推送。

### 其它

- peer 依赖 `@damoqiongqiu/ice-chart@^0.28.0` 与 `ice-render@^4.1.0`；
  `dependencies` 恒为空（家族约定：运行时依赖一律走 peer）。
- 已知边界：价格轴按**全量数据**钉量程，缩放时不自适应。要做「随可见区间自适应」，
  监听 `zoom:change` / `pan:change` 后重算并 `setOption`。
