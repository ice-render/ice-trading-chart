# AGENTS.md — ice-trading-chart

## 这是什么

**交易图表库**：K 线、影线命中、OHLC 提示框、含影线的价格轴量程。

依赖方向严格单向：

```
ice-trading-chart  →  ice-chart  →  ice-render
```

读者请先读 `../ice-render/AGENTS.md`（引擎铁律）与 `../ice-chart/AGENTS.md`（图表层约定），
本文件只记**交易层特有**的约定与踩过的坑。

## 铁律

1. **本包是交易语义的唯一落点**。`ice-chart` 保持通用、零金融语义；任何「给 ice-chart
   加个金融扩展点」的思路都不成立 —— 该加的东西一律加在本包。
2. **不得反向依赖**：`ice-chart` 的 `package.json` / 源码里**永远不出现** `ice-trading-chart`。
   本包对上游的改动只能有两类：① 发现上游 bug（通用问题，纯通用修法）；② 上游新增
   **不含交易语义**的通用能力。两类都要先跟用户确认再动上游。
3. **只吃上游的公开导出面**（`@damoqiongqiu/ice-chart` 的 `src/index.ts` 与
   `ice-render` 的入口）。**不许深引** `ice-chart/src/**`、`internal.ts`、
   或任何 `dist/` 里的深层路径 —— 那会把「上游可以自由重构」这件事偷偷取消掉。
4. **数据、量程、提示框都自己实现**，不向上游要钩子：
   - 四个价从 `point.raw` 自己解析（`ohlc.ts`），不依赖 OHLC 内部字段；
   - 价格轴量程走公开的 `yAxis.min` / `yAxis.max`（`axisRange.ts`）；
   - OHLC 提示框走公开的 `tooltip.formatter`（`tooltip.ts`）；
   - 时间轴用 `xAxis: { type: 'category' }`（等宽 K 线、跳过非交易时段）。
5. **读不出的数据项不画**，绝不补 0 或补前值 —— 假 K 线比空缺危险。
6. **不写第三方 / 竞品项目名**（家族铁律）：源码注释、文档、示例页、测试、提交信息里
   都不许出现。要描述视觉或交互，就**描述结果**，不描述来源。
7. **成员顺序**（2026-09-17 定，全家族同口径）：`static 常量/字段 → static 方法 →
   实例字段 → 构造函数 → 访问器 / 实例方法`，即正则 `S*T*F*C*(A|M)*`。示例页的棘轮
   （`tests/examplesConvention.test.ts`）会守住这条。

## 与上游的接法（改代码前必读）

`candlestick` 在本包是**自定义系列**：靠 `registerSeriesType('candlestick', …)` 接进
ice-chart 的系列注册表（`src/register.ts`，幂等）。因此：

- 命中判定、悬停高亮、提示框、图例、序列化、跨图联动**全部走 ice-chart 既有链路**，
  本包不需要自己实现任何一个；
- 用户的 option 里仍然写 `type: 'candlestick'` —— 这个名字在 ice-chart 0.28 之前是内置的，
  本包沿用它，用户的配置不用改；
- 装的是**还没摘掉内置 candlestick 的旧版 ice-chart**（≤0.27.x）时，`registerTradingSeries`
  会检测到已有工厂并沿用内置实现，不会去覆盖内置类型（上游对内置名是抛错的）。

`this.series.option` 是**原始 option 对象的引用**（ice-chart 归一化时不拷贝），所以本包自己的
扩展字段（`candle` 与四个 `*Field`）不需要上游认识它们，就能一路到达系列组件与提示框。
`toSerializableOption` 也是深度拷贝、保留所有键，所以它们同样能进快照。

## 类目轴的两个硬约束（做交易图表必读）

1. **类目是按字符串去重的**。`buildCategoryValues` 用 `String(value)` 做键，所以
   「同一个标签出现两次」会把两根 K 线塌缩到同一个类目上 —— 表面看是「K 线叠在一起」，
   实际是命中判定、十字光标、抬头全部错位。**多天数据的标签必须带日期**：跨度 ≥ 24h 时
   写 `MM-DD HH:MM`，1D 写 `MM-DD`。示例页的 `labelOf()` 就是这么做的。
2. **`BandScale.indexOf` 刻意不做「数值当类目下标」的退化**（`BandScale.ts:44-47`）。
   成交量这类「派生系列」的数据项必须**带上和 K 线相同的 x**，只写 `{ value, color }`
   在类目轴上会映射到 NaN、柱子整片消失。

## 用浏览器验证前必须先 build

示例页加载的是 `../dist/index.umd.js`（构建产物），而 jest 走 `src`。
所以**改了 `src` 只跑 `npm test` 是假的绿灯**：浏览器里跑的还是旧包。
真实链路验证的顺序是 `npm run build`（或 `npm run verify`，它含 build）→ 起服务 → 看页面。
本项目已经因此误判过一次（`tooltip.trigger` 的默认值改了但页面没生效）。

## 图表外壳由页面画（HTML 覆盖层）

最新价线 / 右轴价签 / 左上角抬头 / 十字光标的两侧标签都走**页面 DOM**，不画进 canvas：

- 读数用 `createOhlcReadout()`（引擎没有十字光标位置事件，它包了 `controller.hover` 与
  `item:hover`/`item:leave`/`data:change`）；
- 定位一律用 `src/project.ts` 的 `plotRect` / `priceToY` / `yToPrice` / `categoryToX`，
  **不要用 `seriesComponent.pixelAt()`**（动画期间返回补间位置，实测踩过）；
- 引擎自带的十字光标 y 标签固定在绘图区**左**边缘，价格轴在右时必须
  `crosshair.showAxisLabel: false`，否则左边缘会多出一个价格标签；
- `tooltip.show: false` **只关浮动提示框**，不影响悬停与十字光标（`trigger` 默认 `axis`，
  即整列读数，抬头跟随光标靠它）；
- 重排按**几何签名**增量写 DOM，别每帧无条件写（`a11y-mirror.html` 就是这个套路）。

## 价格轴为什么要自己钉（最容易踩的坑）

`ice-chart` 的 `buildYDomain` 只收归一化后的 `y`（本包默认取收盘价字段），而
`min` / `max` 是**在极值之后覆盖**的，且**显式写了的那一侧不再施加自动留白**。
所以：

- 不钉 → 影线（low / high）落进绘图区之外，被裁掉；
- 钉了 → 留白要**我们自己给**（`computePriceRange` 的 `padding`，默认 6%），否则刻度贴着影线端点。

改了数据之后记得重钉：`chart.setData()` **不会**重算价格轴。正确做法是
`chart.setOption(toTradingOption(nextOption), { animate: false, preserveView: true })`
（示例页 `examples/candlestick.html` 就是这么写的）。

## 测试约定

- `npm test` 跑 jest（jsdom + `tests/setup/canvas-env.ts` 的 Canvas 2D 桩）。
  **不要 mock 引擎**：集成用例走真实渲染 → 真实命中测试，才能抓到「渲染与命中不一致」。
- 集成用例里**关掉动画**（`animation: { enabled: false }`）或**直接查比例尺**算坐标：
  入场动画期间 `pixelAt()` 给的是补间中的位置，拿它做命中断言会飘。
- 新增能力同步补三类用例：纯函数（`ohlc` / `axisRange`）、option 补齐（`option`）、
  端到端交互（`candlestick`）。

## 示例页

`examples/*.html` 一律「**一页 = 一个类**」，内联脚本里不出现模块级 `function` / `let`，
刷新入口统一叫 `onUpdate()`。写法契约的单一来源是
`ice-web-components/docs/guides/app-pages.md`（本仓示例页是伪实时演示，
`onUpdate()` 由页面自己的定时器调用）。

## 端口

e2e 用 **8102**（家族端口表在 `ice-render/AGENTS.md`，新增仓先登记再写配置）。
`reuseExistingServer` 一律 `false`：端口被别的仓占着时要响亮失败。

## 分支与发版约定（家族铁律，2026-09-13 确立）

- **开发**：在临时分支（或 `dev`）上做；`main` 只做集成与发版。
- **发版前**：必须先把开发分支合并进 `main`，**再从 `main` 发版**（跑门禁 → `npm publish`）。
- **禁止**：直接在 `main` 上写实现；也禁止只把改动留在临时分支而让 `main` 停在旧版本。
- 本仓主线名：`main`，远端 `origin`（Gitee）+ `github-origin`（GitHub），两处都要推。
- 提交信息遵循 `@commitlint/config-conventional` 风格；**破坏性变更写在 CHANGELOG 的
  「### 变更（破坏性：…）」小节，提交信息不要用 `!` 标记**。
- `prepublishOnly` 跑 `npm run verify`（不含 e2e，e2e 是发版前的本地动作）。

## 提交前自检

```bash
npm run verify       # types:check → build → jest
npm run verify:full  # 再加 e2e（改了示例页 / 渲染必跑）
```
