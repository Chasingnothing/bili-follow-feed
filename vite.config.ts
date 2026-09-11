import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import monkey from 'vite-plugin-monkey';

export default defineConfig({
  plugins: [
    react(),
    monkey({
      entry: 'src/main.tsx',
      userscript: {
        name: 'B站 只看关注',
        namespace: 'local.bili-follow-feed',
        version: '0.1.1',
        description: '只显示已关注 UP 主的视频投稿',
        match: ['https://www.bilibili.com/*'],
        'run-at': 'document-start',
      },
      build: { fileName: 'bili-follow-feed.user.js' },
    }),
  ],
  // Vite 8 / Rolldown 下产物默认没有被压缩（实测 588 KB，变量名与缩进都保留）。
  // 用户脚本会在每个 bilibili.com 页面加载，体积直接等于页面开销，必须显式压缩。
  build: {
    minify: true,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
