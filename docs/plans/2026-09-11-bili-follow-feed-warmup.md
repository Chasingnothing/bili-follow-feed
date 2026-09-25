# B站「只看关注」视频墙（热身版）实施计划

> **REQUIRED SUB-SKILL:** 执行本计划时使用 `executing-plans` skill，逐任务推进。

**Goal:** 交付一个单文件 Chrome userscript，在 `https://www.bilibili.com/#/my-feed` 渲染只包含已关注 UP 主视频投稿的卡片墙，点击跳转 B站 原视频页。

**Architecture:** 脚本运行在 `bilibili.com` 域下，直接 `fetch` B站 动态聚合流接口（靠浏览器会话携带登录态，不接触 Cookie）。数据经纯函数映射为 `VideoCard`，由 React 渲染；数据访问抽象为 `FeedDataSource` 接口，使同一套 UI 组件后续可直接复用到路线 1 的后端实现。

**Tech Stack:** TypeScript · React 19 · Vite 8 · vite-plugin-monkey · Vitest 5

> **实际安装版本（2026-09-11）**：react 19.3.0、vite 8.3.0、vitest 5.0.0、typescript 7.0.2、vite-plugin-monkey 8.1.1、jsdom 29.1.1。计划正文中如提到 React 18，以本行为准。

> **Task 1 已执行完毕**：探针返回 `code = 0`，接口可用、无需签名、翻页正常。同时实测发现设计文档三处字段错误（`stat.play` 是**字符串**、`cover` 是 **`http://`**、`archive.pubdate` **不存在**），已回写设计文档 §6。**Task 3 的 fixture 必须按修正后的字段表编写。**

**设计依据:** [`docs/superpowers/specs/2026-09-11-bili-follow-feed-design.md`](../superpowers/specs/2026-09-11-bili-follow-feed-design.md)

---

## 环境约束（历史记录）

> ⚠️ **这一节记的是当时那台开发机的约束，与使用者无关，已脱敏。**
> 当年的代理地址、沙箱策略、会话快照等都已移除，只留对理解本仓库仍然有用的部分。

- **`git add` 的行尾转换会改写工作区文件**，触发编辑工具的"文件自读取后已被修改"误报。
  已加 `.gitattributes`（`* -text`）止住。
- **`tsc` 的 `noUnusedLocals` 开着**：测试文件里的未使用 import 会导致构建失败。
- **Windows 下 `Get-Content` 会静默少数行**（按系统 ANSI 解码 UTF-8 时会吞掉换行）。
  数行数请用 `[System.IO.File]::ReadAllLines($绝对路径)`。
- **`.NET` 静态调用解析相对路径是相对进程 CWD，不是 PowerShell 的 location** ——
  一律传绝对路径，否则会出现"检查通过"其实文件根本没被读到的假通过。

所有命令在**仓库根目录**执行。

---

## Task 0: 安装 git 并初始化仓库

**为什么需要**：本计划含高频提交，用于形成可回滚的安全点。git 未安装则无法执行。**涉及系统级安装，执行前应先取得确认。**

**Step 1: 确认可以安装 git**

若被拒绝，跳过本任务，并在后续所有 "Commit" 步骤改为人工确认检查点。

**Step 2: 安装 git**

```powershell
$env:PATH = "$([Environment]::GetEnvironmentVariable('Path','User'));$([Environment]::GetEnvironmentVariable('Path','Machine'))"
winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
```

Expected: `已成功安装`

**Step 3: 验证（需重新注入 PATH）**

```powershell
$env:PATH = "$([Environment]::GetEnvironmentVariable('Path','User'));$([Environment]::GetEnvironmentVariable('Path','Machine'))"
git --version
```

Expected: `git version 2.x.x`

**Step 4: 初始化仓库**

```powershell
cd <项目根目录>
git init
```

Expected: `Initialized empty Git repository in <项目目录>/.git/`

**Step 5: 创建 `.gitignore`**

```gitignore
node_modules/
dist/
*.local
.DS_Store
```

**Step 6: 首次提交**

```powershell
git add -A
git commit -m "chore: init repo with design spec"
```

Expected: 提交成功，含 `docs/superpowers/specs/2026-09-11-bili-follow-feed-design.md`

---

## Task 1: 验证动态流接口可用性（硬门禁）

**这是整个方案的前置假设。验证失败则须回到设计阶段换接口。**

**Files:**
- Create: `docs/probe/feed-response-sample.json`（保存真实响应样本，供后续测试 fixture 使用）

**Step 1: 请用户在 Chrome 中执行探针**

指导用户：登录 B站 → 打开 `https://www.bilibili.com/` → F12 → Console → 粘贴执行：

```js
const r = await fetch(
  'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all' +
  '?type=all&page=1&timezone_offset=-480&platform=web&web_location=333.1387',
  { credentials: 'include' }
).then(r => r.json());
console.log('code:', r.code, 'msg:', r.message);
console.log('items:', r.data?.items?.length, 'has_more:', r.data?.has_more, 'offset:', r.data?.offset);
console.log('types:', [...new Set(r.data?.items?.map(i => i.type))]);
console.log(JSON.stringify(r.data?.items?.[0], null, 2));
```

**Step 2: 判定分支**

| 结果 | 动作 |
|---|---|
| `code === 0` 且有 `items` | 继续 Step 3 |
| `code === -352` 或提示风控/签名 | 需要补充 `bili_ticket` 或 WBI 签名 → **停止，回到设计讨论** |
| `code === -101` 未登录 | 用户未登录，重试 |
| 其他非 0 | 记录 `message`，**停止，回到设计讨论** |

**Step 3: 核对字段路径**

对照设计文档 §6 字段映射表，确认以下路径真实存在：

- `items[].type` —— 视频投稿的实际取值（预期 `DYNAMIC_TYPE_AV`）
- `items[].modules.module_dynamic.major.archive.{cover,title,duration_text,bvid,pubdate,stat.play}`
- `items[].modules.module_author.{mid,name,face}`

**Step 4: 保存样本**

把响应的前 3 条 item 保存为 `docs/probe/feed-response-sample.json`（需脱敏：删除 `module_author.face` 等可识别信息可选保留）。此文件是 Task 3 测试的 fixture 来源。

**Step 5: Commit**

```powershell
git add docs/probe/
git commit -m "docs: add verified dynamic feed response sample"
```

---

## Task 2: 项目脚手架

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`

**Step 1: （本机环境相关，已不适用）**

> 原始计划里这一步是"让 npm 走本机代理并写入项目内 `.npmrc`"。
> 那是开发机特有的网络配置，**已从仓库移除**（`.npmrc` 现在在 `.gitignore` 里）——
> 提交上去的话别人 `npm install` 会去连一个不存在的本地代理而失败。
> 在当前仓库里这一步**不需要执行**。

**Step 2: 创建 `package.json`**

```json
{
  "name": "bili-follow-feed",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

**Step 3: 安装依赖**

```powershell
npm install react react-dom
npm install -D vite @vitejs/plugin-react typescript vite-plugin-monkey vitest @types/react @types/react-dom
```

Expected: `added N packages`，无 `ECONNRESET`/`ETIMEDOUT`

**Step 4: 创建 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src"]
}
```

**Step 5: 创建 `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
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
});
```

**Step 6: 创建 `src/main.tsx` 最小骨架**

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const HASH = '#/my-feed';

function mount(): boolean {
  if (location.hash !== HASH) return false;
  if (document.getElementById('bff-root')) return true;

  const host = document.createElement('div');
  host.id = 'bff-root';
  document.documentElement.appendChild(host);
  createRoot(host).render(<React.StrictMode><App /></React.StrictMode>);
  return true;
}

mount();
window.addEventListener('hashchange', mount);
```

**Step 7: 创建 `src/App.tsx` 占位**

```tsx
export default function App() {
  return <div style={{ padding: 24, color: '#fff', background: '#18191c', minHeight: '100vh' }}>
    <h1>只看关注 — 骨架就绪</h1>
  </div>;
}
```

**Step 8: 验证构建通过**

```powershell
npm run build
```

Expected: 生成 `dist/bili-follow-feed.user.js`，无 TS 错误

**Step 9: Commit**

```powershell
git add -A
git commit -m "chore: scaffold vite + react + userscript build"
```

---

## Task 3: 类型定义与动态流映射（TDD）

**Files:**
- Create: `src/types.ts`, `src/lib/mapDynamic.ts`, `src/lib/mapDynamic.test.ts`
- Fixture: `src/lib/__fixtures__/items.ts`

**Step 1: 创建 `src/types.ts`**

```ts
export interface VideoCard {
  bvid: string;
  title: string;
  cover: string;
  durationText: string;
  play: number;
  danmaku: number;
  pubdate: number;
  upMid: number;
  upName: string;
  upFace: string;
  url: string;
}

export interface FeedPage {
  items: VideoCard[];
  nextOffset: string | null;
  hasMore: boolean;
}
```

**Step 2: 写失败的测试 `src/lib/mapDynamic.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mapDynamicToCard } from './mapDynamic';
import { avItem, nonVideoItem } from './__fixtures__/items';

describe('mapDynamicToCard', () => {
  it('从 DYNAMIC_TYPE_AV 条目提取卡片字段', () => {
    const card = mapDynamicToCard(avItem);
    expect(card).not.toBeNull();
    expect(card!.bvid).toBe('BV1xx411c7mD');
    expect(card!.title).toBe('测试视频标题');
    expect(card!.upName).toBe('测试UP主');
    expect(card!.play).toBe(12345);
    expect(card!.url).toBe('https://www.bilibili.com/video/BV1xx411c7mD');
  });

  it('非视频动态返回 null', () => {
    expect(mapDynamicToCard(nonVideoItem)).toBeNull();
  });

  it('字段缺失时不抛异常，返回 null', () => {
    expect(mapDynamicToCard({ type: 'DYNAMIC_TYPE_AV' } as any)).toBeNull();
  });
});
```

**Step 3: 创建 fixture `src/lib/__fixtures__/items.ts`**

用 Task 1 保存的真实样本结构为准（下方为预期结构，**必须按真实样本校正**）：

```ts
export const avItem = {
  type: 'DYNAMIC_TYPE_AV',
  modules: {
    module_author: { mid: 12345, name: '测试UP主', face: 'https://i0.hdslb.com/bfs/face/x.jpg' },
    module_dynamic: {
      major: {
        archive: {
          bvid: 'BV1xx411c7mD',
          title: '测试视频标题',
          cover: 'https://i0.hdslb.com/bfs/archive/x.jpg',
          duration_text: '12:34',
          pubdate: 1757500000,
          stat: { play: 12345, danmaku: 67 },
        },
      },
    },
  },
};

export const nonVideoItem = { type: 'DYNAMIC_TYPE_DRAW', modules: {} };
```

**Step 4: 运行测试确认失败**

```powershell
npm test -- mapDynamic
```

Expected: FAIL —— `mapDynamicToCard is not a function` 或模块不存在

**Step 5: 实现 `src/lib/mapDynamic.ts`**

```ts
import type { VideoCard } from '../types';

export function mapDynamicToCard(item: any): VideoCard | null {
  try {
    if (item?.type !== 'DYNAMIC_TYPE_AV') return null;
    const archive = item.modules?.module_dynamic?.major?.archive;
    const author = item.modules?.module_author;
    if (!archive?.bvid || !author?.mid) return null;

    return {
      bvid: archive.bvid,
      title: archive.title ?? '',
      cover: archive.cover ?? '',
      durationText: archive.duration_text ?? '',
      play: archive.stat?.play ?? 0,
      danmaku: archive.stat?.danmaku ?? 0,
      pubdate: archive.pubdate ?? 0,
      upMid: author.mid,
      upName: author.name ?? '',
      upFace: author.face ?? '',
      url: `https://www.bilibili.com/video/${archive.bvid}`,
    };
  } catch {
    return null;
  }
}
```

**Step 6: 运行测试确认通过**

```powershell
npm test -- mapDynamic
```

Expected: PASS —— 3 passed

**Step 7: Commit**

```powershell
git add src/types.ts src/lib/
git commit -m "feat: map bilibili dynamic items to video cards"
```

---

## Task 4: 格式化工具（TDD）

**Files:**
- Create: `src/lib/format.ts`, `src/lib/format.test.ts`

**Step 1: 写失败的测试**

```ts
import { describe, it, expect } from 'vitest';
import { formatPlay, formatRelativeTime } from './format';

describe('formatPlay', () => {
  it('小于 1 万原样输出', () => expect(formatPlay(9999)).toBe('9999'));
  it('大于等于 1 万用万', () => expect(formatPlay(12345)).toBe('1.2万'));
  it('大于等于 1 亿用亿', () => expect(formatPlay(123456789)).toBe('1.2亿'));
});

describe('formatRelativeTime', () => {
  const now = 1_757_500_000_000;
  it('一小时内显示分钟', () => expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5分钟前'));
  it('一天内显示小时', () => expect(formatRelativeTime(now - 3 * 3600_000, now)).toBe('3小时前'));
  it('三十天内显示天', () => expect(formatRelativeTime(now - 2 * 86400_000, now)).toBe('2天前'));
  it('超过三十天显示日期', () => expect(formatRelativeTime(now - 40 * 86400_000, now)).toMatch(/^\d{4}-\d{2}-\d{2}$/));
});
```

**Step 2: 运行确认失败**

```powershell
npm test -- format
```

Expected: FAIL

**Step 3: 实现 `src/lib/format.ts`**

```ts
export function formatPlay(n: number): string {
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return String(n);
}

export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const diff = now - ts;
  const MIN = 60_000, HOUR = 3600_000, DAY = 86400_000;
  if (diff < HOUR) return Math.max(1, Math.floor(diff / MIN)) + '分钟前';
  if (diff < DAY) return Math.floor(diff / HOUR) + '小时前';
  if (diff < 30 * DAY) return Math.floor(diff / DAY) + '天前';
  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
```

**Step 4: 运行确认通过**

```powershell
npm test -- format
```

Expected: PASS —— 7 passed

**Step 5: Commit**

```powershell
git add src/lib/format.ts src/lib/format.test.ts
git commit -m "feat: add play count and relative time formatters"
```

---

## Task 5: 已读状态管理（TDD）

**Files:**
- Create: `src/lib/readState.ts`, `src/lib/readState.test.ts`

**Step 1: 写失败的测试**

使用 Vitest 的内存版 localStorage（`vitest` 环境设为 `jsdom` 或在测试内 stub）。

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadRead, saveRead, markRead, markAllRead, loadLastVisit, saveLastVisit } from './readState';

beforeEach(() => localStorage.clear());

describe('readState', () => {
  it('初始为空集合', () => expect(loadRead().size).toBe(0));
  it('markRead 后持久化', () => {
    const s = markRead(loadRead(), 'BV1');
    saveRead(s);
    expect(loadRead().has('BV1')).toBe(true);
  });
  it('markAllRead 批量写入', () => {
    saveRead(markAllRead(['BV1', 'BV2']));
    expect(loadRead().size).toBe(2);
  });
  it('lastVisit 往返', () => {
    saveLastVisit(123);
    expect(loadLastVisit()).toBe(123);
  });
  it('损坏数据不抛异常', () => {
    localStorage.setItem('bff:readVideos', '{not json');
    expect(loadRead().size).toBe(0);
  });
});
```

> 需在 `vite.config.ts` 增加 `test: { environment: 'jsdom' }`，并 `npm i -D jsdom`。

**Step 2: 运行确认失败**

```powershell
npm test -- readState
```

Expected: FAIL

**Step 3: 实现 `src/lib/readState.ts`**

```ts
const READ_KEY = 'bff:readVideos';
const VISIT_KEY = 'bff:lastVisitAt';

export function loadRead(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

export function saveRead(s: Set<string>): void {
  localStorage.setItem(READ_KEY, JSON.stringify([...s]));
}

export function markRead(s: Set<string>, bvid: string): Set<string> {
  const next = new Set(s);
  next.add(bvid);
  return next;
}

export function markAllRead(bvids: string[]): Set<string> {
  return new Set(bvids);
}

export function loadLastVisit(): number {
  const raw = localStorage.getItem(VISIT_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

export function saveLastVisit(ts: number): void {
  localStorage.setItem(VISIT_KEY, String(ts));
}
```

**Step 4: 运行确认通过**

```powershell
npm test -- readState
```

Expected: PASS —— 5 passed

**Step 5: Commit**

```powershell
git add src/lib/readState.ts src/lib/readState.test.ts vite.config.ts package.json
git commit -m "feat: add localStorage-backed read state"
```

---

## Task 6: FeedDataSource 与站内实现（TDD）

**Files:**
- Create: `src/data/source.ts`, `src/data/inPage.ts`, `src/data/inPage.test.ts`

**Step 1: 写失败的测试**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { InPageDataSource } from './inPage';
import { avItem } from '../lib/__fixtures__/items';

afterEach(() => vi.restoreAllMocks());

describe('InPageDataSource', () => {
  it('请求正确 URL 且带 credentials', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 0, data: { items: [avItem], has_more: false, offset: '' } }))
    );
    const src = new InPageDataSource();
    const page = await src.fetchPage(null);
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0]).toContain('/x/polymer/web-dynamic/v1/feed/all');
    expect((spy.mock.calls[0][1] as RequestInit).credentials).toBe('include');
    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(false);
  });

  it('非 0 code 抛错', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: -352, message: '风控' }))
    );
    await expect(new InPageDataSource().fetchPage(null)).rejects.toThrow(/风控/);
  });

  it('过滤掉非视频动态', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 0, data: { items: [{ type: 'DYNAMIC_TYPE_DRAW' }], has_more: false } }))
    );
    const page = await new InPageDataSource().fetchPage(null);
    expect(page.items).toHaveLength(0);
  });
});
```

**Step 2: 运行确认失败**

```powershell
npm test -- inPage
```

Expected: FAIL

**Step 3: 实现 `src/data/source.ts`**

```ts
import type { FeedPage } from '../types';

export interface FeedDataSource {
  fetchPage(offset: string | null): Promise<FeedPage>;
}
```

**Step 4: 实现 `src/data/inPage.ts`**

```ts
import type { FeedDataSource } from './source';
import type { FeedPage } from '../types';
import { mapDynamicToCard } from '../lib/mapDynamic';

const ENDPOINT = 'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all';

export class InPageDataSource implements FeedDataSource {
  async fetchPage(offset: string | null): Promise<FeedPage> {
    const params = new URLSearchParams({
      type: 'all',
      page: '1',
      timezone_offset: '-480',
      platform: 'web',
      web_location: '333.1387',
      features: 'itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote',
    });
    if (offset) params.set('offset', offset);

    const res = await fetch(`${ENDPOINT}?${params}`, { credentials: 'include' });
    const json = await res.json();

    if (json.code !== 0) {
      throw new Error(`B站接口返回 ${json.code}: ${json.message ?? '未知错误'}`);
    }

    const items = (json.data?.items ?? [])
      .map(mapDynamicToCard)
      .filter((c): c is NonNullable<typeof c> => c !== null);

    return {
      items,
      nextOffset: json.data?.offset || null,
      hasMore: Boolean(json.data?.has_more),
    };
  }
}
```

**Step 5: 运行确认通过**

```powershell
npm test -- inPage
```

Expected: PASS —— 3 passed

**Step 6: Commit**

```powershell
git add src/data/
git commit -m "feat: add FeedDataSource with in-page bilibili implementation"
```

---

## Task 7: 视频卡片与网格组件

**Files:**
- Create: `src/components/VideoCard.tsx`, `src/components/VideoGrid.tsx`, `src/styles.css`

**Step 1: 创建 `src/components/VideoCard.tsx`**

```tsx
import type { VideoCard as Card } from '../types';
import { formatPlay, formatRelativeTime } from '../lib/format';

interface Props {
  card: Card;
  read: boolean;
  isNew: boolean;
  onOpen: (card: Card) => void;
}

export default function VideoCard({ card, read, isNew, onOpen }: Props) {
  return (
    <a
      className={`bff-card${read ? ' bff-card--read' : ''}`}
      href={card.url}
      target="_blank"
      rel="noreferrer"
      onClick={() => onOpen(card)}
    >
      <div className="bff-cover-wrap">
        {/* referrerpolicy 绕开 i0.hdslb.com 防盗链 */}
        <img className="bff-cover" src={card.cover} alt="" loading="lazy" referrerPolicy="no-referrer" />
        <span className="bff-duration">{card.durationText}</span>
        {isNew && <span className="bff-new">NEW</span>}
      </div>
      <div className="bff-title">{card.title}</div>
      <div className="bff-meta">
        <img className="bff-face" src={card.upFace} alt="" referrerPolicy="no-referrer" />
        <span className="bff-up">{card.upName}</span>
      </div>
      <div className="bff-sub">{formatPlay(card.play)}播放 · {formatRelativeTime(card.pubdate * 1000)}</div>
    </a>
  );
}
```

**Step 2: 创建 `src/components/VideoGrid.tsx`**

```tsx
import type { VideoCard as Card } from '../types';
import VideoCard from './VideoCard';

interface Props {
  cards: Card[];
  readSet: Set<string>;
  lastVisit: number;
  onOpen: (card: Card) => void;
}

export default function VideoGrid({ cards, readSet, lastVisit, onOpen }: Props) {
  if (cards.length === 0) return <div className="bff-empty">没有可显示的视频</div>;
  return (
    <div className="bff-grid">
      {cards.map(c => (
        <VideoCard
          key={c.bvid}
          card={c}
          read={readSet.has(c.bvid)}
          isNew={c.pubdate * 1000 > lastVisit}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
```

**Step 3: 创建 `src/styles.css`**

```css
.bff-root, .bff-root * { box-sizing: border-box; }
.bff-root {
  position: fixed; inset: 0; z-index: 2147483000;
  background: #18191c; color: #e3e5e7; overflow-y: auto;
  font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
}
.bff-bar {
  position: sticky; top: 0; z-index: 2; display: flex; gap: 12px; align-items: center;
  padding: 12px 24px; background: #1f2023; border-bottom: 1px solid #2b2c2f;
}
.bff-bar select, .bff-bar button {
  background: #2b2c2f; color: #e3e5e7; border: 1px solid #3a3b3e;
  border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 13px;
}
.bff-grid {
  display: grid; gap: 20px; padding: 20px 24px;
  grid-template-columns: repeat(4, 1fr);
}
@media (max-width: 1400px) { .bff-grid { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 900px)  { .bff-grid { grid-template-columns: repeat(2, 1fr); } }
.bff-card { display: block; text-decoration: none; color: inherit; }
.bff-card--read { opacity: .45; }
.bff-cover-wrap { position: relative; aspect-ratio: 16 / 10; border-radius: 8px; overflow: hidden; background: #2b2c2f; }
.bff-cover { width: 100%; height: 100%; object-fit: cover; display: block; }
.bff-duration {
  position: absolute; right: 6px; bottom: 6px; padding: 1px 5px; border-radius: 4px;
  background: rgba(0,0,0,.65); color: #fff; font-size: 12px;
}
.bff-new {
  position: absolute; left: 6px; top: 6px; padding: 1px 6px; border-radius: 4px;
  background: #fb7299; color: #fff; font-size: 11px; font-weight: 600;
}
.bff-title {
  margin-top: 8px; font-size: 14px; line-height: 1.4; height: 2.8em;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.bff-meta { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 12px; color: #9499a0; }
.bff-face { width: 18px; height: 18px; border-radius: 50%; }
.bff-sub { margin-top: 2px; font-size: 12px; color: #9499a0; }
.bff-empty { padding: 60px; text-align: center; color: #9499a0; }
```

**Step 4: 验证构建**

```powershell
npm run build
```

Expected: 无 TS 错误，产出 userscript

**Step 5: Commit**

```powershell
git add src/components/ src/styles.css
git commit -m "feat: add video card and grid components"
```

---

## Task 8: 主应用与工具条

**Files:**
- Modify: `src/App.tsx`

**Step 1: 实现 `src/App.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VideoCard } from './types';
import { InPageDataSource } from './data/inPage';
import { loadRead, saveRead, markRead, markAllRead, loadLastVisit, saveLastVisit } from './lib/readState';
import VideoGrid from './components/VideoGrid';
import './styles.css';

type SortKey = 'latest' | 'play';
type FilterKey = 'all' | 'unread';

export default function App() {
  const source = useMemo(() => new InPageDataSource(), []);
  const [cards, setCards] = useState<VideoCard[]>([]);
  const [offset, setOffset] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('latest');
  const [filter, setFilter] = useState<FilterKey>('all');

  const [readSet, setReadSet] = useState<Set<string>>(() => loadRead());
  const lastVisit = useRef(loadLastVisit()).current;

  const loadMore = useCallback(async (reset = false) => {
    setLoading(true);
    setError(null);
    try {
      const page = await source.fetchPage(reset ? null : offset);
      setCards(prev => {
        const merged = reset ? page.items : [...prev, ...page.items];
        // bvid 去重：动态流可能重复返回
        const seen = new Set<string>();
        return merged.filter(c => (seen.has(c.bvid) ? false : (seen.add(c.bvid), true)));
      });
      setOffset(page.nextOffset);
      setHasMore(page.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [source, offset]);

  useEffect(() => { void loadMore(true); }, []); // 仅首次

  const onOpen = useCallback((card: VideoCard) => {
    const next = markRead(readSet, card.bvid);
    setReadSet(next);
    saveRead(next);
  }, [readSet]);

  const visible = useMemo(() => {
    let list = filter === 'unread' ? cards.filter(c => !readSet.has(c.bvid)) : cards;
    list = [...list].sort((a, b) => (sort === 'play' ? b.play - a.play : b.pubdate - a.pubdate));
    return list;
  }, [cards, filter, readSet, sort]);

  return (
    <div className="bff-root">
      <div className="bff-bar">
        <strong>只看关注</strong>
        <select value={sort} onChange={e => setSort(e.target.value as SortKey)}>
          <option value="latest">最新发布</option>
          <option value="play">播放量最高</option>
        </select>
        <select value={filter} onChange={e => setFilter(e.target.value as FilterKey)}>
          <option value="all">全部</option>
          <option value="unread">未读</option>
        </select>
        <button onClick={() => { const s = markAllRead(cards.map(c => c.bvid)); setReadSet(s); saveRead(s); }}>
          全部标记已读
        </button>
        <button onClick={() => void loadMore(true)} disabled={loading}>刷新</button>
        <span style={{ marginLeft: 'auto', fontSize: 12, opacity: .6 }}>
          {visible.length} / {cards.length}
        </span>
      </div>

      {error && <div className="bff-empty">接口出错：{error}</div>}
      <VideoGrid cards={visible} readSet={readSet} lastVisit={lastVisit} onOpen={onOpen} />

      {hasMore && !error && (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <button className="bff-bar button" onClick={() => void loadMore(false)} disabled={loading}>
            {loading ? '加载中…' : '加载更多'}
          </button>
        </div>
      )}
    </div>
  );
}
```

**Step 2: 挂载点改为带 class 的容器**

修改 `src/main.tsx`：创建 host 时加 `host.className = 'bff-root-host'`。

**Step 3: 记录本次访问时间**

在 `App` 卸载时写入 `saveLastVisit(Date.now())`：

```tsx
useEffect(() => () => saveLastVisit(Date.now()), []);
```

**Step 4: 验证构建与测试**

```powershell
npm run build
npm test
```

Expected: 构建成功；全部测试通过

**Step 5: Commit**

```powershell
git add -A
git commit -m "feat: wire up app with toolbar, sorting and unread filter"
```

---

## Task 9: 入口接管与页面隔离

**Files:**
- Modify: `src/main.tsx`, `src/styles.css`

**风险点**：B站 是 SPA，可能抢走 hash 路由或重渲染覆盖我们的节点。

**Step 1: 隐藏原生内容并确保层级**

在 `styles.css` 增加：

```css
html.bff-active body > *:not(#bff-root) { display: none !important; }
```

**Step 2: 在 `main.tsx` 中切换 class**

```tsx
function activate(on: boolean) {
  document.documentElement.classList.toggle('bff-active', on);
}
```

`mount()` 中匹配到 hash 时 `activate(true)`，`hashchange` 离开时 `activate(false)` 并移除 host。

**Step 3: 用 MutationObserver 防止被 SPA 覆盖**

```tsx
const observer = new MutationObserver(() => {
  if (location.hash === HASH && !document.getElementById('bff-root')) mount();
});
observer.observe(document.documentElement, { childList: true });
```

**Step 4: 手动验证**

1. `npm run build`
2. Chrome 打开 `chrome://extensions` → 开启开发者模式 → 或直接在 Tampermonkey 中新建脚本粘贴 `dist/bili-follow-feed.user.js` 内容
3. 访问 `https://www.bilibili.com/#/my-feed`
4. Expected: 页面被自有卡片墙接管，B站 原生内容不可见

**Step 5: 若接管失败**

记录现象（是否有重定向、原生内容是否闪回），改为独立路径方案：`@match` 增加路径，脚本检测 `location.pathname === '/agent-feed'` 时接管 404 页。**此处若受挫，回写设计文档 §5。**

**Step 6: Commit**

```powershell
git add -A
git commit -m "feat: take over SPA route for the feed page"
```

---

## Task 10: 端到端验收

**Step 1: 安装到 Chrome**

`npm run build` 后，把 `dist/bili-follow-feed.user.js` 导入 Tampermonkey（或 Violentmonkey）。

**Step 2: 逐项验收**

| # | 验收项 | 期望 |
|---|---|---|
| 1 | 访问 `https://www.bilibili.com/#/my-feed` | 显示卡片墙，无原生内容 |
| 2 | 卡片封面 | 正常显示，无 403 碎图 |
| 3 | 封面角标 | 显示时长 |
| 4 | 点击卡片 | 新标签打开对应 `bilibili.com/video/BV...` |
| 5 | 点击后返回 | 该卡片变暗（已读） |
| 6 | 刷新页面 | 已读状态保留（localStorage） |
| 7 | 切「未读」筛选 | 已读卡片消失 |
| 8 | 切「播放量最高」 | 顺序按播放量变化 |
| 9 | 加载更多 | 追加新卡片，无重复 bvid |
| 10 | 访问 `https://www.bilibili.com/`（不带 hash） | **原生首页完全正常，脚本不干扰** |

**Step 3: 记录问题**

发现的缺陷写入 `docs/plans/2026-09-11-followups.md`，不在本计划内顺手修（保持任务边界）。

**Step 4: 最终提交**

```powershell
git add -A
git commit -m "chore: complete warmup release v0.1.0"
```

---

## 与路线 1 的衔接（不在本计划范围）

本计划产出的以下资产可直接复用：`src/types.ts`、`src/lib/*`、`src/components/*`、`FeedDataSource` 接口。
路线 1 只需新增后端服务 + `HttpDataSource` 实现。

---

## 已知未决项

1. **Task 1 是硬门禁**：接口若要求 WBI 签名或 `bili_ticket`，本计划作废，回到设计阶段。
2. **fixture 必须按真实样本校正**：Task 3 的 `items.ts` 是按预期结构写的，必须以 Task 1 的真实响应为准修正后再跑测试。
3. **Task 9 的 hash 接管存在不确定性**：已设计退路。
