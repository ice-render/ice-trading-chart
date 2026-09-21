import type { CandleDatum, CandleFieldOptions, Ohlc } from './types';

/** 默认字段名（短名）。也兼容 `open` / `close` / `low` / `high` 长名。 */
export const CANDLE_FIELDS = {
  open: 'o',
  close: 'c',
  low: 'l',
  high: 'h',
} as const;

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return isFinite(n) ? n : null;
}

/** 取值优先级：option 里配置的字段名 → 长名 → 短名。 */
function readField(item: CandleDatum, configured: string | undefined, long: string, short: string): number | null {
  if (configured && item[configured] !== undefined) return toNumber(item[configured]);
  if (item[long] !== undefined) return toNumber(item[long]);
  return toNumber(item[short]);
}

/**
 * 从原始数据项里读出 [开, 收, 低, 高]。
 *
 * 两种数据形态都认：
 * - 数组：`[open, close, low, high]`
 * - 对象：`{ x, o, c, l, h }`（字段名可用 option 覆盖，也兼容 `open/close/low/high` 长名）
 *
 * 读不出来或含非数值时返回 `null` —— 这根蜡烛不画，而不是画成 0。
 */
export function readOhlc(raw: unknown, option: CandleFieldOptions = {}): Ohlc | null {
  if (Array.isArray(raw)) {
    if (raw.length < 4) return null;
    const o = toNumber(raw[0]);
    const c = toNumber(raw[1]);
    const l = toNumber(raw[2]);
    const h = toNumber(raw[3]);
    if (o === null || c === null || l === null || h === null) return null;
    return [o, c, l, h];
  }
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as CandleDatum;
  const o = readField(item, option.openField, 'open', CANDLE_FIELDS.open);
  const c = readField(item, option.closeField, 'close', CANDLE_FIELDS.close);
  const l = readField(item, option.lowField, 'low', CANDLE_FIELDS.low);
  const h = readField(item, option.highField, 'high', CANDLE_FIELDS.high);
  if (o === null || c === null || l === null || h === null) return null;
  return [o, c, l, h];
}

/** 该数据项读得出四个价吗（给校验 / 诊断用）。 */
export function hasOhlc(raw: unknown, option: CandleFieldOptions = {}): boolean {
  return readOhlc(raw, option) !== null;
}
