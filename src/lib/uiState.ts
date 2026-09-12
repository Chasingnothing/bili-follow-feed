import { readJson, writeJson } from './storage';

/** 侧边栏里分组的折叠状态 */
export const SIDEBAR_COLLAPSED_KEY = 'bff:collapsedGroups';
/** 主视图里板块的折叠状态。与侧边栏**互相独立** —— 折叠一边不该影响另一边。 */
export const SECTION_COLLAPSED_KEY = 'bff:collapsedSections';

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
