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
- 示例页 `examples/candlestick.html`（一页一类，含实时追加与价格轴自适应开关）。

### 其它

- peer 依赖 `@damoqiongqiu/ice-chart@^0.28.0` 与 `ice-render@^4.1.0`；
  `dependencies` 恒为空（家族约定：运行时依赖一律走 peer）。
- 已知边界：价格轴按**全量数据**钉量程，缩放时不自适应。要做「随可见区间自适应」，
  监听 `zoom:change` / `pan:change` 后重算并 `setOption`。
