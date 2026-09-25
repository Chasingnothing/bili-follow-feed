import { readJson, writeJson } from './storage';

/** 侧边栏里分组的折叠状态 */
export const SIDEBAR_COLLAPSED_KEY = 'bff:collapsedGroups';
/** 主视图里板块的折叠状态。与侧边栏**互相独立** —— 折叠一边不该影响另一边。 */
export const SECTION_COLLAPSED_KEY = 'bff:collapsedSections';
/** 当前模式：动态流 / UP 主拉取 */
export const MODE_KEY = 'bff:mode';

export function loadCollapsed(key: string): Set<string> {
  const arr = readJson<unknown>(key, []);
  if (!Array.isArray(arr)) return new Set();
  return new Set(arr.filter((x): x is string => typeof x === 'string'));
}

export function saveCollapsed(key: string, s: Set<string>): boolean {
  return writeJson(key, [...s]);
}

/** 返回新集合，不修改入参 */
export function toggleCollapsed(s: Set<string>, id: string): Set<string> {
  const next = new Set(s);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export type FeedMode = 'feed' | 'upPull';

export function loadMode(): FeedMode {
  return readJson<unknown>(MODE_KEY, 'feed') === 'upPull' ? 'upPull' : 'feed';
}

export function saveMode(m: FeedMode): boolean {
  return writeJson(MODE_KEY, m);
}

/*
 * 模式 2 的「层数」**刻意不落盘**。
 *
 * 它曾经存在 `bff:upLayers` 里，副作用是：你每次在某个板块点过「多看一条」，
 * 那个板块就被永久记住 —— 过一阵子回头看，各个板块都停在第二层，
 * 而界面上没有任何提示，用户只觉得"不对劲"。
 *
 * 关键在于**重置的代价是零**：「多看一条」只读缓存、不发任何请求，
 * 刷新后回到第一层，损失的只是"再点一下"。持久化换来的却是跨会话悄悄累积的状态。
 * 这个交换是亏的，所以层数只活在组件 state 里（`App.tsx` 的 `upLayers`）。
 *
 * 老用户的 localStorage 里可能还留着一个 `bff:upLayers` 死键，不再被读取，无害。
 */
