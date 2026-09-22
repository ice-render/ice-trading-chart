import { SeriesBase } from '@damoqiongqiu/ice-chart';
import type { SeriesType } from '@damoqiongqiu/ice-chart';
import { candleColumnsFor } from './candleColumns';
import type { CandleColumns } from './candleColumns';
import type { TradingSeriesOption } from '../types';

/** 涨跌默认配色（红涨绿跌）。 */
export const DEFAULT_UP_COLOR = '#EF4444';
export const DEFAULT_DOWN_COLOR = '#10B981';

/** 解析后的蜡烛样式（成交量、抬头、价签都要用同一份，所以往外暴露一个出口）。 */
export interface ResolvedCandleStyle {
  upColor: string;
  downColor: string;
  borderWidth: number;
  hollowUp: boolean;
}

/** 把系列上的 `candle` 选项补成完整的样式。 */
export function resolveCandleStyle(option?: TradingSeriesOption | null): ResolvedCandleStyle {
  const candle = (option && option.candle) || {};
  return {
    upColor: candle.upColor || DEFAULT_UP_COLOR,
    downColor: candle.downColor || DEFAULT_DOWN_COLOR,
    borderWidth: candle.borderWidth === undefined ? 1 : candle.borderWidth,
    hollowUp: candle.hollowUp === true,
  };
}

/**
 * K 线（蜡烛图）。
 *
 * 它是 ice-chart 的**自定义系列**：靠 `registerSeriesType('candlestick', …)` 接进图表，
 * 所以命中判定、悬停高亮、提示框、图例、序列化全部走 ice-chart 既有链路。
 *
 * 数据从哪来：ice-chart 归一化后的点只保证 `y`（默认取 `yField`，本包默认设成收盘价字段），
 * 四个价由本组件从 `point.raw` 自己解析（`readOhlc`），不依赖任何 OHLC 内部字段。
 */
export class CandlestickSeries extends SeriesBase {
  public seriesType: SeriesType = 'candlestick';
  protected supportsSampling = false;
  protected clipToBox = true;

  /** 本包自己的 option（ice-chart 不认识这些字段，但会按引用透传过来）。 */
  private get candleOption(): TradingSeriesOption {
    return this.series.option as TradingSeriesOption;
  }

  /** 列存（与价格轴量程共用同一份；数据变了 ice-chart 会换 points，这里跟着失效）。 */
  private columnsCache: { points: unknown; columns: CandleColumns } | null = null;
  /** 可见下标窗口的缓存（一次绘制 / 命中里会反复用）。 */
  private windowCache: { key: string; from: number; to: number } | null = null;

  public updateSeries(series: any, animate: boolean, preserveAnimation = false): this {
    this.columnsCache = null;
    this.windowCache = null;
    return super.updateSeries(series, animate, preserveAnimation);
  }

  private columns(): CandleColumns {
    /**
     * 走**系列感知**的列存（`candleColumnsFor`）：数据来源优先是系列自己的存储，而不是
     * `option.data` —— K 线走列存 + `appendData(..., { maxPoints })` 之后 `data` 会被摘掉，
     * 照 `option.data` 建列会得到一份空列，蜡烛**静默不画**（实测踩到）。
     * 缓存按存储对象增量维护：环滑动 O(滑动格数)、尾部追加 O(新增根数)。
     */
    return candleColumnsFor(this.series, this.candleOption);
  }

  public hitTestIndex(localX: number, localY: number): number {
    const coord = this.coord;
    const columns = this.columns();
    if (!coord || !columns.count) return -1;
    /**
     * 命中不再「扫全量 + 每根建一个 Rect」：
     * 先把指针的 x 反查成**类目**，再经类目索引直接落到下标（O(1)），
     * 只在那一根的邻域里比矩形（指针落在两根之间的缝里时会退到邻近根）。
     */
    const hovered = this.indexOfCategory(coord.xScale.invert(localX));
    const base = hovered >= 0 ? hovered : this.nearestVisibleIndex(localX, columns);
    if (base < 0) return -1;
    const option = this.candleOption;
    const style = resolveCandleStyle(option);
    const bandWidth = coord.xScale.bandwidth() || coord.xScale.step() * 0.6;
    const bodyWidth = this.resolveBodyWidth(bandWidth);
    const wickWidth = Math.max(this.unit(), style.borderWidth * this.cssUnit());
    for (let i = base - 1; i <= base + 1; i++) {
      if (i < 0 || i >= columns.count || !columns.valid[i]) continue;
      const centerX = coord.xScale.map(this.series.xValueAt(i));
      if (!isFinite(centerX)) continue;
      const high = coord.yScale.map(columns.high[i]);
      const low = coord.yScale.map(columns.low[i]);
      if (!isFinite(high) || !isFinite(low)) continue;
      const geometry = this.candleGeometry(centerX, bodyWidth, wickWidth);
      const top = Math.min(high, low);
      const bottom = Math.max(high, low);
      if (
        localX >= geometry.left - 2 &&
        localX <= geometry.left + geometry.width + 2 &&
        localY >= top - 2 &&
        localY <= bottom + 2
      ) {
        return i;
      }
    }
    return -1;
  }

  /**
   * 实体宽度。
   *
   * `barWidth` ≤ 1 表示**占类目带宽的比例**，**默认 1（铺满带宽）**；> 1 是绝对 CSS 像素。
   *
   * 为什么默认铺满带宽：类目轴本身已经用 `paddingInner` 扣掉 20% 的步距当间隙，
   * 带宽 = 0.8 × 步距。实体再乘一个 0.66 的话，实体只占步距的 53% —— **一半都是缝**，
   * 看着很稀疏。主流终端库的口径是「实体占步距的 82%~86%（间隙 14%~20%）」
   * （`optimalCandlestickWidth`：`spacing × coeff`，coeff 从小间距的 ~0.86 渐近到 0.8），
   * 所以铺满带宽（间隙 20%）才是同一个量级。
   */
  private resolveBodyWidth(bandWidth: number): number {
    const raw = Number(this.series.option.barWidth);
    if (!isFinite(raw) || raw <= 0) return Math.max(2, bandWidth);
    return raw <= 1 ? Math.max(2, bandWidth * raw) : Math.max(2, raw);
  }

  /**
   * 一个 **CSS 像素**在当前 ctx 变换下的长度。
   *
   * ⚠️ 基类的 `unit()` 是「一个**设备**像素」的长度（`1/(vp.scale·dpr)`），不是 CSS 像素。
   * 蜡烛的 `borderWidth` 按 CSS 像素给，所以在 dpr > 1 时必须再乘 dpr ——
   * 否则 3 倍屏上影线只剩 1/3 像素宽，细得像头发丝。
   */
  private cssUnit(): number {
    const ice: any = (this as any).ice;
    const dpr = (ice && ice.dpr) || 1;
    return this.unit() * dpr;
  }

  /**
   * 一根蜡烛的**设备像素级几何**：影线中轴 + 实体矩形。绘制与命中共用同一份，
   * 免得「画出来的」和「点得到的」分叉。
   *
   * 两条对齐规则：
   * 1. **影线打在设备像素中心**：线宽是奇数个设备像素时中心取半像素（经典的 1px 细线对齐），
   *    偶数个设备像素时中心取整数像素 —— 否则线会糊成两像素灰边。
   * 2. **实体宽取与影线同奇偶**的设备像素数：这样左右边缘落在整数像素上（填充清晰），
   *    而且严格以影线为中轴。
   *
   * 早先的实现是「实体左右边缘各自四舍五入 + 影线单独 `snap()`」，两套取整各偏半个像素，
   * 合起来**根根蜡烛都歪 0.5 设备像素**（实测 meanAbs = maxAbs = 0.5），看着很诡异。
   */
  private candleGeometry(centerX: number, bodyWidth: number, wickWidth: number) {
    const scale = 1 / this.unit(); // 设备像素 / ctx 单位
    const wickDevice = Math.max(1, Math.round(wickWidth * scale));
    const parity = wickDevice % 2;
    const wickX = (Math.round(centerX * scale) + (parity ? 0.5 : 0)) / scale;
    let bodyDevice = Math.max(1, Math.round(bodyWidth * scale));
    if (bodyDevice % 2 !== parity) bodyDevice += 1;
    return { left: wickX - bodyDevice / scale / 2, width: bodyDevice / scale, wickX };
  }

  /** 纵向对齐到设备像素边界（实体上下沿与影线端点用）。 */
  private snapRow(value: number): number {
    const scale = 1 / this.unit();
    return Math.round(value * scale) / scale;
  }

  /** 类目 → 下标（列存里的索引表），指针落在窗口外时返回 -1。 */
  private indexOfCategory(category: unknown): number {
    if (category === undefined || category === null) return -1;
    return this.columns().indexOfX.get(String(category)) ?? -1;
  }

  /**
   * 可见下标窗口（两端各留 `pad` 根）。
   *
   * 类目轴的 `domain` 在缩放后就是**窗口内的类目**，所以「首末类目 → 下标」两次查表
   * 就能把窗口夹出来 —— 全量 K 线一根都不用扫（这是渲染与命中都不再 O(n) 的前提）。
   */
  public visibleRange(pad = 2): { from: number; to: number } {
    const coord = this.coord;
    const columns = this.columns();
    const n = columns.count;
    if (!coord || !n) return { from: 0, to: n - 1 };
    const key = `${coord.xScale.domain.length}:${String(coord.xScale.domain[0])}~${String(
      coord.xScale.domain[coord.xScale.domain.length - 1]
    )}#${n}#${pad}`;
    if (this.windowCache && this.windowCache.key === key) {
      return { from: this.windowCache.from, to: this.windowCache.to };
    }
    const first = columns.indexOfX.get(String(coord.xScale.domain[0]));
    const last = columns.indexOfX.get(String(coord.xScale.domain[coord.xScale.domain.length - 1]));
    if (first === undefined || last === undefined) {
      const full = { from: 0, to: n - 1 };
      this.windowCache = { key, ...full };
      return full;
    }
    const lo = Math.min(first, last);
    const hi = Math.max(first, last);
    const range = { from: Math.max(0, lo - pad), to: Math.min(n - 1, hi + pad) };
    this.windowCache = { key, ...range };
    return range;
  }

  /**
   * 第 `index` 根蜡烛的外接矩形（组件本地坐标；影线 + 实体，读不出的根返回 null）。
   *
   * 单根取值、**不建数组**：绘制与命中都只按可见窗口逐根算（历史上这里会为全量 K 线
   * 建一个「每根一个 Rect」的数组 —— 10 万根就是每帧 10 万个短命对象）。
   * 公开出来是给外壳（读数框 / 对齐断言 / 调试）用的。
   */
  public candleRectAt(index: number): { x: number; y: number; width: number; height: number } | null {
    const coord = this.coord;
    const columns = this.columns();
    if (!coord || index < 0 || index >= columns.count || !columns.valid[index]) return null;
    const centerX = coord.xScale.map(this.series.xValueAt(index));
    if (!isFinite(centerX)) return null;
    const high = coord.yScale.map(columns.high[index]);
    const low = coord.yScale.map(columns.low[index]);
    if (!isFinite(high) || !isFinite(low)) return null;
    const style = resolveCandleStyle(this.candleOption);
    const bandWidth = coord.xScale.bandwidth() || coord.xScale.step() * 0.6;
    const geometry = this.candleGeometry(
      centerX,
      this.resolveBodyWidth(bandWidth),
      Math.max(this.unit(), style.borderWidth * this.cssUnit())
    );
    return {
      x: geometry.left,
      y: Math.min(high, low),
      width: geometry.width,
      height: Math.abs(low - high),
    };
  }

  /** 指针落在两根之间的缝里时：在**窗口内**找最近的一根（窗口外一根都不看）。 */
  private nearestVisibleIndex(localX: number, columns: CandleColumns): number {
    const coord = this.coord;
    if (!coord) return -1;
    const { from, to } = this.visibleRange();
    let best = -1;
    let bestDist = Infinity;
    for (let i = from; i <= to; i++) {
      if (!columns.valid[i]) continue;
      const x = coord.xScale.map(this.series.xValueAt(i));
      if (!isFinite(x)) continue;
      const dist = Math.abs(x - localX);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }

  /**
   * 压缩模式（一屏几千根以上，实体已经不足 1 像素）：
   * **每个像素列画一根高低线**，值取该列里读得出的根的真实极值（low 的最小、high 的最大），
   * 颜色取该列最后一根的涨跌。
   *
   * 为什么能这么压：一个像素列里塞着的根本来就分不出来，挤在一起画实体等于互相覆盖；
   * 而聚合的是**真实极值**，不是补值 —— 与「读不出的根不画」是同一条纪律。
   */
  private renderCompact(
    ctx: any,
    columns: CandleColumns,
    coord: any,
    style: ResolvedCandleStyle,
    from: number,
    to: number,
    plotWidth: number
  ): void {
    const buckets = new Map<number, { low: number; high: number; up: boolean }>();
    const limit = Math.max(1, Math.round(plotWidth));
    const visible = to - from + 1;
    for (let i = from; i <= to; i++) {
      if (!columns.valid[i]) continue;
      /**
       * 桶号**按下标比例**算，不调 `xScale.map()`。
       *
       * 类目轴的 `map()` 内部是「在整串类目里找这个类目」（线性），压缩模式下逐根调它
       * 等于 O(可见根数 × 类目数)：10 万根实测首帧 3.7s（改前整帧 7.4s 里的一半）。
       * 类目轴的带宽是等距的，所以 `(i - from) / visible × 绘图区宽` 就是同一件事，
       * 而且是纯算术 —— 10 万根只要 0.2ms。
       */
      const bucketIndex = Math.max(0, Math.min(limit - 1, Math.floor(((i - from) / visible) * limit)));
      const bucket = buckets.get(bucketIndex);
      const low = columns.low[i];
      const high = columns.high[i];
      if (!bucket) {
        buckets.set(bucketIndex, { low, high, up: columns.close[i] >= columns.open[i] });
        continue;
      }
      if (low < bucket.low) bucket.low = low;
      if (high > bucket.high) bucket.high = high;
      bucket.up = columns.close[i] >= columns.open[i];
    }
    const lineWidth = Math.max(this.unit(), style.borderWidth * this.cssUnit());
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'butt';
    for (const [bucketIndex, bucket] of buckets) {
      const top = this.snapRow(coord.yScale.map(bucket.high));
      const bottom = this.snapRow(coord.yScale.map(bucket.low));
      if (!isFinite(top) || !isFinite(bottom)) continue;
      const x = (bucketIndex + 0.5) * (plotWidth / limit);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, Math.max(bottom, top + lineWidth));
      ctx.strokeStyle = bucket.up ? style.upColor : style.downColor;
      ctx.stroke();
    }
  }

  protected doRender(): void {
    const coord = this.coord;
    if (!coord) return;
    const columns = this.columns();
    if (!columns.count) return;
    const ctx = this.ctx;
    const option = this.candleOption;
    const style = resolveCandleStyle(option);
    const upColor = style.upColor;
    const downColor = style.downColor;
    const borderWidth = Math.max(this.unit(), style.borderWidth * this.cssUnit());
    const hollow = style.hollowUp;
    const bandWidth = coord.xScale.bandwidth() || coord.xScale.step() * 0.6;
    const bodyWidth = this.resolveBodyWidth(bandWidth);
    const { from, to } = this.visibleRange();
    if (to < from) return;
    const plotWidth = coord.plot.width || 1;
    // 入场：蜡烛以「开盘价」为轴上下展开（影线随后到位），按日期错峰
    const entering = this.isEntering();
    this.computeItemProgress();

    this.beginDraw();
    // 影线要的是「平头细线」，圆头会让它看起来像胶囊（beginDraw 已 save，endDraw 会还原）
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';

    // 压缩模式：一屏超过「每根 0.25 像素」时改画每像素列的高低线
    if (to - from + 1 > plotWidth * 4) {
      this.renderCompact(ctx, columns, coord, style, from, to, plotWidth);
      this.endDraw();
      return;
    }

    for (let i = from; i <= to; i++) {
      if (!columns.valid[i]) continue;
      const centerX = coord.xScale.map(this.series.xValueAt(i));
      if (!isFinite(centerX)) continue;
      const yOpen = coord.yScale.map(columns.open[i]);
      const yClose = coord.yScale.map(columns.close[i]);
      const yLow = coord.yScale.map(columns.low[i]);
      const yHigh = coord.yScale.map(columns.high[i]);
      if (!isFinite(yOpen) || !isFinite(yClose) || !isFinite(yLow) || !isFinite(yHigh)) continue;
      const rising = columns.close[i] >= columns.open[i];
      const color = rising ? upColor : downColor;
      const p = entering ? this.itemProgress[i] : 1;
      if (p <= 0) continue;
      // 从开盘价向上下两端生长
      const yMid = yOpen;
      const lerp = (target: number) => yMid + (target - yMid) * p;

      const yCloseAnimated = lerp(yClose);
      const top = this.snapRow(Math.min(yOpen, yCloseAnimated));
      const bottom = this.snapRow(Math.max(yOpen, yCloseAnimated));
      const height = Math.max(1, bottom - top);
      const geometry = this.candleGeometry(centerX, bodyWidth, borderWidth);
      const left = geometry.left;
      const width = geometry.width;

      // 影线：**只画实体上下两段**，不从实体中间穿过去。
      // 实心实体虽然会盖住中间那段，但空心阳线会把中间露出来 —— 一条竖线穿过蜡烛正中，
      // 看起来像画错了。水平位置取自 candleGeometry，与实体严格同轴。
      const wickX = geometry.wickX;
      ctx.beginPath();
      ctx.moveTo(wickX, lerp(yHigh));
      ctx.lineTo(wickX, top);
      ctx.moveTo(wickX, bottom);
      ctx.lineTo(wickX, lerp(yLow));
      ctx.strokeStyle = color;
      ctx.lineWidth = borderWidth;
      ctx.stroke();

      if (hollow && rising && width > borderWidth && height > borderWidth) {
        // 空心阳线：描边内缩半个线宽，外沿仍等于实体宽
        const half = borderWidth / 2;
        ctx.beginPath();
        ctx.rect(left + half, top + half, width - borderWidth, height - borderWidth);
        ctx.strokeStyle = color;
        ctx.lineWidth = borderWidth;
        ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(left, top, width, height);
      }
    }
    // 悬停时**不**在蜡烛上叠任何标记（2026-09-21 按用户要求去掉，别再加回来）。
    //
    // 这里原本会画一圈白描边 + 一层淡白蒙层。问题是「现在读的是哪一根」已经由十字准星
    // 回答得很清楚了，再叠一层标记只会**把正要看的那根 K 自己盖住**；主流看盘软件的
    // K 线在指针划过时也不给蜡烛加边框。
    this.endDraw();
  }
}
