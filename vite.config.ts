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
        version: '0.1.0',
        description: '只显示已关注 UP 主的视频投稿',
        match: ['https://www.bilibili.com/*'],
        'run-at': 'document-start',
      },
      build: { fileName: 'bili-follow-feed.user.js' },
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
