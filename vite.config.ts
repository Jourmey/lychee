import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// lychee —— 独立课堂授课场景 demo。file: 引用 OpenMAIC 的 @openmaic/renderer / @openmaic/dsl。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // @openmaic/renderer 已构建为 ESM,直接消费 dist,无需转译其源码
  optimizeDeps: {
    exclude: ['@openmaic/renderer', '@openmaic/dsl'],
  },
  server: {
    port: 5173,
  },
});
