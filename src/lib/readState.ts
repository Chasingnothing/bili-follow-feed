import { readJson, writeJson } from './storage';

const READ_KEY = 'bff:readVideos';
const VISIT_KEY = 'bff:lastVisitAt';

/**
 * 已读集合上限。
 *
 * `bff:readVideos` 是全部存储键里**唯一单调递增、没有天然上限**的一个 ——
 * 每点一个视频就加一条，永不清理。3000 条足以覆盖动态流能翻到的范围：
 * 更早的 bvid 不可能再出现在页面上，保留它们没有意义。
 * 3000 × 约 17 字符 ≈ 50 KB，之后固定在 50 KB 不再增长（设计文档 §15.2）。
 */
export const MAX_READ = 3000;

/** 读取已读集合。数据损坏时回落空集合 —— 不应因为脏数据白屏。 */
export function loadRead(): Set<string> {
  const arr = readJson<unknown>(READ_KEY, []);
  if (!Array.isArray(arr)) return new Set();
  return new Set(arr.filter((x): x is string => typeof x === 'string'));
}

/**
 * 写入已读集合，**返回是否成功**。
 *
 * 不能再像热身版那样静默吞掉异常：配额写满、或用户在浏览器设置里禁用了
 * 网站数据时，已读标记会从此不再保存，而界面上毫无迹象 —— 用户只会觉得
 * "刷新后怎么又变回未读了"。调用方必须把返回值暴露到界面上。
 *
 * 数组保留插入顺序，超出上限时从**最早**的开始丢。
 */
export function saveRead(s: Set<string>): boolean {
  const arr = [...s];
  const capped = arr.length > MAX_READ ? arr.slice(arr.length - MAX_READ) : arr;
  return writeJson(READ_KEY, capped);
}

/** 返回新集合，不修改入参 */
export function markRead(s: Set<string>, bvid: string): Set<string> {
  const next = new Set(s);
  next.add(bvid);
  return next;
}

export function markAllRead(bvids: string[]): Set<string> {
  return new Set(bvids);
}

export function loadLastVisit(): number {
  const n = readJson<unknown>(VISIT_KEY, 0);
  const num = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(num) ? num : 0;
}

export function saveLastVisit(ts: number): boolean {
  return writeJson(VISIT_KEY, ts);
}
