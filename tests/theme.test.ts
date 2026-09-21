import {
  applyTerminalTheme,
  DARK_TERMINAL_THEME,
  LIGHT_TERMINAL_THEME,
  resolveTerminalTheme,
  terminalThemeToChartTheme,
  TERMINAL_THEME_VARS,
} from '../src/index';

/**
 * 终端主题：一套 token 驱动**三处**外观 —— 图表（→ ice-chart 的 ChartTheme → ice-render 引擎主题）、
 * 外围组件（盘口）、页面外壳（CSS 变量）。这组用例钉的就是「映射关系」与「变量名契约」。
 */
describe('终端主题（TerminalTheme）', () => {
  it('预设：深色默认、浅色只翻明暗、自定义片段按字段覆盖', () => {
    expect(resolveTerminalTheme()).toEqual(DARK_TERMINAL_THEME);
    expect(resolveTerminalTheme('dark')).toEqual(DARK_TERMINAL_THEME);
    expect(resolveTerminalTheme('light')).toEqual(LIGHT_TERMINAL_THEME);
    expect(resolveTerminalTheme('light').background).toBe('#ffffff');
    // 深浅两套共享同一份「语义」：涨跌色、品牌色、字体
    expect(LIGHT_TERMINAL_THEME.up).toBe(DARK_TERMINAL_THEME.up);
    expect(LIGHT_TERMINAL_THEME.down).toBe(DARK_TERMINAL_THEME.down);
    expect(LIGHT_TERMINAL_THEME.accent).toBe(DARK_TERMINAL_THEME.accent);
    expect(LIGHT_TERMINAL_THEME.monoFamily).toBe(DARK_TERMINAL_THEME.monoFamily);

    const custom = resolveTerminalTheme({ accent: '#ff00ff' });
    expect(custom.accent).toBe('#ff00ff');
    // 其余字段沿用深色预设
    expect(custom.background).toBe(DARK_TERMINAL_THEME.background);
  });

  it('映射到图表主题：背景 / 轴 / 网格 / 提示框 / 准星都从 token 来，数字字体给等宽', () => {
    const theme = terminalThemeToChartTheme(LIGHT_TERMINAL_THEME);
    expect(theme.backgroundColor).toBe(LIGHT_TERMINAL_THEME.background);
    expect(theme.axisLabelColor).toBe(LIGHT_TERMINAL_THEME.axisLabel);
    expect(theme.axisLineColor).toBe(LIGHT_TERMINAL_THEME.axisLine);
    expect(theme.splitLineColor).toBe(LIGHT_TERMINAL_THEME.grid);
    expect(theme.fontFamily).toBe(LIGHT_TERMINAL_THEME.monoFamily);
    expect(theme.fontSize).toBe(LIGHT_TERMINAL_THEME.fontSize);
    expect(theme.tooltip!.background).toBe(LIGHT_TERMINAL_THEME.panel2);
    expect(theme.tooltip!.borderColor).toBe(LIGHT_TERMINAL_THEME.line);
    expect(theme.crosshair!.lineColor).toBe(LIGHT_TERMINAL_THEME.ruler);
    expect(theme.selection!.stroke).toBe(LIGHT_TERMINAL_THEME.accent);
  });

  it('落到 CSS 变量：变量名契约（页面样式表按这些名字读）', () => {
    const root = document.createElement('div');
    applyTerminalTheme(LIGHT_TERMINAL_THEME, root);
    expect(root.style.getPropertyValue(TERMINAL_THEME_VARS.background)).toBe('#ffffff');
    expect(root.style.getPropertyValue(TERMINAL_THEME_VARS.panel)).toBe(LIGHT_TERMINAL_THEME.panel);
    expect(root.style.getPropertyValue(TERMINAL_THEME_VARS.up)).toBe(LIGHT_TERMINAL_THEME.up);
    expect(root.style.getPropertyValue(TERMINAL_THEME_VARS.accent)).toBe(LIGHT_TERMINAL_THEME.accent);
    expect(root.style.getPropertyValue(TERMINAL_THEME_VARS.monoFamily)).toBe(LIGHT_TERMINAL_THEME.monoFamily);

    // 再换深色：同一组变量被覆盖，页面不必重建 DOM
    applyTerminalTheme(DARK_TERMINAL_THEME, root);
    expect(root.style.getPropertyValue(TERMINAL_THEME_VARS.background)).toBe(DARK_TERMINAL_THEME.background);
  });
});
