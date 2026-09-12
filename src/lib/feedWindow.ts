import type { FeedPage, VideoCard } from '../types';

export interface FillResult {
  pages: number;
  covered: boolean;
  stoppedBy: 'covered' | 'end' | 'cap';
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
}

/**
 * 继续翻页，直到覆盖到时间窗边界或触达上限。
 *
 * 抽成独立函数是为了**可测**：编排逻辑（何时停、翻了几页、何时限速）不该埋在
 * React hook 里。依赖全部由参数注入，测试时传假的 fetchPage / sleep 即可。
 *
 * 停止条件三条，谁先满足算谁：
 *  1. 某页最早一条 < cutoffTs  → `covered`
 *  2. 流到底（has_more=false / 无游标 / 空页）→ `end`
 *  3. 翻满 maxPages            → `cap`（调用方应据此提示"未完全覆盖"）
 */
export async function fillToCutoff(opts: FillOptions): Promise<FillResult> {
  const { fetchPage, startOffset, cutoffTs, maxPages, onPage, delayMs, sleep } = opts;

  let offset = startOffset;
  let pages = 0;
  let stoppedBy: FillResult['stoppedBy'] = 'cap';

  while (pages < maxPages) {
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
  fresh: VideoCard[];
  /** 是否追上了已知内容（false = 离线太久，调用方应退回完整加载） */
  caughtUp: boolean;
  pages: number;
}

export interface IncrementalOptions {
  fetchPage: (offset: string | null) => Promise<FeedPage>;
  /** 本地已有的 bvid */
  known: Set<string>;
  maxPages: number;
  onPage?: (fresh: VideoCard[], index: number) => void;
  delayMs: number;
  sleep: (ms: number) => Promise<void>;
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
  const { fetchPage, known, maxPages, onPage, delayMs, sleep } = opts;

  const fresh: VideoCard[] = [];
  let offset: string | null = null;
  let caughtUp = false;
  let pages = 0;

  while (pages < maxPages) {
    const page = await fetchPage(offset);
    pages++;

    const newOnes = page.items.filter((c) => !known.has(c.bvid));
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

  return { fresh, caughtUp, pages };
}
