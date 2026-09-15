import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * 部署前缀（nginx 按路径切分用）。构建产物里所有资源都挂在 `<base>assets/...` 下。
 * 改了这里，dev 地址也一起变成 `http://localhost:5173/lychee/`（刻意跟生产保持一致，
 * 免得出现「只有线上才炸」的路径 bug）。
 */
const BASE = '/lychee/';

// lychee —— 独立课堂授课场景 demo。file: 引用 OpenMAIC 的 @openmaic/renderer / @openmaic/dsl。
export default defineConfig({
  base: BASE,
  plugins: [react(), tailwindcss()],
  // @openmaic/renderer 已构建为 ESM,直接消费 dist,无需转译其源码
  optimizeDeps: {
    exclude: ['@openmaic/renderer', '@openmaic/dsl'],
  },
  server: {
    port: 5173,
  },
});
