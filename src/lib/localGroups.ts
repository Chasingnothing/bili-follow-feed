import type { BiliTag, TrimmedFollowedUp } from '../types';
import { readJson, writeJson } from './storage';
import { SPECIAL_ID, UNCATEGORIZED_ID, biliGroupIdsOf } from './upIndex';

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
function storableGroupIds(up: TrimmedFollowedUp): string[] {
  return biliGroupIdsOf(up).filter((id) => id !== UNCATEGORIZED_ID);
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
    });
  }

  const membership: Membership = {};
  const snapshot: Snapshot = {};
  for (const u of followings) {
    setMembership(membership, u.mid, storableGroupIds(u));
    snapshot[String(u.mid)] = snapshotOf(u);
  }

  const ok = saveGroups(groups) && saveMembership(membership) && saveSnapshot(snapshot);
  return ok;
}

// ── 合并导入 ────────────────────────────────────────────────────────────

/**
 * 合并导入（「补充导入分组」）：**只给本地尚未分类的 UP 按 B站 归类**，
 * 已有本地归类的一律不动。
 *
 * 快照也**只对本次真正归类过的 UP 更新** —— 否则一个尚未处理的分歧会被
 * 静默清掉，用户就再也看不到那个提示了。
 */
export function mergeImport(tags: BiliTag[], followings: TrimmedFollowedUp[]): { added: number } {
  const groups = loadGroups();
  const membership = loadMembership();
  const snapshot = loadSnapshot();

  // 补上 B站 新增的、本地还没有的分组
  const existing = new Set(groups.map((g) => g.id));
  let maxOrder = groups.reduce(
    (acc, g) => (g.order < ORDER_UNCATEGORIZED ? Math.max(acc, g.order) : acc),
    ORDER_CUSTOM_START - 1,
  );
  for (const t of tags) {
    if (t.tagid === BILI_SPECIAL_TAGID || t.tagid === BILI_DEFAULT_TAGID) continue;
    const id = `bili-${t.tagid}`;
    if (existing.has(id)) continue;
    groups.push({ id, name: t.name, order: ++maxOrder, kind: 'normal', source: 'bilibili' });
    existing.add(id);
  }

  let added = 0;
  for (const u of followings) {
    if (membership[String(u.mid)] === undefined) {
      setMembership(membership, u.mid, storableGroupIds(u));
      snapshot[String(u.mid)] = snapshotOf(u);
      added++;
    }
  }

  saveGroups(groups);
  saveMembership(membership);
  saveSnapshot(snapshot);
  return { added };
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

/** 上移/下移。系统分组的 order 是固定的，不允许移动。 */
export function reorderGroup(id: string, dir: -1 | 1): boolean {
  const groups = loadGroups();
  const movable = groups
    .filter((g) => g.kind === 'normal')
    .sort((a, b) => a.order - b.order);
  const idx = movable.findIndex((g) => g.id === id);
  if (idx < 0) return false;
  const target = idx + dir;
  if (target < 0 || target >= movable.length) return false;

  const a = movable[idx];
  const b = movable[target];
  const tmp = a.order;
  a.order = b.order;
  b.order = tmp;
  return saveGroups(groups);
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
  setMembership(membership, mid, storableGroupIds(up));
  snapshot[String(mid)] = snapshotOf(up);
  return saveMembership(membership) && saveSnapshot(snapshot);
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
