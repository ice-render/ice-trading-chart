import type { TooltipParams } from '@damoqiongqiu/ice-chart';
import { readOhlc } from './ohlc';
import type { CandleFieldOptions } from './types';

/** 提示框里四个价的行名。 */
export interface CandleLabels {
  open?: string;
  close?: string;
  low?: string;
  high?: string;
}

export const DEFAULT_CANDLE_LABELS: Required<CandleLabels> = {
  open: '开盘',
  close: '收盘',
  low: '最低',
  high: '最高',
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
}

/** 价格显示：最多 6 位小数，去掉尾随的 0（32.10 → 32.1）。 */
export function formatPrice(value: number): string {
  if (!isFinite(value)) return '-';
  const fixed = value.toFixed(6);
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}

/**
 * 生成 K 线的提示框 formatter。
 *
 * ice-chart 的 `tooltip.formatter` 是公开逃生舱：本函数只返回 `{ rows }`、不返回 `title`，
 * 标题就仍然由 ice-chart 按坐标轴格式化给出（x 轴的时间/类目格式化不两处实现）。
 * 没命中 K 线时返回 `undefined`，把提示框完全交还给 ice-chart 的默认行为。
 */
export function createOhlcTooltipFormatter(options: OhlcTooltipOptions = {}) {
  const text = { ...DEFAULT_CANDLE_LABELS, ...(options.labels || {}) };
  const seriesOption = options.seriesOption || {};
  return function ohlcFormatter(
    params: TooltipParams
  ): { rows: Array<{ name: string; value: string; color: string }> } | undefined {
    const hit = (params.items || []).find((item) => item.seriesType === 'candlestick');
    if (!hit) return undefined;
    const ohlc = readOhlc(hit.data, seriesOption);
    if (!ohlc) return undefined;
    const color = hit.color;
    return {
      rows: [
        { name: text.open, value: formatPrice(ohlc[0]), color },
        { name: text.close, value: formatPrice(ohlc[1]), color },
        { name: text.low, value: formatPrice(ohlc[2]), color },
        { name: text.high, value: formatPrice(ohlc[3]), color },
      ],
    };
  };
}
