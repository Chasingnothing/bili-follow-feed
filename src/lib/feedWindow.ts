import type { FeedPage, FeedItem } from '../types';

export interface FillResult {
  pages: number;
  covered: boolean;
  stoppedBy: 'covered' | 'end' | 'cap' | 'paused';
}

export interface FillOptions {
  fetchPage: (offset: string | null) => Promise<FeedPage>;
  /** 从哪个游标继续；首页传 null */
  startOffset: string | null;
  /** 窗口边界（秒级）。某页最早一条早于它，就认为窗口已覆盖 */
  cutoffTs: number;
  maxPages: number;
  onPage: (page: FeedPage, index: number) => void;
  delayMs: number;
  sleep: (ms: number) => Promise<void>;
  /**
   * 每页开始前询问是否应中断（用户点了暂停）。
   *
   * 判据在**页边界**上检查：当前这一页会跑完，最多多等一次限速（约 400ms）+ 一次往返。
   * 这样暂停不会把结果丢弃 —— 已经拉到的页都已经通过 `onPage` 交给调用方了。
   */
  shouldStop?: () => boolean;
}

/**
 * 继续翻页，直到覆盖到时间窗边界、触达上限、或用户点了暂停。
 *
 * 抽成独立函数是为了**可测**：编排逻辑（何时停、翻了几页、何时限速）不该埋在
 * React hook 里。依赖全部由参数注入，测试时传假的 fetchPage / sleep 即可。
 *
 * 停止条件四条，谁先满足算谁：
 *  0. `shouldStop()` 为真         → `paused`（用户主动中断）
 *  1. 某页最早一条 < cutoffTs  → `covered`
 *  2. 流到底（has_more=false / 无游标 / 空页）→ `end`
 *  3. 翻满 maxPages            → `cap`（调用方应据此提示"未完全覆盖"）
 */
export async function fillToCutoff(opts: FillOptions): Promise<FillResult> {
  const { fetchPage, startOffset, cutoffTs, maxPages, onPage, delayMs, sleep, shouldStop } = opts;

  let offset = startOffset;
  let pages = 0;
  let stoppedBy: FillResult['stoppedBy'] = 'cap';

  while (pages < maxPages) {
    // 在**取下一页之前**检查：当前这一页已经交付，不浪费也不丢结果
    if (shouldStop?.()) {
      stoppedBy = 'paused';
      break;
    }

    const page = await fetchPage(offset);
    pages++;
    onPage(page, pages);

    // oldestPubTs === 0 表示这一页没有任何条目 —— 到头了
    if (!page.hasMore || !page.nextOffset || page.oldestPubTs === 0) {
      stoppedBy = 'end';
      break;
    }

    if (page.oldestPubTs < cutoffTs) {
      stoppedBy = 'covered';
      break;
    }

    offset = page.nextOffset;
    await sleep(delayMs);
  }

  return { pages, covered: stoppedBy === 'covered', stoppedBy };
}

/** 时间窗选项（小时）。0 表示不补齐，只加载第一页 */
export const WINDOW_OPTIONS: Array<{ hours: number; label: string }> = [
  { hours: 0, label: '仅首页' },
  { hours: 6, label: '6 小时' },
  { hours: 24, label: '1 天' },
  { hours: 72, label: '3 天' },
];

export function cutoffFor(hours: number, nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000) - hours * 3600;
}

export interface IncrementalResult {
  /** 新增的条目（按动态流顺序，越靠前越新） */
  fresh: FeedItem[];
  /** 是否追上了已知内容（false = 离线太久，调用方应退回完整加载） */
  caughtUp: boolean;
  pages: number;
  /**
   * 是否因为用户点了暂停而提前收工。
   *
   * ⚠️ 调用方**不能**把 `paused` 当成 `caughtUp: false` 处理 —— 后者意味着
   * "离线太久、缓存有断层，必须整体重来"，而暂停只是"先停一下"，
   * 已经收到的 `fresh` 是有效的，直接并进缓存即可。
   */
  paused: boolean;
}

export interface IncrementalOptions {
  fetchPage: (offset: string | null) => Promise<FeedPage>;
  /** 本地已有的 bvid */
  known: Set<string>;
  maxPages: number;
  onPage?: (fresh: FeedItem[], index: number) => void;
  delayMs: number;
  sleep: (ms: number) => Promise<void>;
  /** 每页开始前询问是否应中断（同 `fillToCutoff` 的 `shouldStop`） */
  shouldStop?: () => boolean;
}

/**
 * 增量刷新：从顶部往下抓新增内容，**撞见已知条目即停**。
 *
 * 动态流是倒序的，所以某页一旦出现已知条目，再往下只会更旧、也必然已知 ——
 * 可以立刻停，不必一路翻到时间窗边界。这是「刷新页面不重拉 10 页」的关键。
 *
 * 追满 maxPages 仍未撞见已知条目时 `caughtUp: false`：说明离线期间新增量超过
 * 了上限，此时缓存与新增之间**存在断层**，调用方必须退回完整加载，
 * 不能把两段直接拼接。
 */
export async function fetchNewer(opts: IncrementalOptions): Promise<IncrementalResult> {
  const { fetchPage, known, maxPages, onPage, delayMs, sleep, shouldStop } = opts;

  const fresh: FeedItem[] = [];
  let offset: string | null = null;
  let caughtUp = false;
  let paused = false;
  let pages = 0;

  while (pages < maxPages) {
    // 与 fillToCutoff 一致：在取下一页之前检查，当前页已交付的不丢
    if (shouldStop?.()) {
      paused = true;
      break;
    }

    const page = await fetchPage(offset);
    pages++;

    const newOnes = page.items.filter((c) => !known.has(c.id));
    fresh.push(...newOnes);
    onPage?.(newOnes, pages);

    // 这页出现了已知条目 → 已追上缓存内容
    if (newOnes.length < page.items.length) {
      caughtUp = true;
      break;
    }
    if (!page.hasMore || !page.nextOffset || page.oldestPubTs === 0) {
      caughtUp = true;
      break;
    }

    offset = page.nextOffset;
    if (pages < maxPages) await sleep(delayMs);
  }

  return { fresh, caughtUp, pages, paused };
}

/**
 * 翻页检查点：每翻完一页记一条。
 *
 * `count` 是"这一页处理完后，累计有多少张**视频卡片**"（不是原始条目数）；
 * `offset` 是这一页返回的 `nextOffset`，即"从这一页之后再往下"的游标。
 */
export interface PageCheckpoint {
  count: number;
  offset: string;
}

/**
 * 找出"覆盖不超过 `keep` 张卡片"的最后一个检查点的游标。
 *
 * 用途：缓存被截断（只保留最新 N 张）时，**原来的 tailOffset 已经失效** ——
 * 它指向的位置不在缓存里了，直接保留会在恢复后漏掉一段，置 `null` 又会让
 * 「加载更多」每次刷新都从第 1 页重走（实测要空点约 50 页）。
 *
 * 取一个**不超过截断点**的检查点，就能既不漏、也不空转：
 * 恢复时那一页最多被重复拉一次，重复项会被 bvid 去重挡掉。
 *
 * 返回 `null` 表示没有检查点落在 `keep` 之内（`keep` 比第一页的卡片数还小）。
 */
export function offsetForKept(checkpoints: PageCheckpoint[], keep: number): string | null {
  let bestCount = -1;
  let best: string | null = null;
  for (const cp of checkpoints) {
    if (cp.count <= keep && cp.count > bestCount) {
      bestCount = cp.count;
      best = cp.offset;
    }
  }
  return best;
}

/**
 * 在列表**头部**插入 `by` 张卡片后，整体平移检查点的计数。
 *
 * `count` 是从列表开头数起的，所以头部插入必须同步平移。**漏了会导致漏内容**：
 * 截断时会选中一个越过截断点的检查点，恢复后中间那几条永远不会被拉回来。
 *
 * 目前只有增量刷新会在头部插入（`[...fresh, ...cards]`）—— 新增此类操作时务必调用本函数。
 */
export function shiftCheckpoints(checkpoints: PageCheckpoint[], by: number): PageCheckpoint[] {
  if (by === 0) return checkpoints;
  return checkpoints.map((cp) => ({ count: cp.count + by, offset: cp.offset }));
}

/**
 * 按时间窗裁出**要显示**的卡片。
 *
 * 时间窗是【显示】范围；而缓存里保留的是【已拉到的】深度（通常更深）。
 * 两者分开的好处：缩小窗口不需要重新拉取，扩大窗口也不需要重拉已有的部分。
 *
 * 注意 `pubdate` 是**秒级**，与 `cutoffFor` 一致；`FeedItem.pubdate` 不是毫秒。
 */
export function withinWindow(cards: FeedItem[], cutoffTs: number): FeedItem[] {
  return cards.filter((c) => c.pubdate >= cutoffTs);
}

/**
 * 判断"已拉到的卡片"是否**已经覆盖**了目标窗口。
 *
 * 覆盖的判据是"最旧的一条比窗口边界还旧" —— 因为卡片是从顶部连续往下拉的，
 * 一旦最旧的已经越过边界，中间的必然都在。
 *
 * `cards` 为空时返回 false（什么都没拉，当然不算覆盖）。
 */
export function coversWindow(cards: FeedItem[], cutoffTs: number): boolean {
  if (cards.length === 0) return false;
  let oldest = Number.POSITIVE_INFINITY;
  for (const c of cards) if (c.pubdate < oldest) oldest = c.pubdate;
  return oldest < cutoffTs;
}

/** 「还没手动加载过更早的内容」—— 这个值不会压低窗口下限 */
export const NO_MANUAL_FLOOR = Number.POSITIVE_INFINITY;

/**
 * 算出**显示下限**。
 *
 * 时间窗本身是"自动补齐到多深"的目标，但它**不应该挡住用户手动加载的内容**：
 * 边界已经被窗口盖满之后，用户再点「加载更多」，拉回来的必然全是窗口之外的旧内容 ——
 * 如果照窗口过滤，就会变成"点了没反应"（v0.8.4 的真实 bug）。
 *
 * 所以显示下限取两者中**更早**的一个：
 *  - `cutoffTs`：时间窗边界
 *  - `manualOldestTs`：手动「加载更多」拉到的最旧一条（没手动加载过时传 `NO_MANUAL_FLOOR`）
 *
 * `hours === 0`（仅首页）表示"不自动往下拉"，不是"只显示 0 小时"，所以不过滤。
 */
export function visibleCutoff(
  hours: number,
  manualOldestTs: number,
  nowMs: number = Date.now(),
): number {
  if (hours === 0) return Number.NEGATIVE_INFINITY;
  return Math.min(cutoffFor(hours, nowMs), manualOldestTs);
}
