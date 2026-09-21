import { getSeriesTypeFactory, registerSeriesType } from '@damoqiongqiu/ice-chart';
import { CandlestickSeries } from './series/CandlestickSeries';

/** 系列类型名。与 ice-chart 0.28 之前的内置名保持一致：用户的 option 不用改。 */
export const CANDLESTICK_TYPE = 'candlestick';

/**
 * 把 K 线系列注册进 ice-chart。
 *
 * 幂等：重复调用直接返回。若宿主装的是**还没摘掉内置 candlestick 的旧版 ice-chart**
 * （≤0.27.x），这里会检测到已有工厂并直接沿用内置实现 —— 不会去覆盖内置类型
 * （ice-chart 的 `registerSeriesType` 对内置名是抛错的）。
 */
export function registerTradingSeries(): void {
  if (getSeriesTypeFactory(CANDLESTICK_TYPE)) return;
  registerSeriesType(CANDLESTICK_TYPE, (series, props) => new CandlestickSeries(series, props));
}
