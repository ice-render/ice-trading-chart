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

## 公开 API

| 导出 | 用途 |
| --- | --- |
| `createTradingChart(target, option, extras?, chartOptions?)` | 建图（注册系列 + 补齐 option） |
| `toTradingOption(option, extras?)` | 只做 option 补齐，自己调 `createChart` 时用 |
| `registerTradingSeries()` | 只注册 `candlestick` 系列（幂等） |
| `readOhlc(raw, option?)` / `hasOhlc` | 数据项 → `[开, 收, 低, 高]` |
| `computePriceRange(seriesList, { padding? })` | 含影线的价格轴范围 |
| `createOhlcTooltipFormatter({ labels?, seriesOption? })` | OHLC 提示框 formatter |
| `CandlestickSeries` / `DEFAULT_UP_COLOR` / `DEFAULT_DOWN_COLOR` | 系列组件与默认配色 |

## 开发

```bash
npm run build && npm run verify   # types:check → build → jest
npm run test:e2e                 # playwright（端口 8102）
npm run verify:full              # verify + e2e
```

示例页在 `examples/`，e2e 会目录驱动地逐页冒烟。上游联调：把 `devDependencies` 里的
`@damoqiongqiu/ice-chart` 换成 `file:../ice-chart`。

## 许可

MIT
