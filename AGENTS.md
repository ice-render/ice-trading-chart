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

## 副图（pane 栈）的两条纪律

1. **更新必须走 `stack.refresh()`**：`setOption` 是**整体替换**（`ICEChart.applyOption` 里
   直接 `this.option = option`），应用层拿原始 option 调会把 `createPaneStack` 注入的
   「等宽主题 + 定宽刻度标签」一起冲掉 —— 冲掉之后三块绘图区的右边缘立刻错位。
   这也是 `PaneSpec.option` 支持传函数（每次 refresh 重新求值）的原因。
2. **横向对齐靠两件事**：等宽字体（`PANE_FONT_FAMILY`）+ 刻度标签补到固定字符数
   （`fixedWidthAxisFormatter`）。右轴预留宽度 = 最宽标签 + 固定间距，所以标签字符数一致
   才能让各 pane 的绘图区等宽。**字号预算（`axisLabelChars`）要够长**：标签超过预算就不补了，
   对齐随即失效（实测 `42100.5` 是 7 字符，8 才安全）。

## 类目轴取「最近类目」要用 invert 而不是 indexAt

`BandScale` 的类目带之间有 `paddingInner`（默认 0.2）的**空隙**，`indexAt` 落在空隙里返回 -1
（`indexAt` 只判「在带内」）。指针->类目一律用 `scale.invert()`（命中不到给最近类目），
`src/project.ts` 的 `xToCategoryIndex` 就是这个口径 —— 早期用 `indexAt` 时，画线时点在两个蜡烛
之间会「没反应」。

## 折线系列的 null 点会被当成 0（上游行为，已在应用侧规避）

ice-chart 归一化时把 `y === null` 的点写成 `top: 0`（`normalize.ts`），
`computeEffective` 只在 `top === null` 时给 NaN，于是这个点按 **0** 参与绘制 ——
折线会从第一个有效值处拉出一条竖直假线（实测像素 y 落在 `yScale.map(0)` 上，不是 NaN）。

规避：`seriesData()` 默认**裁掉首尾 null**（均线预热期正是这种情况）。
**中间的空洞目前没法在应用侧规避**，要等上游把 null 点真正断线。

## 外围组件也归本包

交易专属的**非图表** UI 也放在本包（盘口 `src/orderBook.ts` 是第一个）—— 通用图表库不该认识盘口，
而本包的定位就是「交易语义的唯一落点」。约定：

- **自包含**：结构 + 样式（注入一次、id 守卫）+ 交互都在组件里，页面只给一个容器；
- **结构只建一次**，`update()` 只改数值；变更按**签名**去重，数据没变时一次 DOM 都不写
  （伪实时页面每帧都在推数据，无脑重建会掉帧）；
- **语义交给调用方**：组件不猜「最新价该跟谁比」，颜色用 `midColor` 传进来；
- 数据方向写进类型注释（盘口是「最优价在前」），页面就按契约给。

## 示例页的成员顺序（棘轮会卡）

`static 字段 → static 方法 → 实例字段 → 构造函数 → 访问器 / 实例方法`。
最容易写错的是把 `static round2()` 这类工具方法顺手写在构造函数后面 —— 棘轮判成
`S*F*C*T*...` 直接失败（本项目连踩三次）。写新页面时先把 static 段落收齐再写字段。

## 高分屏必须显式传 dpr（引擎默认 1）

`ICE.dpr` 默认是 **1**，引擎**不会**自己去读 `window.devicePixelRatio`
（`ICEChartOptions.dpr` 存在，但不传就是 1）。不传的后果不是「稍微糊一点」：
画布的 backing store 只有 CSS 尺寸，浏览器把 1x 位图放大 2~3 倍显示 ——
轴线、刻度、K 线、文字**全都发虚**（全家族 30 个示例都没传，实测踩到）。

本包已经**默认补上**：`createTradingChart` / `createPaneStack` 不传 `dpr` 时取
`window.devicePixelRatio`（上限 3，见 `src/device.ts`），显式传 `dpr: 1` 可退回旧行为。

## `unit()` 是「设备像素」不是「CSS 像素」

基类 `ChartComponent.unit()` 的定义是「一个**设备**像素在当前 ctx 变换下的长度」
（`1/(vp.scale·dpr)`）。所以 `style.borderWidth * unit()` 得到的是 **borderWidth 个设备像素**：
dpr = 1 时看着正好，dpr = 3 时只剩 1/3 个 CSS 像素 —— 细得像头发丝。
要按 CSS 像素给线宽必须再乘 dpr，蜡烛里封成了 `cssUnit()`（= `unit() * dpr`）。

同理，填充类几何要对齐**设备像素边界**（`Math.round(v/unit())*unit()`），
而 1px 线要对齐**像素中心**（基类 `snap()` 已经做了）。

## 蜡烛的水平对齐：影线与实体必须同轴

影线和实体**不能各自取整**：实体左右边缘四舍五入到整数设备像素、影线单独用 `snap()`
（它加了半个像素），两套取整合起来**根根蜡烛都歪 0.5 设备像素**（实测 meanAbs = maxAbs = 0.5），
用户一眼就看出来「影线没居中，很诡异」。

正确做法是从**同一个设备像素几何**推出来（`CandlestickSeries.candleGeometry()`，绘制与命中共用）：

1. 影线中轴按**宽度奇偶**落在正确的像素上：奇数设备像素取半像素（经典 1px 对齐），
   偶数取整数像素；
2. 实体宽取**与影线同奇偶**的设备像素数 —— 这样左右边缘落在整数像素上（填充清晰），
   且严格以影线为中轴。

回归测试在 `tests/device.test.ts`（dpr = 1 / 2 / 3 三档都断言偏差为 0）。

## 影线不能从实体中间穿过去

蜡烛的影线要画成**实体上下两段**（`high → 实体上沿`、`实体下沿 → low`），
不能一条线从 high 贯到 low：实心实体盖得住，**空心阳线会把中间那段露出来** ——
一条竖线穿过蜡烛正中，看起来像画错了（用户实测反馈）。

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

## 外围组件也归本包

交易专属的**非图表** UI 也放在本包（盘口 `src/orderBook.ts` 是第一个）—— 通用图表库不该认识盘口，
而本包的定位就是「交易语义的唯一落点」。约定：

- **自包含**：结构 + 样式（注入一次、id 守卫）+ 交互都在组件里，页面只给一个容器；
- **结构只建一次**，`update()` 只改数值；变更按**签名**去重，数据没变时一次 DOM 都不写
  （伪实时页面每帧都在推数据，无脑重建会掉帧）；
- **语义交给调用方**：组件不猜「最新价该跟谁比」，颜色用 `midColor` 传进来；
- 数据方向写进类型注释（盘口是「最优价在前」），页面就按契约给。

## 示例页

**本仓只有一个示例页** `examples/terminal.html`（完整交易终端屏）—— 用户明确要求把能力
整合到一个综合示例里，而不是摊成几个分页（分页版本在 git 历史里，需要时可取回）。

它仍然守家族的写法契约：`examples/*.html` 一律「**一页 = 一个类**」，内联脚本里不出现
模块级 `function` / `let`，成员顺序 `S*T*F*C*(A|M)*`。写法契约的单一来源是
`ice-web-components/docs/guides/app-pages.md`（本仓示例是伪实时演示，
刷新原本由页面自己的定时器驱动）。

**页面结构**（改之前先看这里）：顶部行情条 / 左侧盘口 / 中间三 pane 图表 + 外壳覆盖层 /
右侧下单面板 / 底部「持仓 · 委托 · 画线记录」。图表外壳（抬头、最新价线、右轴价签、
十字光标两侧 chip）挂在 `stack.holderOf('price')` 上，按几何签名增量同步。

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
