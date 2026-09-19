import type { FeedItem } from '../types';
import type { Group } from './localGroups';
import { UNCATEGORIZED_ID } from './upIndex';

export interface Section {
  group: Group;
  items: FeedItem[];
}

/**
 * 把动态流里的内容按 UP 的**本地分组**切成分区。
 *
 * 三点行为约定：
 *  1. 一个 UP 属于多个分组时，他的内容**在每个所属板块都出现**（符合直觉：
 *     你在「特别关注」和「技术分组」里都关注了他）
 *  2. **没有内容的分组仍然产出一个 Section** —— UI 层要显示占位或折叠，
 *     直接过滤掉会让用户以为分组丢了
 *  3. membership 指向已删除分组的脏引用、或 UP 不在 membership 里，一律归入未分类
 */
export function buildSections(
  items: FeedItem[],
  groups: Group[],
  membership: Record<string, string[]>,
  collator?: (a: FeedItem, b: FeedItem) => number,
): Section[] {
  const byGroup = new Map<string, FeedItem[]>();
  for (const g of groups) byGroup.set(g.id, []);

  for (const v of items) {
    const gids = membership[String(v.upMid)];
    const targets = gids && gids.length > 0 ? gids : [UNCATEGORIZED_ID];
    for (const gid of targets) {
      // 脏引用（指向已删除的分组）按未分类处理
      const bucket = byGroup.has(gid) ? gid : UNCATEGORIZED_ID;
      byGroup.get(bucket)?.push(v);
    }
  }

  const ordered = [...groups].sort((a, b) => a.order - b.order);
  return ordered.map((group) => {
    const list = byGroup.get(group.id) ?? [];
    return { group, items: collator ? [...list].sort(collator) : list };
  });
}
