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
}

/** 把系列上的 `candle` 选项补成完整的样式。 */
export function resolveCandleStyle(option?: TradingSeriesOption | null): ResolvedCandleStyle {
  const candle = (option && option.candle) || {};
  return {
    upColor: candle.upColor || DEFAULT_UP_COLOR,
    downColor: candle.downColor || DEFAULT_DOWN_COLOR,
    borderWidth: candle.borderWidth === undefined ? 1 : candle.borderWidth,
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

  /** 每根蜡烛的外接矩形（影线 + 实体），本地坐标。 */
  private candleRects(): Array<Rect | null> {
    const coord = this.coord;
    if (!coord) return [];
    const out: Array<Rect | null> = [];
    const option = this.candleOption;
    const bandWidth = coord.xScale.bandwidth() || coord.xScale.step() * 0.6;
    const bodyWidth = this.resolveBodyWidth(bandWidth);
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
      out.push({
        x: centerX - bodyWidth / 2,
        y: Math.min(high, low),
        width: bodyWidth,
        height: Math.abs(low - high),
      });
    }
    return out;
  }

  private resolveBodyWidth(bandWidth: number): number {
    const raw = Number(this.series.option.barWidth);
    if (!isFinite(raw) || raw <= 0) return Math.max(2, bandWidth * 0.6);
    return raw <= 1 ? Math.max(2, bandWidth * raw) : Math.max(2, raw * this.unit());
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
    const borderWidth = Math.max(unit, style.borderWidth * unit);
    const bandWidth = coord.xScale.bandwidth() || coord.xScale.step() * 0.6;
    const bodyWidth = this.resolveBodyWidth(bandWidth);
    const rects = this.candleRects();
    // 入场：蜡烛以「开盘价」为轴上下展开（影线随后到位），按日期错峰
    const entering = this.isEntering();
    this.computeItemProgress();

    this.beginDraw();
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

      // 影线
      ctx.beginPath();
      ctx.moveTo(centerX, lerp(yHigh));
      ctx.lineTo(centerX, lerp(yLow));
      ctx.strokeStyle = color;
      ctx.lineWidth = borderWidth;
      ctx.stroke();

      // 实体：统一描边 + 填充同色，涨的填充更浅（相邻蜡烛更容易分辨）
      const yCloseAnimated = lerp(yClose);
      const top = Math.min(yOpen, yCloseAnimated);
      const height = Math.max(borderWidth, Math.abs(yCloseAnimated - yOpen));
      ctx.beginPath();
      ctx.rect(centerX - bodyWidth / 2, top, bodyWidth, height);
      ctx.fillStyle = color;
      ctx.globalAlpha = rising ? 0.55 : 0.95;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = borderWidth;
      ctx.stroke();
    }
    // 悬停：蜡烛实体叠一层高亮描边（不改宽高 —— 改了命中区域就会和渲染分叉）
    if (this.hoverIndex !== null) {
      const rect = rects[this.hoverIndex];
      if (rect) this.drawHoverOverlay(this.hoverIndex, rect, { radius: 2, fill: 'rgba(255,255,255,0.10)' });
    }
    this.endDraw();
  }
}
