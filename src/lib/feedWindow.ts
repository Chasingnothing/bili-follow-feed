import type { FeedPage } from '../types';

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
