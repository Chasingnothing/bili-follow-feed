import type { FeedItem, FeedPage } from '../types';

/**
 * 模式 2 的拉取编排。
 *
 * 抽成独立模块的理由和 `feedWindow` 一样：编排逻辑（什么时候停、限速、失败隔离）
 * 不该埋在 React hook 里。依赖全部由参数注入，测试传假的 `fetchPage` / `sleep` 即可。
 */

const noopSleep = () => Promise.resolve();

export interface UpFetchOptions {
  mid: number;
  /** 想要几条可显示的内容 */
  want: number;
  fetchPage: (offset: string | null) => Promise<FeedPage>;
  /** 一次点击最多为单个 UP 翻几页。默认 3 */
  maxPages?: number;
  /** 页与页之间的等待 */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** 用户点了暂停 */
  shouldStop?: () => boolean;
}

export interface UpFetchResult {
  items: FeedItem[];
  /** 实际发了几次请求 */
  pages: number;
  /** 流真的到底了（区别于"被页数上限截断"） */
  exhausted: boolean;
  paused: boolean;
  /** 中途失败的原因；失败时 `items` 里是**已经拿到的部分**，不丢弃 */
  error?: string;
}

/**
 * 拉单个 UP 的内容，直到**凑够 `want` 条** / 流到底 / 翻满 `maxPages`。
 *
 * ⚠️ "一次请求就够"只对**以视频为主**的 UP 成立。实测 `mid=2` 一页 12 条里
 * 只有 1 条可显示内容（其余是转发）—— 那种情况必须接着翻。
 * 所以请求预算要按 `maxPages` 倍估，不能按 1 倍。
 *
 * 单页失败**保留已拿到的部分**并记下 `error`，不整体丢弃。
 */
export async function fetchUpToN(opts: UpFetchOptions): Promise<UpFetchResult> {
  const { want, fetchPage, maxPages = 3, delayMs = 0, sleep = noopSleep, shouldStop } = opts;

  const items: FeedItem[] = [];
  const seen = new Set<string>();
  let offset: string | null = null;
  let pages = 0;
  let exhausted = false;
  let paused = false;
  let error: string | undefined;

  while (items.length < want && pages < maxPages) {
    if (shouldStop?.()) {
      paused = true;
      break;
    }

    let page: FeedPage;
    try {
      page = await fetchPage(offset);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      break;
    }

    pages++;
    for (const it of page.items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      items.push(it);
    }

    // oldestPubTs === 0 表示这一页没有任何条目 —— 到头了
    if (!page.hasMore || !page.nextOffset || page.oldestPubTs === 0) {
      exhausted = true;
      break;
    }

    offset = page.nextOffset;
    // 已经够了就不再等、也不再请求（这是"典型 UP 只发 1 次请求"的来源）
    if (items.length < want && pages < maxPages) await sleep(delayMs);
  }

  return { items: items.slice(0, want), pages, exhausted, paused, error };
}

export interface BatchOptions {
  mids: number[];
  want: number;
  /** 已经够新的 UP 直接跳过，不发请求 */
  isFresh?: (mid: number) => boolean;
  /** 单个 UP 的拉取方式（默认就是 fetchUpToN，测试可替换） */
  fetchUp: (mid: number) => Promise<UpFetchResult>;
  /** 每拉完一个 UP 回调一次 —— 让调用方**立刻落盘**，中途刷新也不丢进度 */
  onFetched: (mid: number, items: FeedItem[]) => void;
  onProgress?: (done: number, total: number) => void;
  /** 每处理多少个 UP 歇一下（防风控）。默认 20 */
  pauseEvery?: number;
  /** 歇多久。默认 2 秒 */
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  shouldStop?: () => boolean;
}

export interface BatchResult {
  /** 真的拉到内容的 UP 数 */
  fetched: number;
  skipped: number;
  failed: number;
  /** 一共处理了多少个 UP（含跳过、失败、以及拉到了 0 条内容的）—— 续拉时用它算起点 */
  processed: number;
  /** 是否被用户暂停中断 */
  paused: boolean;
  /** 实际发出的请求总数（用于给用户看进度是否合理） */
  requests: number;
}

/**
 * 批量拉取（模式 2 的「拉取更多」）。
 *
 * 四个刻意的设计：
 *  1. **单个 UP 失败不中断整批** —— 一次网络抖动不该让几百个 UP 白跑
 *  2. **每拉完一个就回调落盘** —— 拉到一半刷新页面，前面的成果保住
 *  3. **每 `pauseEvery` 个 UP 歇 `pauseMs`** —— 避免触发风控
 *  4. **`shouldStop` 在 UP 边界检查** —— 暂停不会把当前 UP 的结果丢掉
 */
export async function fetchManyUps(opts: BatchOptions): Promise<BatchResult> {
  const {
    mids,
    isFresh,
    fetchUp,
    onFetched,
    onProgress,
    pauseEvery = 20,
    pauseMs = 2000,
    sleep = noopSleep,
    shouldStop,
  } = opts;

  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  let paused = false;
  let requests = 0;
  let done = 0;

  for (const mid of mids) {
    if (shouldStop?.()) {
      paused = true;
      break;
    }

    if (isFresh?.(mid)) {
      skipped++;
      done++;
      onProgress?.(done, mids.length);
      continue;
    }

    try {
      const res = await fetchUp(mid);
      requests += res.pages;
      if (res.error) failed++;
      if (res.items.length > 0) {
        onFetched(mid, res.items);
        fetched++;
      } else if (!res.error) {
        // 拉到了但一条可显示的都没有（比如整页都是转发）—— 不算失败
      }
      if (res.paused) {
        paused = true;
        done++;
        onProgress?.(done, mids.length);
        break;
      }
    } catch {
      failed++;
    }

    done++;
    onProgress?.(done, mids.length);

    if (done < mids.length && pauseEvery > 0 && done % pauseEvery === 0) {
      await sleep(pauseMs);
    }
  }

  return { fetched, skipped, failed, processed: done, paused, requests };
}
