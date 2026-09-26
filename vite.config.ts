import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import monkey from 'vite-plugin-monkey';

const REPO = 'https://github.com/Chasingnothing/bili-follow-feed';
/** 构建产物提交在仓库里，所以 raw 链接可以直接作为安装/更新地址。 */
const DIST_RAW =
  'https://raw.githubusercontent.com/Chasingnothing/bili-follow-feed/main/dist/bili-follow-feed.user.js';

export default defineConfig({
  plugins: [
    react(),
    monkey({
      entry: 'src/main.tsx',
      userscript: {
        name: 'B站 只看关注',
        namespace: REPO,
        version: '1.0.1',
        description:
          '只显示已关注 UP 主的内容：把关注动态流渲染成按分组组织的卡片墙，绕开首页推荐流（视频 + 图文）',
        author: 'Chasingnothing',
        license: 'MIT',
        homepageURL: REPO,
        supportURL: `${REPO}/issues`,
        // 用户脚本的自动更新入口。少了这两个字段，装了的人会永远停在旧版 ——
        // 你修了 bug 他们也不知道。
        updateURL: DIST_RAW,
        downloadURL: DIST_RAW,
        // 收窄到单一路径，其他 B站 页面完全不加载本脚本。
        // 2026-09-11 实测：B站 对该未知路径不重定向也不改写 URL，只在原地址渲染 404 页。
        match: ['https://www.bilibili.com/agent-feed*'],
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
