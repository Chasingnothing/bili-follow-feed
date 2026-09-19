import type { TrimmedFollowedUp } from '../types';
import type { Group } from './localGroups';
import { UNCATEGORIZED_ID } from './upIndex';

/**
 * 把关注列表按**本地分组**归类。
 *
 * 侧边栏和模式 2 都要用同一套归属规则，所以抽在这里 —— 两边各写一遍迟早会漂移
 * （比如一边处理脏引用、另一边不处理）。
 *
 * 规则：
 *  - 一个 UP 属于多个分组时，他在**每个**分组里都出现
 *  - 没有 membership、或 membership 为空 → 未分类
 *  - membership 指向**已删除的分组**（脏引用）→ 也归未分类，不能让 UP 消失
 *  - 即使某个分组一个人都没有，也会有一个空数组（UI 要显示占位）
 */
export function groupFollowings(
  groups: Group[],
  membership: Record<string, string[]>,
  followings: TrimmedFollowedUp[],
): Map<string, TrimmedFollowedUp[]> {
  const map = new Map<string, TrimmedFollowedUp[]>();
  for (const g of groups) map.set(g.id, []);
  if (!map.has(UNCATEGORIZED_ID)) map.set(UNCATEGORIZED_ID, []);

  for (const u of followings) {
    const gids = membership[String(u.mid)];
    const targets = gids && gids.length > 0 ? gids : [UNCATEGORIZED_ID];
    for (const gid of targets) {
      const bucket = map.has(gid) ? gid : UNCATEGORIZED_ID;
      map.get(bucket)!.push(u);
    }
  }
  return map;
}
