import type { BiliTag, TrimmedFollowedUp } from '../types';
import { readJson, writeJson } from './storage';
import { SPECIAL_ID, UNCATEGORIZED_ID, biliGroupIdsOf } from './upIndex';

export interface Group {
  id: string;
  name: string;
  order: number;
  kind: 'system' | 'normal';
  source: 'bilibili' | 'local';
  /**
   * 该本地分组对应的 B站 分组 tagid（若由导入建立、或并入过同名 B站 分组）。
   *
   * 有这个字段才能把 B站 分组**稳定地**映射到本地分组；靠 id 前缀（`bili-`）
   * 猜是不够的 —— 用户先在本地建的同名分组 id 是 `local-N`，永远匹配不上。
   */
  biliTagId?: number;
}

export type BatchOp =
  | { type: 'add'; groupId: string }
  | { type: 'remove'; groupId: string }
  | { type: 'only'; groupId: string }
  | { type: 'clear' };

const GROUPS_KEY = 'bff:groups';
const MEMBERSHIP_KEY = 'bff:membership';
const SNAPSHOT_KEY = 'bff:biliSnapshot';

/** B站 分组名上限 16 字符，本地对齐以免将来对不上 */
export const MAX_GROUP_NAME = 16;

/**
 * 排序约定：`special` 恒为 0，自定义分组从 10 起，`uncategorized` 恒为 9999。
 *
 * ⚠️ 必须自己指定顺序，**不能沿用 B站 `x/relation/tags` 的返回顺序** —— 实测该
 * 账号的返回里「默认分组」排第 2，而默认分组映射为「未分类」（262/281 人），
 * 沿用 API 顺序会把 262 人顶到最前面。
 */
const ORDER_SPECIAL = 0;
const ORDER_CUSTOM_START = 10;
const ORDER_UNCATEGORIZED = 9999;

const BILI_SPECIAL_TAGID = -10;
const BILI_DEFAULT_TAGID = 0;

function systemGroups(): Group[] {
  return [
    { id: SPECIAL_ID, name: '特别关注', order: ORDER_SPECIAL, kind: 'system', source: 'bilibili' },
    {
      id: UNCATEGORIZED_ID,
      name: '未分类',
      order: ORDER_UNCATEGORIZED,
      kind: 'system',
      source: 'bilibili',
    },
  ];
}

type Membership = Record<string, string[]>;
/** 快照存的是 B站 原始 tagid，所以值是 number[] 而非 string[] */
type Snapshot = Record<string, number[]>;

// ── 读取 ────────────────────────────────────────────────────────────────

export function loadGroups(): Group[] {
  const stored = readJson<Group[]>(GROUPS_KEY, []);
  if (!Array.isArray(stored) || stored.length === 0) return systemGroups();
  return stored;
}

/** 是否已经做过首次导入。
 *  注意不能用 `loadGroups().length === 0` 判断 —— 那个函数在从未初始化时会
 *  回落出两个系统分组的默认值，永远不为空。 */
export function isSeeded(): boolean {
  return readJson<unknown>(GROUPS_KEY, null) !== null;
}

export function loadMembership(): Membership {
  const m = readJson<Membership>(MEMBERSHIP_KEY, {});
  return m && typeof m === 'object' ? m : {};
}

function loadSnapshot(): Snapshot {
  const s = readJson<Snapshot>(SNAPSHOT_KEY, {});
  return s && typeof s === 'object' ? s : {};
}

/** 未分类是隐式的：membership 里为空或不存在的 mid 即为未分类 */
export function groupsOf(membership: Membership, mid: number): string[] {
  const g = membership[String(mid)];
  return Array.isArray(g) ? g : [];
}

// ── 写入（全部经过 writeJson，会返回是否成功） ────────────────────────────

function saveGroups(groups: Group[]): boolean {
  return writeJson(GROUPS_KEY, groups);
}

function saveMembership(m: Membership): boolean {
  return writeJson(MEMBERSHIP_KEY, m);
}

function saveSnapshot(s: Snapshot): boolean {
  return writeJson(SNAPSHOT_KEY, s);
}

/** B站 的 tag → 快照用的规范化数组（null 与空数组同义） */
function snapshotOf(up: TrimmedFollowedUp): number[] {
  return Array.isArray(up.tag) ? [...up.tag].sort((a, b) => a - b) : [];
}

/** 把 B站 分组归属转成可落盘的本地 membership（**过滤掉隐式的未分类**） */
function storableGroupIds(
  up: TrimmedFollowedUp,
  resolve?: (tagid: number) => string | undefined,
): string[] {
  return biliGroupIdsOf(up, resolve).filter((id) => id !== UNCATEGORIZED_ID);
}

/**
 * tagid → 本地分组 id。
 *
 * 这是修复「同名分组被重复创建」时必须配套的东西：复用同名本地分组后，
 * 该分组的 id 是 `local-N` 而不是 `bili-<tagid>`，翻译 B站 归属时必须查表，
 * 不能靠拼字符串。
 */
function tagToGroupId(groups: Group[]): (tagid: number) => string | undefined {
  const map = new Map<number, string>();
  for (const g of groups) {
    if (typeof g.biliTagId === 'number') map.set(g.biliTagId, g.id);
  }
  return (tagid: number) => map.get(tagid);
}

function setMembership(m: Membership, mid: number, ids: string[]): void {
  if (ids.length === 0) delete m[String(mid)];
  else m[String(mid)] = ids;
}

// ── 首次导入 ────────────────────────────────────────────────────────────

/**
 * 首次导入：完全按 B站 分组建立本地分组与归属。
 * B站 的「默认分组」（tagid 0）**不建同名分组**，其成员直接落入「未分类」。
 */
export function seedFromBilibili(tags: BiliTag[], followings: TrimmedFollowedUp[]): boolean {
  const groups: Group[] = systemGroups();

  // 自定义分组：来自 tags，并补上 followings 里引用到但 tags 未列出的 tagid
  const customIds = new Set<number>();
  for (const t of tags) {
    if (t.tagid !== BILI_SPECIAL_TAGID && t.tagid !== BILI_DEFAULT_TAGID) customIds.add(t.tagid);
  }
  for (const u of followings) {
    for (const tagid of snapshotOf(u)) {
      if (tagid !== BILI_SPECIAL_TAGID && tagid !== BILI_DEFAULT_TAGID) customIds.add(tagid);
    }
  }

  let order = ORDER_CUSTOM_START;
  const nameOf = new Map(tags.map((t) => [t.tagid, t.name]));
  for (const tagid of [...customIds].sort((a, b) => a - b)) {
    groups.push({
      id: `bili-${tagid}`,
      name: nameOf.get(tagid) ?? `分组 ${tagid}`,
      order: order++,
      kind: 'normal',
      source: 'bilibili',
      biliTagId: tagid,
    });
  }

  const resolve = tagToGroupId(groups);
  const membership: Membership = {};
  const snapshot: Snapshot = {};
  for (const u of followings) {
    setMembership(membership, u.mid, storableGroupIds(u, resolve));
    snapshot[String(u.mid)] = snapshotOf(u);
  }

  const ok = saveGroups(groups) && saveMembership(membership) && saveSnapshot(snapshot);
  return ok;
}

// ── 合并导入 ────────────────────────────────────────────────────────────

/**
 * 把 B站 分组映射到本地分组，**必要时复用同名本地分组**。
 *
 * 匹配顺序（顺序很重要）：
 *  1. 已有分组的 `biliTagId` 等于该 tagid —— 之前导入过它
 *  2. 存在**同名**的本地分组 —— 视为同一个分组，把 tagid 记上去
 *  3. 都没有 —— 新建 `bili-<tagid>`
 *
 * 第 2 条修的是一个真实 bug：用户先在本地建了「娱乐」，之后在 B站 也建了
 * 「娱乐」并加了人。补充导入时因为 id 前缀不同（`local-1` vs `bili-386068xxx`）
 * 被判定成"本地没有"，于是新建了一个同名分组，UP 全进了新组，出现两个同名
 * 分组。根因是**只按 id 去重，没按名字去重**。
 */
function ensureGroupsForTags(groups: Group[], tags: BiliTag[]): { adopted: string[] } {
  const adopted: string[] = [];
  let maxOrder = groups.reduce(
    (acc, g) => (g.order < ORDER_UNCATEGORIZED ? Math.max(acc, g.order) : acc),
    ORDER_CUSTOM_START - 1,
  );

  for (const t of tags) {
    if (t.tagid === BILI_SPECIAL_TAGID || t.tagid === BILI_DEFAULT_TAGID) continue;
    if (groups.some((g) => g.biliTagId === t.tagid)) continue;

    const name = t.name.trim();
    const sameName = groups.find((g) => g.kind === 'normal' && g.name === name);
    if (sameName) {
      sameName.biliTagId = t.tagid;
      adopted.push(name);
      continue;
    }

    groups.push({
      id: `bili-${t.tagid}`,
      name: t.name,
      order: ++maxOrder,
      kind: 'normal',
      source: 'bilibili',
      biliTagId: t.tagid,
    });
  }
  return { adopted };
}

/**
 * 合并导入（「补充导入分组」）：**只给本地尚未分类的 UP 按 B站 归类**，
 * 已有本地归类的一律不动。
 *
 * 快照也**只对本次真正归类过的 UP 更新** —— 否则一个尚未处理的分歧会被
 * 静默清掉，用户就再也看不到那个提示了。
 */
export function mergeImport(
  tags: BiliTag[],
  followings: TrimmedFollowedUp[],
): { added: number; adopted: string[] } {
  const groups = loadGroups();
  const membership = loadMembership();
  const snapshot = loadSnapshot();

  // B站 的 tags 未列出、但被 followings 引用到的 tagid 也要补上，
  // 否则会产生指向不存在分组的脏引用
  const known = new Set(tags.map((t) => t.tagid));
  const extra: BiliTag[] = [];
  for (const u of followings) {
    for (const tagid of snapshotOf(u)) {
      if (tagid === BILI_SPECIAL_TAGID || tagid === BILI_DEFAULT_TAGID) continue;
      if (known.has(tagid)) continue;
      known.add(tagid);
      extra.push({ tagid, name: `分组 ${tagid}`, count: 0 });
    }
  }

  // 把 B站 分组映射到本地分组（同名则复用已有分组，不新建）
  const { adopted } = ensureGroupsForTags(groups, [...tags, ...extra]);
  const resolve = tagToGroupId(groups);

  let added = 0;
  for (const u of followings) {
    if (membership[String(u.mid)] === undefined) {
      setMembership(membership, u.mid, storableGroupIds(u, resolve));
      snapshot[String(u.mid)] = snapshotOf(u);
      added++;
    }
  }

  saveGroups(groups);
  saveMembership(membership);
  saveSnapshot(snapshot);
  return { added, adopted };
}

// ── 分组 CRUD ───────────────────────────────────────────────────────────

export function createGroup(name: string): Group | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > MAX_GROUP_NAME) return null;

  const groups = loadGroups();
  if (groups.some((g) => g.name === trimmed)) return null;

  let maxLocal = 0;
  for (const g of groups) {
    const m = /^local-(\d+)$/.exec(g.id);
    if (m) maxLocal = Math.max(maxLocal, Number(m[1]));
  }
  const maxOrder = groups.reduce(
    (acc, g) => (g.order < ORDER_UNCATEGORIZED ? Math.max(acc, g.order) : acc),
    ORDER_CUSTOM_START - 1,
  );

  const group: Group = {
    id: `local-${maxLocal + 1}`,
    name: trimmed,
    order: maxOrder + 1,
    kind: 'normal',
    source: 'local',
  };
  groups.push(group);
  if (!saveGroups(groups)) return null;
  return group;
}

export function renameGroup(id: string, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > MAX_GROUP_NAME) return false;

  const groups = loadGroups();
  const g = groups.find((x) => x.id === id);
  if (!g || g.kind === 'system') return false;
  g.name = trimmed;
  return saveGroups(groups);
}

/** 删除分组：组内 UP 全部回落未分类，并清理所有脏引用 */
export function deleteGroup(id: string): boolean {
  const groups = loadGroups();
  const g = groups.find((x) => x.id === id);
  if (!g || g.kind === 'system') return false;

  saveGroups(groups.filter((x) => x.id !== id));

  const membership = loadMembership();
  let changed = false;
  for (const mid of Object.keys(membership)) {
    if (membership[mid].includes(id)) {
      setMembership(membership, Number(mid), membership[mid].filter((x) => x !== id));
      changed = true;
    }
  }
  if (changed) saveMembership(membership);
  return true;
}

/**
 * 按给定顺序重写全部分组的 `order`。拖拽排序与 ↑/↓ 都走这里。
 *
 * 传入的是**完整**的分组 id 顺序 —— 板块视图和侧边栏都按 `order` 排，
 * 所以一次重写两边同步，不会出现"主区顺序和侧边栏不一致"。
 */
export function reorderGroups(orderedIds: string[]): boolean {
  const groups = loadGroups();
  const rank = new Map(orderedIds.map((id, i) => [id, i]));
  // 不在传入列表里的（理论上不该有）排到最后，但彼此不撞号
  let fallback = ORDER_CUSTOM_START + orderedIds.length;
  for (const g of groups) {
    const r = rank.get(g.id);
    g.order = r === undefined ? fallback++ : ORDER_CUSTOM_START + r;
  }
  return saveGroups(groups);
}

/**
 * 上移/下移一位。
 *
 * 现在**允许移动任意分组**（含「特别关注」「未分类」）—— 用户要的是排版权，
 * 而 `special` 置顶本来只是初始默认值，不是不可变规则。
 */
export function reorderGroup(id: string, dir: -1 | 1): boolean {
  const ordered = loadGroups()
    .sort((a, b) => a.order - b.order)
    .map((g) => g.id);

  const i = ordered.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ordered.length) return false;

  [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
  return reorderGroups(ordered);
}

// ── 批量分类 ────────────────────────────────────────────────────────────

/** 上一次批量操作前的 membership 快照（仅内存，不落盘） */
let lastBatchBackup: Membership | null = null;

export function applyBatch(mids: number[], op: BatchOp): boolean {
  const membership = loadMembership();
  lastBatchBackup = JSON.parse(JSON.stringify(membership)) as Membership;

  for (const mid of mids) {
    const key = String(mid);
    switch (op.type) {
      case 'add': {
        const cur = membership[key] ?? [];
        setMembership(membership, mid, cur.includes(op.groupId) ? cur : [...cur, op.groupId]);
        break;
      }
      case 'remove': {
        const cur = membership[key] ?? [];
        setMembership(membership, mid, cur.filter((x) => x !== op.groupId));
        break;
      }
      case 'only': {
        setMembership(membership, mid, [op.groupId]);
        break;
      }
      case 'clear': {
        setMembership(membership, mid, []);
        break;
      }
    }
  }

  return saveMembership(membership);
}

export function undoLastBatch(): boolean {
  if (!lastBatchBackup) return false;
  const ok = saveMembership(lastBatchBackup);
  lastBatchBackup = null;
  return ok;
}

export function canUndoBatch(): boolean {
  return lastBatchBackup !== null;
}

// ── 分歧检测与单项重置 ──────────────────────────────────────────────────

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * 检测哪些 UP 的 B站 分组**自上次导入以来**发生了变化。
 *
 * 必须用快照对比，而不是拿"B站 当前值"直接和本地 membership 比 —— 后者会把
 * **所有用户在本地手动改过的 UP 都误标成"B站 变了"**，让标记失去意义。
 */
export function detectDivergence(followings: TrimmedFollowedUp[]): Set<number> {
  const snapshot = loadSnapshot();
  const out = new Set<number>();
  for (const u of followings) {
    const prev = snapshot[String(u.mid)];
    if (!prev) continue; // 本地从未导入过它，谈不上分歧
    if (!sameSet(prev, snapshotOf(u))) out.add(u.mid);
  }
  return out;
}

/** 用 B站 当前分组覆盖某一个 UP 的本地归类（单项重置） */
export function resetFromBilibili(mid: number, followings: TrimmedFollowedUp[]): boolean {
  const up = followings.find((u) => u.mid === mid);
  if (!up) return false;

  const membership = loadMembership();
  const snapshot = loadSnapshot();
  setMembership(membership, mid, storableGroupIds(up, tagToGroupId(loadGroups())));
  snapshot[String(mid)] = snapshotOf(up);
  return saveMembership(membership) && saveSnapshot(snapshot);
}

/**
 * 把所有检测到分歧的 UP **按 B站 当前分组批量对齐**。返回处理的数量。
 *
 * 这是三级同步能力里原先缺失的中间一级：
 *  按 B站 重置此项（单个）← 太累
 *  **本函数（只碰有分歧的）** ← 新增
 *  强制覆盖（全部，会清掉纯本地的分类）← 太重
 */
export function resetAllDiverged(followings: TrimmedFollowedUp[]): number {
  const ids = detectDivergence(followings);
  if (ids.size === 0) return 0;

  const resolve = tagToGroupId(loadGroups());
  const membership = loadMembership();
  const snapshot = loadSnapshot();

  for (const u of followings) {
    if (!ids.has(u.mid)) continue;
    setMembership(membership, u.mid, storableGroupIds(u, resolve));
    snapshot[String(u.mid)] = snapshotOf(u);
  }

  saveMembership(membership);
  saveSnapshot(snapshot);
  return ids.size;
}

/**
 * 「保持我的分类」：只把快照更新到 B站 当前值，**不改动任何 membership**。
 *
 * 语义不是"隐藏提示"，而是"我看过了，决定保留自己的分类" —— 快照推进之后
 * 这些项自然不再被判定为分歧，也就不会再提示。用户在本次操作前的分类完好无损。
 */
export function acknowledgeDivergence(followings: TrimmedFollowedUp[]): number {
  const ids = detectDivergence(followings);
  if (ids.size === 0) return 0;

  const snapshot = loadSnapshot();
  for (const u of followings) {
    if (ids.has(u.mid)) snapshot[String(u.mid)] = snapshotOf(u);
  }
  saveSnapshot(snapshot);
  return ids.size;
}

// ── 清理 ────────────────────────────────────────────────────────────────

/** 清理不在当前关注列表里的 membership / snapshot 记录，返回释放的字符数估算 */
export function pruneStale(followings: TrimmedFollowedUp[]): number {
  const alive = new Set(followings.map((u) => String(u.mid)));
  const membership = loadMembership();
  const snapshot = loadSnapshot();

  let before = 0;
  for (const [k, v] of Object.entries(membership)) before += k.length + JSON.stringify(v).length;
  for (const [k, v] of Object.entries(snapshot)) before += k.length + JSON.stringify(v).length;

  for (const k of Object.keys(membership)) if (!alive.has(k)) delete membership[k];
  for (const k of Object.keys(snapshot)) if (!alive.has(k)) delete snapshot[k];

  saveMembership(membership);
  saveSnapshot(snapshot);

  let after = 0;
  for (const [k, v] of Object.entries(membership)) after += k.length + JSON.stringify(v).length;
  for (const [k, v] of Object.entries(snapshot)) after += k.length + JSON.stringify(v).length;

  return Math.max(0, before - after);
}
