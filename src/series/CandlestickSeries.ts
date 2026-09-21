import { SeriesBase } from '@damoqiongqiu/ice-chart';
import type { Rect, SeriesType } from '@damoqiongqiu/ice-chart';
import { readOhlc } from '../ohlc';
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

  public hitTestIndex(localX: number, localY: number): number {
    const rects = this.candleRects();
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      if (!rect) continue;
      if (localX >= rect.x - 2 && localX <= rect.x + rect.width + 2 && localY >= rect.y - 2 && localY <= rect.y + rect.height + 2) {
        return i;
      }
    }
    return -1;
  }

  /** 每根蜡烛的外接矩形（影线 + 实体），本地坐标；与绘制共用同一套设备像素对齐。 */
  private candleRects(): Array<Rect | null> {
    const coord = this.coord;
    if (!coord) return [];
    const out: Array<Rect | null> = [];
    const option = this.candleOption;
    const style = resolveCandleStyle(option);
    const bandWidth = coord.xScale.bandwidth() || coord.xScale.step() * 0.6;
    const bodyWidth = this.resolveBodyWidth(bandWidth);
    const wickWidth = Math.max(this.unit(), style.borderWidth * this.cssUnit());
    for (let i = 0; i < this.series.points.length; i++) {
      const point = this.series.points[i];
      const ohlc = readOhlc(point.raw, option);
      if (!ohlc) {
        out.push(null);
        continue;
      }
      const centerX = coord.xScale.map(point.xValue);
      if (!isFinite(centerX)) {
        out.push(null);
        continue;
      }
      const high = coord.yScale.map(ohlc[3]);
      const low = coord.yScale.map(ohlc[2]);
      if (!isFinite(high) || !isFinite(low)) {
        out.push(null);
        continue;
      }
      const geometry = this.candleGeometry(centerX, bodyWidth, wickWidth);
      out.push({
        x: geometry.left,
        y: Math.min(high, low),
        width: geometry.width,
        height: Math.abs(low - high),
      });
    }
    return out;
  }

  private resolveBodyWidth(bandWidth: number): number {
    const raw = Number(this.series.option.barWidth);
    if (!isFinite(raw) || raw <= 0) return Math.max(2, bandWidth * 0.6);
    // ≤1 是「占 band 的比例」；>1 是绝对 CSS 像素
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

  protected doRender(): void {
    const coord = this.coord;
    if (!coord) return;
    const ctx = this.ctx;
    const unit = this.unit();
    const option = this.candleOption;
    const style = resolveCandleStyle(option);
    const upColor = style.upColor;
    const downColor = style.downColor;
    const borderWidth = Math.max(unit, style.borderWidth * this.cssUnit());
    const hollow = style.hollowUp;
    const bandWidth = coord.xScale.bandwidth() || coord.xScale.step() * 0.6;
    const bodyWidth = this.resolveBodyWidth(bandWidth);
    const rects = this.candleRects();
    // 入场：蜡烛以「开盘价」为轴上下展开（影线随后到位），按日期错峰
    const entering = this.isEntering();
    this.computeItemProgress();

    this.beginDraw();
    // 影线要的是「平头细线」，圆头会让它看起来像胶囊（beginDraw 已 save，endDraw 会还原）
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    for (let i = 0; i < this.series.points.length; i++) {
      const point = this.series.points[i];
      const rect = rects[i];
      const ohlc = readOhlc(point.raw, option);
      if (!ohlc || !rect) continue;
      const [open, close, low, high] = ohlc;
      const rising = close >= open;
      const color = rising ? upColor : downColor;
      const centerX = rect.x + rect.width / 2;
      const p = entering ? this.itemProgress[i] : 1;
      if (p <= 0) continue;
      const yOpen = coord.yScale.map(open);
      const yClose = coord.yScale.map(close);
      const yLow = coord.yScale.map(low);
      const yHigh = coord.yScale.map(high);
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
    // 悬停：蜡烛实体叠一层高亮描边（不改宽高 —— 改了命中区域就会和渲染分叉）
    if (this.hoverIndex !== null) {
      const rect = rects[this.hoverIndex];
      if (rect) this.drawHoverOverlay(this.hoverIndex, rect, { radius: 2, fill: 'rgba(255,255,255,0.10)' });
    }
    this.endDraw();
  }
}
