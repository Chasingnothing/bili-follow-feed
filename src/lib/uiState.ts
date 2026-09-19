import { readJson, writeJson } from './storage';
import { clampLayer } from './upSections';

/** 侧边栏里分组的折叠状态 */
export const SIDEBAR_COLLAPSED_KEY = 'bff:collapsedGroups';
/** 主视图里板块的折叠状态。与侧边栏**互相独立** —— 折叠一边不该影响另一边。 */
export const SECTION_COLLAPSED_KEY = 'bff:collapsedSections';
/** 当前模式：动态流 / UP 主拉取 */
export const MODE_KEY = 'bff:mode';
/** 模式 2 里每个板块的层数 */
export const UP_LAYERS_KEY = 'bff:upLayers';

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

/**
 * 读回各板块的层数。
 *
 * 逐个过 `clampLayer` —— 存储是可手改的，而且 `MAX_LAYER` 将来变了，
 * 老值可能越界。这里收口，组装层就不用再担心。
 */
export function loadUpLayers(): Record<string, number> {
  const raw = readJson<unknown>(UP_LAYERS_KEY, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    out[k] = clampLayer(v);
  }
  return out;
}

export function saveUpLayers(layers: Record<string, number>): boolean {
  return writeJson(UP_LAYERS_KEY, layers);
}
