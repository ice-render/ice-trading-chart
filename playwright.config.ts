import { defineConfig } from '@playwright/test';

/**
 * 家族端口分配（单一来源：`ice-render/AGENTS.md` §家族 e2e / 预览端口分配）：
 * ice-render 8090 · entity-designer 8091 · smart-water 8092 · web-components 8093 ·
 * render-dsl 8094 · entity-designer-react-demo 8095 · chart 5177 · chart-dsl 8096 ·
 * entity-designer-dsl 8097 · game 8098 · agent-console 8099/8100 · web-components-dsl 8101 ·
 * **trading-chart 8102**。
 *
 * `reuseExistingServer` 一律 false：端口被别的仓占着时要响亮失败，不能静默复用别人的目录。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  reporter: [['list']],
  webServer: {
    command: 'npx http-server . -p 8102 -c-1 --silent',
    port: 8102,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:8102',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  },
});
