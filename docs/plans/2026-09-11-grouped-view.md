# 分组视图实施计划（第二期）

> **REQUIRED SUB-SKILL:** 执行本计划时使用 `executing-plans` skill，逐任务推进。

**Goal:** 把当前的单一卡片墙升级为「按本地关注分组组织的多板块视图」，配套侧边栏 UP 列表、UP 主页链接、本地分组管理与批量分类。

**Architecture:** 在热身版的 `FeedDataSource` 接缝旁新增一条只读的**关系数据链**（`x/relation/tags` + `x/relation/followings`），落到本地存储作为**与 B站 隔离**的分组事实来源；视图层由纯函数 `buildSections` 把动态流视频按 UP 的本地分组切成分区，交给新的侧边栏 + 板块组件渲染。

**Tech Stack:** 同热身版 —— TypeScript · React 19 · Vite 8 · vite-plugin-monkey · Vitest 5（jsdom）

**设计依据:** `docs/superpowers/specs/2026-09-11-grouped-view-design.md`

**前置:** 热身版 v0.2.0 已交付并验收（路径匹配入口 `/agent-feed`）

---

## 环境约束（历史记录）

> ⚠️ **这一节记的是当时那台开发机的约束，与使用者无关，已脱敏**
>（代理地址、沙箱策略、会话快照等已移除）。

工作目录：**仓库根目录**

**已知约束（第一期实测得出）：**

- `tsc` 的 `noUnusedLocals` 开着：测试文件里的未使用 import 会导致构建失败。
- 编辑文件前若报"文件自读取后已被修改"，重新 `read` 一次再编辑
  （`git add` 的行尾转换已被 `.gitattributes` 止住，但提交仍会更新 mtime）。
- Windows 下数行数别用 `Get-Content`（会按 ANSI 解码 UTF-8 并静默吞掉换行），
  用 `[System.IO.File]::ReadAllLines($绝对路径)`。

---

# 阶段 1：只读数据层

**阶段目标**：能拉到关注列表与其 B站 分组归属。**全程只读，不含任何写 B站 的操作。**

## Task 1: 关系接口与类型

**Files:**
- Create: `src/types.ts`（追加类型）
- Create: `src/data/relation.ts`
- Create: `src/data/relation.test.ts`
- Create: `src/data/__fixtures__/relation.ts`

**Step 1: 在 `src/types.ts` 追加类型**

```ts
/** B站 关注分组 */
export interface BiliTag {
  tagid: number;
  name: string;
  count: number;
}

/** 裁剪后的关注项 —— 只保留落盘需要的字段（见设计文档 §15.1） */
export interface TrimmedFollowedUp {
  mid: number;
  uname: string;
  face: string;            // 已提升为 https
  tag: number[] | null;    // null = 只在 B站 默认分组
  special: 0 | 1;
}

export interface SelfInfo {
  mid: number;
  uname: string;
}
```

**Step 2: 创建 fixture `src/data/__fixtures__/relation.ts`**

结构取自 `bilibili-API-collect` 的 `x/relation/followings` 与 `x/relation/tags` 示例（真实字段，含两个陷阱：`face` 是 `http://`、`tag` 可为 `null` 或数组）：

```ts
export const rawFollowings = [
  {
    mid: 14082,
    attribute: 2,
    mtime: 1584271945,
    tag: null,
    special: 0,
    uname: '山新',
    face: 'http://i0.hdslb.com/bfs/face/74c82caee6d9eb623e56161ea8ed6d68afabfeae.jpg',
    sign: '这条字段很长但我们不该落盘',
    official_verify: { type: 0, desc: '配音演员' },
    vip: { vipType: 2, vipStatus: 1 },
  },
  {
    mid: 420831218,
    attribute: 2,
    mtime: 1584208169,
    tag: [207542],
    special: 0,
    uname: '支付宝Alipay',
    face: 'http://i2.hdslb.com/bfs/face/aaf18aeb2d9822e28a590bd8d878572ca8c59e04.jpg',
    sign: '',
    official_verify: { type: 1, desc: '支付宝官方账号' },
    vip: { vipType: 1, vipStatus: 1 },
  },
  {
    mid: 53456,
    attribute: 2,
    mtime: 1586415053,
    tag: [-10, 194110],
    special: 1,
    uname: 'Warma',
    face: 'http://i2.hdslb.com/bfs/face/c1bbee6d255f1e7fc434e9930f0f288c8b24293a.jpg',
    sign: '',
    official_verify: { type: 0, desc: 'bilibili 知名UP主' },
    vip: { vipType: 2, vipStatus: 1 },
  },
];

export const rawTags = [
  { tagid: -10, name: '特别关注', count: 16 },
  { tagid: 0, name: '默认分组', count: 536 },
  { tagid: 194110, name: '我的同学', count: 16 },
  { tagid: 207542, name: '电影分组', count: 8 },
];
```

**Step 3: 写失败的测试 `src/data/relation.test.ts`**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchTags, fetchFollowings, fetchSelf } from './relation';
import { rawFollowings, rawTags } from './__fixtures__/relation';

function stubFetch(payload: unknown) {
  const fn = vi.fn().mockResolvedValue({ json: async () => payload });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchTags', () => {
  it('返回分组列表', async () => {
    stubFetch({ code: 0, data: rawTags });
    const tags = await fetchTags();
    expect(tags).toHaveLength(4);
    expect(tags[0]).toEqual({ tagid: -10, name: '特别关注', count: 16 });
  });

  it('非 0 code 抛错', async () => {
    stubFetch({ code: -101, message: '账号未登录' });
    await expect(fetchTags()).rejects.toThrow(/未登录/);
  });
});

describe('fetchFollowings', () => {
  it('裁剪掉不需要落盘的字段', async () => {
    stubFetch({ code: 0, data: { list: rawFollowings, total: 3 } });
    const list = await fetchFollowings(293793435, 1);
    expect(list).toHaveLength(3);
    expect(Object.keys(list[0]).sort()).toEqual(['face', 'mid', 'special', 'tag', 'uname']);
    expect(list[0]).not.toHaveProperty('sign');
    expect(list[0]).not.toHaveProperty('vip');
  });

  it('把 http 头像提升为 https', async () => {
    stubFetch({ code: 0, data: { list: rawFollowings, total: 3 } });
    const list = await fetchFollowings(293793435, 1);
    expect(list[0].face.startsWith('https://')).toBe(true);
  });

  it('保留 tag 为 null 的语义', async () => {
    stubFetch({ code: 0, data: { list: rawFollowings, total: 3 } });
    const list = await fetchFollowings(293793435, 1);
    expect(list[0].tag).toBeNull();
    expect(list[1].tag).toEqual([207542]);
    expect(list[2].tag).toEqual([-10, 194110]);
  });

  it('请求带 vmid/pn/ps 且 credentials 为 include', async () => {
    const fn = stubFetch({ code: 0, data: { list: [], total: 0 } });
    await fetchFollowings(293793435, 2);
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/x/relation/followings');
    expect(url).toContain('vmid=293793435');
    expect(url).toContain('pn=2');
    expect(url).toContain('ps=50');
    expect(init.credentials).toBe('include');
  });
});
```

**Step 4: 运行确认失败**

```powershell
npx vitest run src/data/relation.test.ts
```

Expected: FAIL —— `Failed to resolve import "./relation"`

**Step 5: 实现 `src/data/relation.ts`**

```ts
import type { BiliTag, TrimmedFollowedUp, SelfInfo } from '../types';

const API = 'https://api.bilibili.com';
const PAGE_SIZE = 50;   // 设计文档 §14 待确认项：B站 未公开 ps 上限，50 为文档默认值

/** 复用热身版的 http→https 提升（混合内容会整片碎图） */
function toHttps(url: string): string {
  return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url;
}

function ensureOk(json: { code: number; message?: string }): void {
  if (json.code !== 0) {
    throw new Error(`B站接口返回 ${json.code}：${json.message ?? '未知错误'}`);
  }
}

/** 当前登录用户（x/web-interface/nav 不需要 WBI 签名） */
export async function fetchSelf(): Promise<SelfInfo> {
  const res = await fetch(`${API}/x/web-interface/nav`, { credentials: 'include' });
  const json = await res.json();
  ensureOk(json);
  return { mid: json.data.mid, uname: json.data.uname };
}

/** B站 关注分组列表。tagid -10=特别关注、0=默认分组，两者恒定 */
export async function fetchTags(): Promise<BiliTag[]> {
  const res = await fetch(`${API}/x/relation/tags`, { credentials: 'include' });
  const json = await res.json();
  ensureOk(json);
  return (json.data ?? []) as BiliTag[];
}

/** 关注列表（单页）。只保留落盘需要的字段，见设计文档 §15.1 */
export async function fetchFollowings(vmid: number, pn: number): Promise<TrimmedFollowedUp[]> {
  const params = new URLSearchParams({
    vmid: String(vmid),
    pn: String(pn),
    ps: String(PAGE_SIZE),
    order_type: '',
  });
  const res = await fetch(`${API}/x/relation/followings?${params}`, { credentials: 'include' });
  const json = await res.json();
  ensureOk(json);

  const raw = (json.data?.list ?? []) as Array<Record<string, unknown>>;
  return raw.map((u) => ({
    mid: Number(u.mid),
    uname: String(u.uname ?? ''),
    face: toHttps(String(u.face ?? '')),
    tag: Array.isArray(u.tag) ? (u.tag as number[]) : null,
    special: (u.special === 1 ? 1 : 0) as 0 | 1,
  }));
}
```

**Step 6: 运行确认通过**

```powershell
npx vitest run src/data/relation.test.ts
```

Expected: PASS —— 6 passed

**Step 7: Commit**

```powershell
git add src/types.ts src/data/
git commit -m "feat(phase1): add read-only relation endpoints with trimmed payloads"
```

---

## Task 2: UP 索引与 B站 分组映射

**Files:**
- Create: `src/lib/upIndex.ts`
- Create: `src/lib/upIndex.test.ts`

**Step 1: 写失败的测试**

```ts
import { describe, it, expect } from 'vitest';
import { buildUpIndex, biliGroupIdsOf, SPECIAL_ID, UNCATEGORIZED_ID } from './upIndex';
import { rawFollowings, rawTags } from '../data/__fixtures__/relation';
import type { TrimmedFollowedUp } from '../types';

const list = rawFollowings.map((u) => ({
  mid: u.mid,
  uname: u.uname,
  face: u.face.replace('http://', 'https://'),
  tag: u.tag,
  special: u.special as 0 | 1,
})) as TrimmedFollowedUp[];

describe('biliGroupIdsOf', () => {
  it('tag 为 null → 只有未分类', () => {
    expect(biliGroupIdsOf(list[0])).toEqual([UNCATEGORIZED_ID]);
  });
  it('tag 为数组 → 映射为 bili-<tagid>，-10 映射为 special', () => {
    expect(biliGroupIdsOf(list[1])).toEqual(['bili-207542']);
    expect(biliGroupIdsOf(list[2])).toEqual([SPECIAL_ID, 'bili-194110']);
  });
});

describe('buildUpIndex', () => {
  it('建立 mid → UpInfo 的索引', () => {
    const idx = buildUpIndex(list);
    expect(idx[14082].name).toBe('山新');
    expect(idx[53456].isSpecial).toBe(true);
    expect(idx[420831218].isSpecial).toBe(false);
  });

  it('空列表返回空索引而不抛异常', () => {
    expect(buildUpIndex([])).toEqual({});
  });
});
```

**Step 2: 运行确认失败**

```powershell
npx vitest run src/lib/upIndex.test.ts
```

Expected: FAIL

**Step 3: 实现 `src/lib/upIndex.ts`**

```ts
import type { TrimmedFollowedUp, UpInfo } from '../types';

export const SPECIAL_ID = 'special';
export const UNCATEGORIZED_ID = 'uncategorized';
/** B站 特别关注分组恒定 tagid */
const BILI_SPECIAL_TAGID = -10;

/** B站 侧的分组归属 → 本地分组 id 列表（映射规则见设计文档 §5.1） */
export function biliGroupIdsOf(up: TrimmedFollowedUp): string[] {
  if (!Array.isArray(up.tag) || up.tag.length === 0) return [UNCATEGORIZED_ID];
  return up.tag.map((tagid) => (tagid === BILI_SPECIAL_TAGID ? SPECIAL_ID : `bili-${tagid}`));
}

export function buildUpIndex(list: TrimmedFollowedUp[]): Record<string, UpInfo> {
  const out: Record<string, UpInfo> = {};
  for (const u of list) {
    out[String(u.mid)] = {
      mid: u.mid,
      name: u.uname,
      face: u.face,
      isSpecial: u.special === 1 || (Array.isArray(u.tag) && u.tag.includes(BILI_SPECIAL_TAGID)),
    };
  }
  return out;
}
```

**Step 4: 在 `src/types.ts` 追加 `UpInfo`**

```ts
export interface UpInfo {
  mid: number;
  name: string;
  face: string;      // 已提升为 https
  isSpecial: boolean;
}
```

**Step 5: 运行确认通过**

```powershell
npx vitest run src/lib/upIndex.test.ts
```

Expected: PASS —— 5 passed

**Step 6: Commit**

```powershell
git add src/lib/upIndex.ts src/lib/upIndex.test.ts src/types.ts
git commit -m "feat(phase1): build up index and map bilibili groups to local ids"
```

---

## Task 3: 带版本号与配额反馈的安全存储

**Files:**
- Create: `src/lib/storage.ts`
- Create: `src/lib/storage.test.ts`

**Step 1: 写失败的测试**

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readJson, writeJson, bffUsage, SCHEMA_VERSION } from './storage';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('readJson', () => {
  it('缺失时返回 fallback', () => expect(readJson('x', 42)).toBe(42));
  it('损坏 JSON 返回 fallback 而不抛异常', () => {
    localStorage.setItem('x', '{not json');
    expect(readJson('x', 42)).toBe(42);
  });
  it('正常往返', () => {
    localStorage.setItem('x', JSON.stringify({ a: 1 }));
    expect(readJson('x', null)).toEqual({ a: 1 });
  });
});

describe('writeJson', () => {
  it('成功返回 true', () => expect(writeJson('x', { a: 1 })).toBe(true));
  it('配额写满返回 false，不抛异常', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(writeJson('x', { a: 1 })).toBe(false);
  });
});

describe('bffUsage', () => {
  it('只统计 bff: 前缀的键', () => {
    localStorage.setItem('bff:a', '12345');
    localStorage.setItem('other', '1234567890');
    // 'bff:a' + '12345' = 9 字符
    expect(bffUsage()).toBe(9);
  });
  it('无数据时为 0', () => expect(bffUsage()).toBe(0));
});

describe('schema 版本', () => {
  it('导出当前版本号', () => expect(SCHEMA_VERSION).toBe(1));
});
```

**Step 2: 运行确认失败** → `npx vitest run src/lib/storage.test.ts` → FAIL

**Step 3: 实现 `src/lib/storage.ts`**

```ts
export const SCHEMA_VERSION = 1;
const VERSION_KEY = 'bff:schemaVersion';

/** 读 JSON。损坏/缺失一律回落 fallback —— 绝不因为脏数据白屏。 */
export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * 写 JSON。**返回成功与否**，而不是静默吞掉 —— 配额满或被禁用时
 * 用户必须知道已读状态不会保存（设计文档 §15.3）。
 */
export function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** 所有 bff:* 键的 key+value 字符数之和，用于「存储占用」展示 */
export function bffUsage(): number {
  let total = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('bff:')) continue;
      total += k.length + (localStorage.getItem(k) ?? '').length;
    }
  } catch {
    return 0;
  }
  return total;
}

/** 版本检查：缺失或不等即视为需要迁移/重置 */
export function needsMigration(): boolean {
  return readJson<number | null>(VERSION_KEY, null) !== SCHEMA_VERSION;
}

export function markMigrated(): boolean {
  return writeJson(VERSION_KEY, SCHEMA_VERSION);
}
```

**Step 4: 运行确认通过** → PASS —— 8 passed

**Step 5: Commit**

```powershell
git add src/lib/storage.ts src/lib/storage.test.ts
git commit -m "feat: add schema-versioned storage helpers that surface quota failures"
```

---

# 阶段 2：本地分组

**阶段目标**：分组的初始化、合并导入、分歧检测、批量语义全部就绪且有测试。**仍是纯本地，不写 B站。**

## Task 4: 本地分组 CRUD 与导入

**Files:**
- Create: `src/lib/localGroups.ts`
- Create: `src/lib/localGroups.test.ts`

**Step 1: 写失败的测试**

覆盖这些行为（测试代码按下方接口签名编写）：

- `seedFromBilibili(tags, followings)` 首次导入：`-10`→`special`；`0`→**不建组**（其成员进未分类）；其他 tagid→`bili-<id>` 同名；多归属同时进多个组
- `mergeImport(tags, followings)` 合并导入：**已有本地归类的 UP 一律不动**；只给未分类的按 B站 归类；同时刷新 `biliSnapshot`
- `createGroup(name)` / `renameGroup(id, name)` / `deleteGroup(id)`：删除后组内 UP 全部回落未分类
- 名称超过 16 字符被拒绝或截断
- 系统分组（`special`、`uncategorized`）不可重命名、不可删除
- `applyBatch(mids, op)` 四种语义：`add` / `remove` / `only` / `clear`
- `remove` 后为空自动落未分类
- `undo()` 能完整还原上一次批量操作
- `detectDivergence(followings)` 用快照对比，**本地手动改动不会被误报**

**Step 2: 运行确认失败**

```powershell
npx vitest run src/lib/localGroups.test.ts
```

Expected: FAIL

**Step 3: 实现 `src/lib/localGroups.ts`**

接口签名（实现按此展开）：

```ts
export interface Group {
  id: string;
  name: string;
  order: number;
  kind: 'system' | 'normal';
  source: 'bilibili' | 'local';
}

export type BatchOp =
  | { type: 'add'; groupId: string }
  | { type: 'remove'; groupId: string }
  | { type: 'only'; groupId: string }
  | { type: 'clear' };

export function loadGroups(): Group[];
export function loadMembership(): Record<string, string[]>;
export function seedFromBilibili(tags: BiliTag[], followings: TrimmedFollowedUp[]): void;
export function mergeImport(tags: BiliTag[], followings: TrimmedFollowedUp[]): { added: number };
export function createGroup(name: string): Group | null;
export function renameGroup(id: string, name: string): boolean;
export function deleteGroup(id: string): boolean;
export function reorderGroup(id: string, dir: -1 | 1): void;
export function applyBatch(mids: number[], op: BatchOp): void;
export function undoLastBatch(): boolean;
export function detectDivergence(followings: TrimmedFollowedUp[]): Set<number>;
export function resetFromBilibili(mid: number, followings: TrimmedFollowedUp[]): void;
```

**关键实现要点：**

- `membership[mid]` 为**空数组或不存在** = 未分类。**「未分类」不落盘**（设计文档 §4.3）
- `applyBatch` 前把 `membership` 整体快照存入内存变量（不落盘），供 `undoLastBatch` 使用
- `applyBatch` **只做一次 `writeJson`**
- `deleteGroup` 后清理所有指向该 id 的引用（脏引用按未分类处理，见 §10.6）
- `detectDivergence` 比较 `biliSnapshot[mid]` 与当前 `followings` 的 `tag`；**`local-*` 分组不参与比较**（那是纯本地新增）

**Step 4: 运行确认通过**

```powershell
npx vitest run src/lib/localGroups.test.ts
```

Expected: PASS

**Step 5: Commit**

```powershell
git add src/lib/localGroups.ts src/lib/localGroups.test.ts
git commit -m "feat(phase2): local group CRUD, seeding, merge import and batch ops"
```

---

## Task 5: 分区构建（纯函数）

**Files:**
- Create: `src/lib/grouping.ts`
- Create: `src/lib/grouping.test.ts`

**Step 1: 写失败的测试**

要点：

- 一个 UP 属于多个分组 → 他的视频**在每个分组板块都出现**
- 分组顺序按 `order`，`special` 最前、`uncategorized` 最后
- **没有视频的分组仍然产出一个 Section**（UI 层负责显示占位）
- UP 不在 `upIndex` 里 → 归入未分类
- 视频不在任何分组时不会丢失

**Step 2: 运行确认失败** → `npx vitest run src/lib/grouping.test.ts` → FAIL

**Step 3: 实现 `src/lib/grouping.ts`**

```ts
import type { VideoCard } from '../types';
import type { Group } from './localGroups';
import { UNCATEGORIZED_ID } from './upIndex';

export interface Section {
  group: Group;
  videos: VideoCard[];
}

export function buildSections(
  videos: VideoCard[],
  groups: Group[],
  membership: Record<string, string[]>,
  collator?: (a: VideoCard, b: VideoCard) => number,
): Section[] {
  const byGroup = new Map<string, VideoCard[]>();
  for (const g of groups) byGroup.set(g.id, []);

  for (const v of videos) {
    const gids = membership[String(v.upMid)];
    const targets = gids && gids.length > 0 ? gids : [UNCATEGORIZED_ID];
    for (const gid of targets) {
      // 脏引用（指向已删除的分组）按未分类处理
      const bucket = byGroup.has(gid) ? gid : UNCATEGORIZED_ID;
      byGroup.get(bucket)?.push(v);
    }
  }

  const ordered = [...groups].sort((a, b) => a.order - b.order);
  return ordered.map((g) => {
    const list = byGroup.get(g.id) ?? [];
    return { group: g, videos: collator ? [...list].sort(collator) : list };
  });
}
```

**Step 4: 运行确认通过** → PASS

**Step 5: Commit**

```powershell
git add src/lib/grouping.ts src/lib/grouping.test.ts
git commit -m "feat(phase2): build group sections from videos and local membership"
```

---

## Task 6: `readVideos` 封顶与迁移

**Files:**
- Modify: `src/lib/readState.ts`
- Modify: `src/lib/readState.test.ts`

**Step 1: 追加失败的测试**

```ts
it('超过 3000 条时丢弃最早的', () => {
  const many = Array.from({ length: 3010 }, (_, i) => `BV${i}`);
  saveRead(new Set(many));
  const set = loadRead();
  expect(set.size).toBe(3000);
  expect(set.has('BV0')).toBe(false);      // 最早的被丢
  expect(set.has('BV3009')).toBe(true);
});

it('写入失败时返回 false 而不吞掉', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('quota', 'QuotaExceededError');
  });
  expect(saveRead(new Set(['BV1']))).toBe(false);
});
```

**Step 2: 运行确认失败** → FAIL（`saveRead` 目前返回 void）

**Step 3: 改造 `src/lib/readState.ts`**

- 存储由「Set 序列化的数组」改为**保留插入顺序的数组**（新写入的追加在尾部）
- `saveRead` 返回值改为 `boolean`，内部改用 `storage.ts` 的 `writeJson`
- 超过 `MAX_READ = 3000` 时 `slice(-MAX_READ)`
- `loadRead` 仍返回 `Set<string>`，调用方不用改

**Step 4: 运行确认通过** → PASS

**Step 5: Commit**

```powershell
git add src/lib/readState.ts src/lib/readState.test.ts
git commit -m "fix: cap readVideos at 3000 entries and surface write failures"
```

---

# 阶段 3：视图层

**阶段目标**：需求 1-5 全部落地。**UI 靠人工验收清单，不强行单元测试。**

## Task 7: 卡片结构重构（修 `<a>` 嵌套）

**Files:**
- Modify: `src/components/VideoCard.tsx`
- Modify: `src/styles.css`

**Step 1: 按设计文档 §7.3 重构**

外层改 `<div class="bff-card">`；封面+标题包一个 `<a href={card.url}>`；UP 头像+昵称包**并列的** `<a href={https://space.bilibili.com/{upMid}}>`。

**Step 2: `styles.css` 调整**

`.bff-card` 由 `display:block; text-decoration:none` 改为容器样式；`.bff-card-main` 承担原来的链接样式；`.bff-card-up` 独立 hover 效果（`color: #fb7299`）。

**Step 3: 构建验证**

```powershell
npm run build
```

Expected: 无 TS 错误

**Step 4: 人工验证**

点击封面/标题 → 新标签打开视频页；点击 UP 头像/昵称 → 新标签打开 `space.bilibili.com/<mid>`。

**Step 5: Commit**

```bash
git add src/components/VideoCard.tsx src/styles.css
git commit -m "feat(phase3): restructure card so video and up links are siblings, not nested"
```

---

## Task 8: 侧边栏

**Files:**
- Create: `src/components/Sidebar.tsx`
- Create: `src/hooks/useFollowings.ts`
- Modify: `src/styles.css`

**Step 1: 实现 `src/hooks/useFollowings.ts`**

职责：拉 `fetchSelf` → 分页拉 `fetchFollowings`（`ps=50`，直到累计数达到 `total`）→ `fetchTags` → 写入 `bff:followingsCache` + 重建 `bff:upIndex` → 首次则 `seedFromBilibili`。

**约束**：
- 分页请求之间 `await sleep(300)`，避免风控
- 总页数上限 40 页（2000 人）保护
- 失败时把错误暴露给 UI，不静默

**Step 2: 实现 `src/components/Sidebar.tsx`**

按设计文档 §7.1。要点：

- 顶部搜索框（按 `name` 过滤，跨分组）
- 分组标题可折叠，折叠状态存 `bff:collapsedGroups`
- 每个 UP 行整体是 `<a href="https://space.bilibili.com/{mid}">`，右侧「⋯」按钮 `stopPropagation`
- 底部：刷新关注列表 / 补充导入分组 / 去 B站 管理分组
- 顶部「⋯ 分组」菜单：新建分组、强制覆盖、存储占用、清理历史数据

**Step 3: 构建验证** → `npm run build`

**Step 4: 人工验证** → 见 Task 12

**Step 5: Commit**

```bash
git add src/components/Sidebar.tsx src/hooks/useFollowings.ts src/styles.css
git commit -m "feat(phase3): add sidebar with grouped up list and search"
```

---

## Task 9: 分组板块与折叠

**Files:**
- Create: `src/components/GroupSection.tsx`
- Modify: `src/styles.css`

**Step 1: 实现 `GroupSection.tsx`**

- 标题行：分组名 + `(数量)` + 左端 `+`/`−` 切换按钮
- 折叠状态存 `bff:collapsedGroups`
- **空分组默认折叠**并显示「这个分组最近没有更新」
- 展开时内部渲染 `VideoGrid`

**Step 2: 构建验证** → `npm run build`

**Step 3: Commit**

```bash
git add src/components/GroupSection.tsx src/styles.css
git commit -m "feat(phase3): add collapsible group sections"
```

---

## Task 10: 单个 UP 的分组菜单与批量操作条

**Files:**
- Create: `src/components/GroupPicker.tsx`
- Create: `src/components/BatchBar.tsx`
- Modify: `src/styles.css`

**Step 1: 实现 `GroupPicker.tsx`**（设计文档 §6.2）

勾选框列表 + 「新建分组…」+「移出全部分组」+ 条件出现的「按 B站 分组重置此项」。勾选即生效（一次 `writeJson`）。

**Step 2: 实现 `BatchBar.tsx`**（设计文档 §6.3）

底部操作条：`已选 N 个 [加入分组▾] [移出分组▾] [仅属于…▾] [移出全部] [清除选择]`；应用后显示「已应用 · 撤销」（10 秒）。

**Step 3: 构建验证** → `npm run build`

**Step 4: Commit**

```bash
git add src/components/GroupPicker.tsx src/components/BatchBar.tsx src/styles.css
git commit -m "feat(phase3): add per-up group menu and batch operation bar with undo"
```

---

## Task 11: 主应用改造与视图切换

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Step 1: 布局改为「侧边栏 + 主区」**

- 左侧固定宽度（约 260px）侧边栏，可折叠
- 右侧工具条增加「分组 / 平铺」切换，默认分组视图
- 分组视图：`buildSections(...)` → 若干 `GroupSection`
- 平铺视图：**完全保留热身版行为**（按 bvid 去重）
- 批量模式状态提升到 `App`

**Step 2: 存储写入失败时提示一次**

调用 `writeJson` 返回 `false` 时显示一次提示条（不重复打扰）。

**Step 3: 构建 + 全量测试**

```powershell
npm run build
npx vitest run
```

Expected: 构建成功；所有测试通过

**Step 4: Commit**

```bash
git add src/App.tsx src/styles.css
git commit -m "feat(phase3): wire sidebar, grouped view and view toggle into the app"
```

---

## Task 12: 端到端验收

**Step 1: 重新构建并安装**

```powershell
npm run build
```

安装 `dist/bili-follow-feed.user.js`（v0.3.0），确认 Tampermonkey 面板版本号。

**Step 2: 逐项验收**

| # | 验收项 | 期望 |
|---|---|---|
| 1 | 首次打开 `/agent-feed` | 自动拉取关注列表，侧边栏出现全部分组与 UP |
| 2 | 分组与 B站 一致 | 分组名、归属与 B站 网页一致（首次导入正确） |
| 3 | 主区分组板块 | 每个分组一个板块，标题含数量 |
| 4 | 折叠 +/− | 点击折叠/展开；刷新后折叠状态保留 |
| 5 | 空分组 | 默认折叠，显示「这个分组最近没有更新」 |
| 6 | 卡片 UP 链接 | 点头像/昵称 → 新标签打开该 UP 主页 |
| 7 | 侧边栏 UP 链接 | 同上 |
| 8 | 侧边栏搜索 | 输入关键词过滤 UP；匹配项所在分组自动展开 |
| 9 | 单个 UP 分类 | 「⋯」勾选分组 → 他的视频立刻在对应板块出现/消失 |
| 10 | **本地修改不影响 B站** | 在页面改完分类，刷新 B站 网页确认分组未变 |
| 11 | 批量分类 | 进入批量模式 → 多选 → 加入分组 → 一次生效 |
| 12 | **批量撤销** | 点「撤销」→ 归属完整还原 |
| 13 | 新建/重命名/删除分组 | 删除时确认框显示受影响 UP 数量；删后他们进未分类 |
| 14 | 补充导入分组 | 只影响未分类的 UP，已有分类不动 |
| 15 | 平铺视图 | 切过去与热身版行为一致 |
| 16 | **其他 B站 页面正常** | Tampermonkey 图标无数字角标；B站 首页正常 |

**Step 3: 记录问题**

缺陷写入 `docs/plans/2026-09-11-grouped-view-followups.md`，不在本计划内顺手修。

**Step 4: 最终提交**

```bash
git add -A
git commit -m "chore: complete grouped view v0.3.0"
```

---

## 已知未决项

1. **Task 1 的 `ps=50` 是文档默认值**，B站 未公开上限。若实际能更大，可减少请求数。
2. **设计文档 §14 的待确认项**：UP 在自定义分组时 `tag` 数组里是否还含 `tagid=0`。若含，`biliGroupIdsOf` 需要过滤掉 0。**Task 1 实现后应先用真实响应验证一次再进 Task 2。**
3. **`fetchSelf` 依赖 `x/web-interface/nav`**。该接口文档标注不需要 WBI 签名，但 2022 年后 B站 有逐步收紧的历史 —— 实现时若返回 412 或空 `data`，改用 cookie 里的 `DedeUserID` 作为兜底。
4. **UI 任务（7-11）不含单元测试**，依赖 Task 12 的人工验收清单。这是有意的：这些组件的价值在交互，强行测 DOM 收益低。
