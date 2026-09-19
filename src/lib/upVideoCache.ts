import type { FeedItem } from '../types';
import { readJson, writeJson, removeKey } from './storage';
import { itemUrl } from './links';

/**
 * 模式 2（UP 主拉取）的按 UP 视频缓存。
 *
 * ## 为什么一个 UP 一个 key
 *
 * 分支上的旧实现把所有 UP 塞进**一个** blob，写入是"读出全部 → 改一条 → 写回全部"。
 * 缓存满时（6000 张 ≈ 4.5 MiB）每次要全量 `parse + stringify + setItem`，
 * 而拉取是**每拉完一个 UP 就落盘一次** —— 拉 500 个 UP 就是 500 次全量序列化，
 * 累计几十秒的主线程阻塞。
 *
 * 拆成一个 UP 一个 key 之后，每次写入只处理自己那 5 张（小几百倍），
 * 淘汰也只需要**读 key 名**（key 里就带着 mid），不用解析任何 value。
 *
 * ## 容量
 *
 * 每 UP `MAX_PER_UP` 条 × `MAX_UPS` 个 UP。实测的单张瘦身卡片约 317 单元，
 * 600 个 UP 约 1.8 MiB —— 占 Chrome 的 10 MiB 约 18%、Firefox 的 5 MiB 约 37%。
 *
 * ## 淘汰判据用 `lastUsedAt` 而不是 `at`
 *
 * `at` 只在**发请求**时更新，而模式 2 的「多看一条」揭示缓存**不发请求** ——
 * 只看 `at` 的话，你正在看的板块反而会因为"很久没发请求"被挤掉。
 */

const PREFIX = 'bff:up:';
/** 每个 UP 最多留几条。实测大部分人不会刷到第 5 条以后 */
export const MAX_PER_UP = 5;
/** 最多缓存多少个 UP —— 防止占用随关注数无限增长 */
export const MAX_UPS = 600;

/** 落盘用的瘦身卡片：去掉能由 key 或 id 推导的字段 */
export type StoredItem = Omit<FeedItem, 'upMid' | 'url'>;

export interface UpEntry {
  /** 上次**发请求**的时间 */
  at: number;
  /** 上次**被使用**（揭示/展示）的时间 —— 淘汰按它排序 */
  lastUsedAt: number;
  cards: StoredItem[];
}

const keyOf = (mid: number) => `${PREFIX}${mid}`;

/**
 * 瘦身：`upMid` 就是 key 本身，`url` 可由 `id`+`kind` 拼出。
 *
 * 名字和头像**保留** —— 已取关的 UP 不在 `upIndex` 里，去掉它们卡片就没名字了。
 */
export function slimItem(item: FeedItem): StoredItem {
  const { upMid: _upMid, url: _url, ...rest } = item;
  return rest;
}

/** 展开：把 key 里的 mid 和推导出的 url 补回去 */
export function expandItem(mid: number, stored: StoredItem): FeedItem {
  return { ...stored, upMid: mid, url: itemUrl(stored.id, stored.kind) };
}

function isEntry(v: unknown): v is UpEntry {
  return (
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Array.isArray((v as UpEntry).cards)
  );
}

export function loadUpEntry(mid: number): UpEntry | null {
  const raw = readJson<unknown>(keyOf(mid), null);
  return isEntry(raw) ? raw : null;
}

/** 某个 UP 已缓存的条目（展开成 FeedItem），没有则空数组 */
export function loadUpItems(mid: number): FeedItem[] {
  const e = loadUpEntry(mid);
  return e ? e.cards.map((c) => expandItem(mid, c)) : [];
}

/** 缓存里所有 UP 的 mid —— **只读 key 名**，不解析任何 value（计数器要用） */
export function cachedMids(): number[] {
  const out: number[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      const mid = Number(k.slice(PREFIX.length));
      if (Number.isFinite(mid) && mid > 0) out.push(mid);
    }
  } catch {
    /* 读不到就当作空 */
  }
  return out;
}

/**
 * 选出要淘汰的 UP。
 *
 * 纯函数，便于测试。按 `lastUsedAt` 从旧到新淘汰，直到剩下不超过 `max` 个。
 * 时间相同时按 mid 排，保证结果稳定（否则同一个输入可能给出不同答案）。
 */
export function pickEvictions(
  entries: Array<{ mid: number; lastUsedAt: number }>,
  max: number,
): number[] {
  if (entries.length <= max) return [];
  const sorted = [...entries].sort(
    (a, b) => a.lastUsedAt - b.lastUsedAt || a.mid - b.mid,
  );
  return sorted.slice(0, entries.length - max).map((e) => e.mid);
}

/** 当前缓存的 `{mid, at, lastUsedAt}` 列表（淘汰/判新前算一次就够，别每个 UP 都扫一遍） */
export function cachedUsage(): Array<{ mid: number; at: number; lastUsedAt: number }> {
  return cachedMids().map((mid) => {
    const e = loadUpEntry(mid);
    return { mid, at: e?.at ?? 0, lastUsedAt: e?.lastUsedAt ?? 0 };
  });
}

/**
 * 写入某个 UP 的视频（只留最新 `MAX_PER_UP` 条），返回是否成功。
 *
 * 顺带做淘汰：先把超过上限的 UP 删掉，再写自己这条 —— 顺序很重要，
 * 否则可能刚写完就把自己删了。
 */
export function saveUpItems(mid: number, items: FeedItem[], now: number): boolean {
  const evict = pickEvictions(cachedUsage(), MAX_UPS - 1);
  for (const m of evict) removeKey(keyOf(m));

  const entry: UpEntry = {
    at: now,
    lastUsedAt: now,
    cards: items.slice(0, MAX_PER_UP).map(slimItem),
  };
  return writeJson(keyOf(mid), entry);
}

/**
 * 标记某个 UP "刚被用过"（揭示内容时调用）。
 *
 * 不更新 `at` —— 那代表"上次发请求"，语义不同。
 */
export function touchUp(mid: number, now: number): void {
  const e = loadUpEntry(mid);
  if (!e) return;
  writeJson(keyOf(mid), { ...e, lastUsedAt: now } satisfies UpEntry);
}

/** 清掉所有 UP 缓存，返回清掉几个 */
export function clearUpItems(): number {
  const mids = cachedMids();
  for (const m of mids) removeKey(keyOf(m));
  return mids.length;
}

/** 某个 UP 上次发请求的时间；从未拉过为 0 */
export function fetchedAt(mid: number): number {
  return loadUpEntry(mid)?.at ?? 0;
}

/**
 * 一次性读出**所有** UP 的条目，按 mid 分组。
 *
 * 组装模式 2 的板块时要遍历几百个 UP —— 逐个调 `loadUpItems` 就是几百次
 * `localStorage.getItem + JSON.parse`，每次渲染都做一遍会卡。
 * 所以走这一条：扫描一次 `localStorage`，只解析 `bff:up:` 开头的键。
 */
export function loadAllItems(): Map<number, FeedItem[]> {
  const out = new Map<number, FeedItem[]>();
  for (const mid of cachedMids()) {
    const e = loadUpEntry(mid);
    if (!e) continue;
    out.set(
      mid,
      e.cards.map((c) => expandItem(mid, c)),
    );
  }
  return out;
}
