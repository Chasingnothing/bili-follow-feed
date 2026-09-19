import { describe, it, expect, vi } from 'vitest';
import { fetchUpToN, fetchManyUps, type UpFetchResult } from './upFetch';
import type { FeedItem, FeedPage } from '../types';

function item(id: string): FeedItem {
  return {
    id,
    kind: 'video',
    title: id,
    cover: '',
    coverW: 0,
    coverH: 0,
    imageCount: 0,
    durationText: null,
    play: 0,
    danmaku: 0,
    like: 0,
    pubdate: 1000,
    upMid: 1,
    upName: 'up',
    upFace: '',
    url: '',
  };
}

function page(ids: string[], over: Partial<FeedPage> = {}): FeedPage {
  return {
    items: ids.map(item),
    nextOffset: 'next',
    hasMore: true,
    oldestPubTs: 1000,
    ...over,
  };
}

const noSleep = () => Promise.resolve();

describe('fetchUpToN —— 单个 UP', () => {
  it('一页就够时只发 1 次请求（典型 UP）', async () => {
    const fetchPage = vi.fn().mockResolvedValue(page(['a', 'b', 'c', 'd', 'e', 'f']));
    const res = await fetchUpToN({ mid: 1, want: 5, fetchPage, sleep: noSleep });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(res.pages).toBe(1);
    expect(res.items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    // 多出来的裁掉：每 UP 只留 want 条
    expect(res.items).toHaveLength(5);
  });

  it('⚠️ 一页不够时接着翻（图文/转发为主的一页只有 1 条可显示内容）', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page(['a'], { nextOffset: 'o1' }))
      .mockResolvedValueOnce(page(['b'], { nextOffset: 'o2' }))
      .mockResolvedValueOnce(page(['c', 'd', 'e'], { nextOffset: 'o3' }));

    const res = await fetchUpToN({ mid: 1, want: 5, fetchPage, sleep: noSleep });

    expect(res.pages).toBe(3);
    expect(res.items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('凑够了就不再发请求', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page(['a', 'b'], { nextOffset: 'o1' }))
      .mockResolvedValueOnce(page(['c', 'd', 'e', 'f'], { nextOffset: 'o2' }));
    const res = await fetchUpToN({ mid: 1, want: 5, fetchPage, sleep: noSleep });

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(res.items).toHaveLength(5);
  });

  it('翻满 maxPages 就停，并标记为"没到底"', async () => {
    const fetchPage = vi.fn().mockImplementation((o: string | null) =>
      Promise.resolve(page(['x'], { nextOffset: `${o ?? 'start'}+` })),
    );
    const res = await fetchUpToN({ mid: 1, want: 99, fetchPage, maxPages: 3, sleep: noSleep });

    expect(res.pages).toBe(3);
    expect(res.exhausted).toBe(false);
  });

  it('流到底时标记 exhausted', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page(['a'], { nextOffset: 'o1' }))
      .mockResolvedValueOnce(page(['b'], { hasMore: false, nextOffset: null }));
    const res = await fetchUpToN({ mid: 1, want: 99, fetchPage, sleep: noSleep });

    expect(res.exhausted).toBe(true);
    expect(res.items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('空页算到底，不会无限翻', async () => {
    const fetchPage = vi.fn().mockResolvedValue(page([], { oldestPubTs: 0 }));
    const res = await fetchUpToN({ mid: 1, want: 5, fetchPage, sleep: noSleep });
    expect(res.pages).toBe(1);
    expect(res.exhausted).toBe(true);
  });

  it('跨页去重', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page(['a', 'b'], { nextOffset: 'o1' }))
      // 第 2 页故意重复 b，并且让流在这里结束
      .mockResolvedValueOnce(page(['b', 'c'], { hasMore: false, nextOffset: null }));
    const res = await fetchUpToN({ mid: 1, want: 5, fetchPage, sleep: noSleep });
    expect(res.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(res.exhausted).toBe(true);
  });

  it('把游标透传给 fetchPage（首页为 null）', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page(['a'], { nextOffset: 'o1' }))
      .mockResolvedValueOnce(page(['b'], { hasMore: false }));
    await fetchUpToN({ mid: 1, want: 5, fetchPage, sleep: noSleep });
    expect(fetchPage.mock.calls[0][0]).toBeNull();
    expect(fetchPage.mock.calls[1][0]).toBe('o1');
  });

  it('暂停：在页边界停下，已拿到的保留', async () => {
    const fetchPage = vi.fn().mockResolvedValue(page(['a'], { nextOffset: 'o1' }));
    let checks = 0;
    const res = await fetchUpToN({
      mid: 1,
      want: 99,
      fetchPage,
      sleep: noSleep,
      // 第 3 次检查（也就是第 3 页开始前）要求停下 → 只取到 2 页
      shouldStop: () => {
        checks++;
        return checks > 2;
      },
    });

    expect(res.paused).toBe(true);
    expect(res.pages).toBe(2);
    expect(res.items.map((i) => i.id)).toEqual(['a']);
  });

  it('单页失败时保留已拿到的部分并记下错误', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page(['a', 'b'], { nextOffset: 'o1' }))
      .mockRejectedValueOnce(new Error('B站接口返回 -352：风控校验失败'));

    const res = await fetchUpToN({ mid: 1, want: 5, fetchPage, sleep: noSleep });

    expect(res.error).toContain('-352');
    expect(res.items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('限速：页与页之间等待', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page(['a'], { nextOffset: 'o1' }))
      .mockResolvedValueOnce(page(['b', 'c', 'd', 'e'], { nextOffset: 'o2' }));
    const sleep = vi.fn(noSleep);
    await fetchUpToN({ mid: 1, want: 5, fetchPage, delayMs: 400, sleep });

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(400);
  });
});

describe('fetchManyUps —— 一个板块', () => {
  const ok = (ids: string[], pages = 1): UpFetchResult => ({
    items: ids.map(item),
    pages,
    exhausted: true,
    paused: false,
  });

  it('逐个拉，每拉完一个就回调（中途刷新不丢进度）', async () => {
    const seen: number[] = [];
    const res = await fetchManyUps({
      mids: [1, 2, 3],
      want: 5,
      fetchUp: async (mid) => ok([`BV${mid}`]),
      onFetched: (mid) => seen.push(mid),
      sleep: noSleep,
    });

    expect(seen).toEqual([1, 2, 3]);
    expect(res.fetched).toBe(3);
    expect(res.requests).toBe(3);
  });

  it('单个 UP 失败不中断整批', async () => {
    const res = await fetchManyUps({
      mids: [1, 2, 3],
      want: 5,
      fetchUp: async (mid) => {
        if (mid === 2) throw new Error('网络抖动');
        return ok([`BV${mid}`]);
      },
      onFetched: () => {},
      sleep: noSleep,
    });

    expect(res.fetched).toBe(2);
    expect(res.failed).toBe(1);
  });

  it('UP 内部报错（部分成功）也算失败，但已拿到的仍旧落盘', async () => {
    const saved: number[] = [];
    const res = await fetchManyUps({
      mids: [1],
      want: 5,
      fetchUp: async () => ({ items: [item('a')], pages: 2, exhausted: false, paused: false, error: 'boom' }),
      onFetched: (mid, items) => saved.push(...(items.length ? [mid] : [])),
      sleep: noSleep,
    });
    expect(res.failed).toBe(1);
    expect(saved).toEqual([1]);
  });

  it('已够新的 UP 直接跳过，不发请求', async () => {
    const fetchUp = vi.fn(async (mid: number) => ok([`BV${mid}`]));
    const res = await fetchManyUps({
      mids: [1, 2, 3],
      want: 5,
      isFresh: (mid) => mid === 2,
      fetchUp,
      onFetched: () => {},
      sleep: noSleep,
    });

    expect(fetchUp).toHaveBeenCalledTimes(2);
    expect(res.skipped).toBe(1);
    expect(res.fetched).toBe(2);
  });

  it(`每拉 ${20} 个 UP 歇一下（防风控）`, async () => {
    const mids = Array.from({ length: 45 }, (_, i) => i + 1);
    const sleep = vi.fn(noSleep);
    await fetchManyUps({
      mids,
      want: 5,
      fetchUp: async () => ok(['a']),
      onFetched: () => {},
      pauseEvery: 20,
      pauseMs: 2000,
      sleep,
    });

    // 45 个 UP → 在第 20、40 个之后各歇一次
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('暂停：在 UP 边界停下，并汇报进度', async () => {
    const progress: number[] = [];
    let done = 0;
    const res = await fetchManyUps({
      mids: [1, 2, 3, 4],
      want: 5,
      fetchUp: async () => ok(['a']),
      onFetched: () => {},
      onProgress: (d) => progress.push(d),
      sleep: noSleep,
      shouldStop: () => {
        done++;
        return done > 2;
      },
    });

    expect(res.paused).toBe(true);
    expect(res.fetched).toBe(2);
    expect(progress).toEqual([1, 2]);
  });

  it('空列表是空操作', async () => {
    const res = await fetchManyUps({
      mids: [],
      want: 5,
      fetchUp: async () => ok(['a']),
      onFetched: () => {},
      sleep: noSleep,
    });
    expect(res).toEqual({
      fetched: 0,
      empty: 0,
      skipped: 0,
      failed: 0,
      processed: 0,
      paused: false,
      requests: 0,
    });
  });

  it('processed 把跳过、失败、空结果都算进去（续拉要用它算起点）', async () => {
    const res = await fetchManyUps({
      mids: [1, 2, 3],
      want: 5,
      isFresh: (mid) => mid === 1,
      fetchUp: async (mid) => {
        if (mid === 2) throw new Error('x');
        return ok([]); // 拉到了但一条可显示的都没有
      },
      onFetched: () => {},
      sleep: noSleep,
    });
    expect(res.processed).toBe(3);
    expect(res.skipped).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.empty).toBe(1);
    expect(res.fetched).toBe(0);
  });

  it('拉到 0 条（整页都是转发）不算失败，但**必须回调**让调用方记下"查过了"', async () => {
    const saved: Array<{ mid: number; n: number }> = [];
    const res = await fetchManyUps({
      mids: [1],
      want: 5,
      fetchUp: async () => ok([], 1),
      onFetched: (mid, items) => saved.push({ mid, n: items.length }),
      sleep: noSleep,
    });

    expect(res.fetched).toBe(0);
    expect(res.failed).toBe(0);
    expect(res.empty).toBe(1);
    // ⚠️ 关键：空数组也要回调。否则调用方不会落盘 → "这个 UP 查过了"这个事实丢失
    // → 每次点「拉取更多」都会重新拉他 3 页，永远如此。
    expect(saved).toEqual([{ mid: 1, n: 0 }]);
  });

  it('⚠️ 回归：没有内容的 UP 也要被记下来，否则会被无限重复拉取', async () => {
    // 第一轮：这个 UP 一条可显示内容都没有
    const stored = new Map<number, number>(); // mid → 上次拉取时间
    const onFetched = (mid: number, items: FeedItem[]) => stored.set(mid, items.length);

    await fetchManyUps({
      mids: [7],
      want: 5,
      fetchUp: async () => ok([], 3),
      onFetched,
      sleep: noSleep,
    });
    expect(stored.has(7)).toBe(true);

    // 第二轮：isFresh 依赖"查过了"，于是应该被跳过而不是重拉 3 页
    const fetchUp = vi.fn(async () => ok([], 3));
    const second = await fetchManyUps({
      mids: [7],
      want: 5,
      isFresh: (mid) => stored.has(mid),
      fetchUp,
      onFetched,
      sleep: noSleep,
    });
    expect(fetchUp).not.toHaveBeenCalled();
    expect(second.skipped).toBe(1);
    expect(second.requests).toBe(0);
  });

  it('报错的 UP 不记"查过了"（否则网络抖动会被当成"他没内容"）', async () => {
    const saved: number[] = [];
    await fetchManyUps({
      mids: [1],
      want: 5,
      fetchUp: async () => ({ items: [], pages: 1, exhausted: false, paused: false, error: '网络' }),
      onFetched: (mid) => saved.push(mid),
      sleep: noSleep,
    });
    expect(saved).toEqual([]);
  });
});
