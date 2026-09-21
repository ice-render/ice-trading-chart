import { createChart } from '@damoqiongqiu/ice-chart';
import { createOhlcTooltipFormatter } from '../src/tooltip';
import { createOrderBook } from '../src/orderBook';
import {
  createIntlNumberFormat,
  createTradingChart,
  resolveTerminalMessages,
  toTradingOption,
  ZH_TERMINAL_MESSAGES,
} from '../src/index';
import type { TradingChartOption } from '../src/types';

/**
 * 文案目录 + 数字格式化：**库渲染的每一句话与每一个数字**都从这里出。
 *
 * 外部使用方接入 i18n 只需要做两件事：换一份目录、换一个数字格式（`Intl.NumberFormat` 也行）。
 */
const CANDLE: TradingChartOption = {
  legend: { show: false },
  animation: { enabled: false },
  xAxis: { type: 'category' },
  yAxis: { position: 'right' },
  series: [
    {
      id: 'k',
      type: 'candlestick',
      data: [
        { x: 'D1', o: 100, c: 110, l: 95, h: 115, v: 1200 },
        { x: 'D2', o: 110, c: 105, l: 100, h: 118, v: 2400 },
      ],
    },
  ],
};

describe('文案目录（TerminalMessages）', () => {
  it('默认中文；`en` 预设换英文；自定义片段**按分组深合并**', () => {
    expect(resolveTerminalMessages().tooltip.open).toBe(ZH_TERMINAL_MESSAGES.tooltip.open);
    expect(resolveTerminalMessages('en').tooltip).toEqual({
      open: 'Open',
      high: 'High',
      low: 'Low',
      close: 'Close',
      volume: 'Vol',
    });
    // 只覆盖一个字段：同组其余字段保留
    const patched = resolveTerminalMessages({ tooltip: { open: '开盘' } });
    expect(patched.tooltip.open).toBe('开盘');
    expect(patched.tooltip.close).toBe(ZH_TERMINAL_MESSAGES.tooltip.close);
    expect(patched.orderBook.price).toBe(ZH_TERMINAL_MESSAGES.orderBook.price);
  });

  it('提示框：行名、数字格式、量格式三处都能注入', () => {
    const formatter = createOhlcTooltipFormatter({
      seriesOption: CANDLE.series[0],
      messages: 'en',
      pricePrecision: 2,
      numberFormat: (value, precision) => `#${Number(value).toFixed(precision ?? 0)}`,
      volumeFormat: (value) => `v:${value}`,
      volumeSeriesId: 'vol',
    });
    const rows = formatter({
      items: [
        { seriesType: 'candlestick', data: { x: 'D1', o: 100, c: 110, l: 95, h: 115 }, color: '#f00' },
        { seriesId: 'vol', value: 1200, color: '#888' },
      ],
    } as any);
    expect(rows!.rows.map((row) => row.name)).toEqual(['Open', 'High', 'Low', 'Close', 'Vol']);
    expect(rows!.rows.map((row) => row.value)).toEqual(['#100.00', '#115.00', '#95.00', '#110.00', 'v:1200']);
  });

  it('按 locale 的数字格式：千分位与小数分隔符跟着 locale 走', () => {
    const de = createIntlNumberFormat('de-DE');
    expect(de(42300.5, 2)).toBe('42.300,50');
    const en = createIntlNumberFormat('en-US');
    expect(en(42300.5, 2)).toBe('42,300.50');
    // 非法 locale 不抛，退回默认格式
    const broken = createIntlNumberFormat('!!not-a-locale');
    expect(broken(42300.5, 2)).toBe('42,300.50');
  });

  it('toTradingOption：目录喂给提示框、数字格式喂给价格轴', () => {
    const option = toTradingOption(CANDLE, {
      messages: 'en',
      pricePrecision: 2,
      numberFormat: (value, precision) => `${Number(value).toFixed(precision ?? 0)}€`,
    });
    const axis = Array.isArray(option.yAxis) ? option.yAxis[0] : option.yAxis!;
    expect((axis.formatter as (value: number) => string)(100)).toBe('100.00€');
    const formatter = option.tooltip!.formatter as any;
    const rows = formatter({
      items: [{ seriesType: 'candlestick', data: { x: 'D1', o: 100, c: 110, l: 95, h: 115 }, color: '#f00' }],
    });
    // 目录换了英文、数字格式也跟着换
    expect(rows.rows[0].name).toBe('Open');
    expect(rows.rows[0].value).toBe('100.00€');

    // 真建一张图也不炸（目录 / 格式一路走到引擎）
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const chart = createTradingChart(canvas, CANDLE, { messages: 'en', pricePrecision: 2 });
    expect(chart.layout.plot.width).toBeGreaterThan(0);
    chart.destroy();
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    createChart(canvas, toTradingOption(CANDLE, { messages: 'en' })).destroy();
  });

  it('盘口：表头走目录（`labels` 优先）', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const book = createOrderBook(host, { levels: 1, messages: 'en' });
    book.update({ asks: [{ price: 101, size: 1 }], bids: [{ price: 99, size: 1 }] });
    expect(Array.from(host.querySelectorAll('.ice-book-head span')).map((node) => node.textContent)).toEqual([
      'Price',
      'Size',
      'Total',
    ]);
    book.destroy();

    const host2 = document.createElement('div');
    document.body.appendChild(host2);
    const book2 = createOrderBook(host2, { levels: 1, messages: 'en', labels: { price: '价格 (USDT)' } });
    book2.update({ asks: [{ price: 101, size: 1 }], bids: [{ price: 99, size: 1 }] });
    expect((host2.querySelector('.ice-book-head span') as HTMLElement).textContent).toBe('价格 (USDT)');
    book2.destroy();
  });
});
