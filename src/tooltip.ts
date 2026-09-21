import type { TooltipParams } from '@damoqiongqiu/ice-chart';
import { formatPrice, formatVolume } from './format';
import { readOhlc } from './ohlc';
import type { CandleFieldOptions } from './types';

/** 提示框里四个价的行名（顺序是 开 / 高 / 低 / 收）。 */
export interface CandleLabels {
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
}

export const DEFAULT_CANDLE_LABELS: Required<CandleLabels> = {
  open: '开',
  high: '高',
  low: '低',
  close: '收',
  volume: '量',
};

export interface OhlcTooltipOptions {
  labels?: CandleLabels;
  /**
   * 数据项的字段名取自哪个系列 option。
   *
   * 提示框回调只拿得到「原始数据项」而拿不到系列 option（ice-chart 的
   * `DataPointParams` 不带 option 引用），所以字段名必须在这里传进来 ——
   * `createTradingChart` 会从系列 option 里取。
   */
  seriesOption?: CandleFieldOptions;
  /** 成交量系列 id。给了才会追加「量」行，并按成交量格式化。 */
  volumeSeriesId?: string;
}

/**
 * 生成 K 线的提示框 formatter。
 *
 * ice-chart 的 `tooltip.formatter` 是公开逃生舱：本函数只返回 `{ rows }`、不返回 `title`，
 * 标题就仍然由 ice-chart 按坐标轴格式化给出（x 轴的时间/类目格式化不两处实现）。
 * 没命中 K 线时返回 `undefined`，把提示框完全交还给 ice-chart 的默认行为。
 *
 * 为什么量要自己格式化：引擎的默认行统一走 `formatAxisValue('y')`，而那个函数**永远用主 y 轴**
 * 的格式化器（`ICEChart.formatAxisValue`），成交量会被当成价格打出来。
 */
export function createOhlcTooltipFormatter(options: OhlcTooltipOptions = {}) {
  const text = { ...DEFAULT_CANDLE_LABELS, ...(options.labels || {}) };
  const seriesOption = options.seriesOption || {};
  return function ohlcFormatter(
    params: TooltipParams
  ): { rows: Array<{ name: string; value: string; color: string }> } | undefined {
    const items = params.items || [];
    const hit = items.find((item) => item.seriesType === 'candlestick');
    if (!hit) return undefined;
    const ohlc = readOhlc(hit.data, seriesOption);
    if (!ohlc) return undefined;
    const color = hit.color;
    const rows = [
      { name: text.open, value: formatPrice(ohlc[0]), color },
      { name: text.high, value: formatPrice(ohlc[3]), color },
      { name: text.low, value: formatPrice(ohlc[2]), color },
      { name: text.close, value: formatPrice(ohlc[1]), color },
    ];
    if (options.volumeSeriesId) {
      const volumeItem = items.find((item) => item.seriesId === options.volumeSeriesId);
      const volume = volumeItem ? Number(volumeItem.value) : NaN;
      if (volumeItem && isFinite(volume)) {
        rows.push({ name: text.volume, value: formatVolume(volume), color: volumeItem.color });
      }
    }
    return { rows };
  };
}
