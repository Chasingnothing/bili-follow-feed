import type { FeedItem, TrimmedFollowedUp } from '../types';
import type { Group } from './localGroups';
import { groupFollowings } from './groupMembership';
import { HIDDEN_ID, UNCATEGORIZED_ID } from './upIndex';
import { MAX_PER_UP } from './upVideoCache';

/**
 * 模式 2 的板块组装。
 *
 * ⚠️ 方向和模式 1 **相反**，不能复用 `buildSections`：
 *  - 模式 1：拿到一堆积视频卡片 → 按 UP 的归属分到各板块
 *  - 模式 2：拿到每个板块的 **UP 列表** → 去缓存里取他们的视频
 *
 * 所以模式 2 的板块里可以出现"有 UP 但一条缓存都没有"的情况（刚进页面就是这样），
 * 而模式 1 那种"空分组也产出 Section"的约定在这里含义不同。
 */

/** 层数上限 = 每个 UP 保留的条数 */
export const MAX_LAYER = MAX_PER_UP;

/** 层数夹到 `[1, MAX_LAYER]`；非法值（缺省 / 手改存储）一律当 1 */
export function clampLayer(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 1;
  return Math.min(MAX_LAYER, Math.max(1, Math.floor(v)));
}

export interface UpSectionModel {
  group: Group;
  /** 该板块的全部 UP —— 计数器的分母 */
  ups: TrimmedFollowedUp[];
  /** 其中**已经有内容**的 UP 数 —— 计数器的分子 */
  cachedCount: number;
  /**
   * 其中**已经查过**的 UP 数（含"查过了但一条可显示内容都没有"的空条目）。
   *
   * `checkedCount > cachedCount` 的那部分就是"全是转发/直播推广位"的 UP ——
   * 界面要把它说出来，否则用户会一直纳闷计数器为什么到不了满分。
   */
  checkedCount: number;
  /** 该板块要显示的条目（已按层裁剪、已排序） */
  items: FeedItem[];
  /** 该板块当前层数（`1..MAX_LAYER`） */
  layer: number;
}

export interface UpSectionsOptions {
  groups: Group[];
  membership: Record<string, string[]>;
  followings: TrimmedFollowedUp[];
  /** 每个板块的层数，key 为 groupId */
  layers: Record<string, number>;
  /** 每个 UP 已缓存的条目（**最新在前**，由 upVideoCache 保证） */
  cache: Map<number, FeedItem[]>;
  collator?: (a: FeedItem, b: FeedItem) => number;
}

/**
 * 组装模式 2 的板块。
 *
 * **「未分类」和「隐藏」不产出板块** —— 模式 2 的卖点是"按 UP 逐个看"，
 * 而未分类里那几百个 UP 正是没被整理过的，逐个拉既慢又没意义（这个决定在
 * 设计文档 §3 里由用户确认过）。
 *
 * 层数只是**过滤条件**：每个 UP 最多贡献前 `layer` 条，然后整体统一排序，
 * 所以不存在"层与层之间怎么排"的问题。
 */
export function buildUpSections(opts: UpSectionsOptions): UpSectionModel[] {
  const { groups, membership, followings, layers, cache, collator } = opts;
  const byGroup = groupFollowings(groups, membership, followings);

  return groups
    .filter((g) => g.id !== HIDDEN_ID && g.id !== UNCATEGORIZED_ID)
    .sort((a, b) => a.order - b.order)
    .map((group) => {
      const ups = byGroup.get(group.id) ?? [];
      const layer = clampLayer(layers[group.id]);

      const pool: FeedItem[] = [];
      let cachedCount = 0;
      let checkedCount = 0;
      for (const u of ups) {
        const items = cache.get(u.mid);
        // `has` 与 `length` 分开判：空数组代表"查过了但没内容"，是有意义的状态
        if (!items) continue;
        checkedCount++;
        if (items.length === 0) continue;
        cachedCount++;
        // 缓存里是最新在前，取前 layer 条就是"这个 UP 最新的 layer 条"
        pool.push(...items.slice(0, layer));
      }

      return {
        group,
        ups,
        cachedCount,
        checkedCount,
        items: collator ? [...pool].sort(collator) : pool,
        layer,
      };
    });
}
