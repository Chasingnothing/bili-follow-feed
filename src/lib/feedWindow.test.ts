import { describe, it, expect, vi } from 'vitest';
import { fillToCutoff, cutoffFor, WINDOW_OPTIONS, fetchNewer } from './feedWindow';
import type { FeedPage, VideoCard } from '../types';

function page(over: Partial<FeedPage>): FeedPage {
  return {
    items: [],
    nextOffset: 'next',
    hasMore: true,
    oldestPubTs: 1000,
    ...over,
  };
}

const noSleep = () => Promise.resolve();

describe('fillToCutoff', () => {
  it('某页最早一条早于边界时停止，标记 covered', async () => {
    const pages = [page({ oldestPubTs: 900 }), page({ oldestPubTs: 500 })];
    const fetchPage = vi.fn().mockImplementation(() => Promise.resolve(pages.shift()!));

    const res = await fillToCutoff({
      fetchPage,
      startOffset: null,
      cutoffTs: 600,
      maxPages: 40,
      onPage: () => {},
      delayMs: 0,
      sleep: noSleep,
    });

    expect(res.pages).toBe(2);
    expect(res.covered).toBe(true);
    expect(res.stoppedBy).toBe('covered');
  });

  it('流到底时停止，标记 end', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValue(page({ hasMore: false, oldestPubTs: 9999 }));

    const res = await fillToCutoff({
      fetchPage,
      startOffset: null,
      cutoffTs: 600,
      maxPages: 40,
      onPage: () => {},
      delayMs: 0,
      sleep: noSleep,
    });

    expect(res.pages).toBe(1);
    expect(res.stoppedBy).toBe('end');
    expect(res.covered).toBe(false);
  });

  it('无游标时也算到底', async () => {
    const fetchPage = vi.fn().mockResolvedValue(page({ nextOffset: null, oldestPubTs: 9999 }));
    const res = await fillToCutoff({
      fetchPage,
      startOffset: null,
      cutoffTs: 600,
      maxPages: 40,
      onPage: () => {},
      delayMs: 0,
      sleep: noSleep,
    });
    expect(res.stoppedBy).toBe('end');
  });

  it('空页（oldestPubTs=0）算到底，避免死循环', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValue(page({ oldestPubTs: 0, hasMore: true, nextOffset: 'x' }));
    const res = await fillToCutoff({
      fetchPage,
      startOffset: null,
      cutoffTs: 600,
      maxPages: 40,
      onPage: () => {},
      delayMs: 0,
      sleep: noSleep,
    });
    expect(res.pages).toBe(1);
    expect(res.stoppedBy).toBe('end');
  });

  it('翻满上限时停止，标记 cap（调用方应提示未完全覆盖）', async () => {
    const fetchPage = vi.fn().mockResolvedValue(page({ oldestPubTs: 999_999 }));
    const res = await fillToCutoff({
      fetchPage,
      startOffset: null,
      cutoffTs: 600,
      maxPages: 3,
      onPage: () => {},
      delayMs: 0,
      sleep: noSleep,
    });
    expect(res.pages).toBe(3);
    expect(res.stoppedBy).toBe('cap');
    expect(res.covered).toBe(false);
  });

  it('逐页回调，index 从 1 开始', async () => {
    const seen: number[] = [];
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page({ oldestPubTs: 900 }))
      .mockResolvedValueOnce(page({ oldestPubTs: 500 }));

    await fillToCutoff({
      fetchPage,
      startOffset: null,
      cutoffTs: 600,
      maxPages: 40,
      onPage: (_p, i) => seen.push(i),
      delayMs: 0,
      sleep: noSleep,
    });

    expect(seen).toEqual([1, 2]);
  });

  it('把游标透传给 fetchPage', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page({ oldestPubTs: 900, nextOffset: 'AAA' }))
      .mockResolvedValueOnce(page({ oldestPubTs: 500 }));

    await fillToCutoff({
      fetchPage,
      startOffset: null,
      cutoffTs: 600,
      maxPages: 40,
      onPage: () => {},
      delayMs: 0,
      sleep: noSleep,
    });

    expect(fetchPage.mock.calls[0][0]).toBeNull();
    expect(fetchPage.mock.calls[1][0]).toBe('AAA');
  });

  it('从传入的 startOffset 继续（不是从首页重来）', async () => {
    const fetchPage = vi.fn().mockResolvedValue(page({ oldestPubTs: 500 }));
    await fillToCutoff({
      fetchPage,
      startOffset: 'RESUME',
      cutoffTs: 600,
      maxPages: 40,
      onPage: () => {},
      delayMs: 0,
      sleep: noSleep,
    });
    expect(fetchPage.mock.calls[0][0]).toBe('RESUME');
  });

  it('限速：只在页与页之间等待，最后一页之后不等', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page({ oldestPubTs: 900 }))
      .mockResolvedValueOnce(page({ oldestPubTs: 800 }))
      .mockResolvedValueOnce(page({ oldestPubTs: 500 }));

    await fillToCutoff({
      fetchPage,
      startOffset: null,
      cutoffTs: 600,
      maxPages: 40,
      onPage: () => {},
      delayMs: 400,
      sleep,
    });

    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(400);
  });

  it('maxPages 为 0 时不发任何请求', async () => {
    const fetchPage = vi.fn();
    const res = await fillToCutoff({
      fetchPage,
      startOffset: null,
      cutoffTs: 600,
      maxPages: 0,
      onPage: () => {},
      delayMs: 0,
      sleep: noSleep,
    });
    expect(fetchPage).not.toHaveBeenCalled();
    expect(res.pages).toBe(0);
  });
});

describe('cutoffFor', () => {
  const now = 1_700_000_000_000;
  it('按小时换算为秒级边界', () => {
    expect(cutoffFor(24, now)).toBe(Math.floor(now / 1000) - 86400);
  });
  it('0 小时即当前时刻', () => {
    expect(cutoffFor(0, now)).toBe(Math.floor(now / 1000));
  });
});

describe('WINDOW_OPTIONS', () => {
  it('含「仅首页」选项（hours=0）', () => {
    expect(WINDOW_OPTIONS.some((o) => o.hours === 0)).toBe(true);
  });
  it('小时数递减排列', () => {
    const hs = WINDOW_OPTIONS.map((o) => o.hours);
    expect([...hs].sort((a, b) => a - b)).toEqual(hs);
  });
});

// ── 增量刷新 ────────────────────────────────────────────────────────────

function card(bvid: string): VideoCard {
  return {
    bvid,
    title: bvid,
    cover: 'https://x',
    durationText: '1:00',
    play: 0,
    danmaku: 0,
    pubdate: 1,
    upMid: 1,
    upName: 'up',
    upFace: 'https://x',
    url: 'https://x',
  };
}

function pageWith(bvids: string[], over: Partial<FeedPage> = {}): FeedPage {
  return {
    items: bvids.map(card),
    nextOffset: 'next',
    hasMore: true,
    oldestPubTs: 1000,
    ...over,
  };
}

describe('fetchNewer', () => {
  it('第一页就撞见已知条目时只发一次请求', async () => {
    const fetchPage = vi.fn().mockResolvedValue(pageWith(['N1', 'N2', 'OLD1']));
    const res = await fetchNewer({
      fetchPage,
      known: new Set(['OLD1']),
      maxPages: 15,
      delayMs: 0,
      sleep: noSleep,
    });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(res.caughtUp).toBe(true);
    expect(res.fresh.map((c) => c.bvid)).toEqual(['N1', 'N2']);
  });

  it('整页都是新条目时继续往下翻', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(pageWith(['N1', 'N2']))
      .mockResolvedValueOnce(pageWith(['N3', 'OLD1']));

    const res = await fetchNewer({
      fetchPage,
      known: new Set(['OLD1']),
      maxPages: 15,
      delayMs: 0,
      sleep: noSleep,
    });

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(res.fresh.map((c) => c.bvid)).toEqual(['N1', 'N2', 'N3']);
    expect(res.caughtUp).toBe(true);
  });

  it('把游标透传给 fetchPage', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(pageWith(['N1'], { nextOffset: 'AAA' }))
      .mockResolvedValueOnce(pageWith(['N2', 'OLD1']));

    await fetchNewer({ fetchPage, known: new Set(['OLD1']), maxPages: 15, delayMs: 0, sleep: noSleep });
    expect(fetchPage.mock.calls[0][0]).toBeNull();
    expect(fetchPage.mock.calls[1][0]).toBe('AAA');
  });

  it('流到底算追上（没有更多可比较的旧内容）', async () => {
    const fetchPage = vi.fn().mockResolvedValue(pageWith(['N1'], { hasMore: false }));
    const res = await fetchNewer({
      fetchPage,
      known: new Set(['OLD1']),
      maxPages: 15,
      delayMs: 0,
      sleep: noSleep,
    });
    expect(res.caughtUp).toBe(true);
    expect(res.fresh.map((c) => c.bvid)).toEqual(['N1']);
  });

  it('空页算追上，避免死循环', async () => {
    const fetchPage = vi.fn().mockResolvedValue(pageWith([], { oldestPubTs: 0 }));
    const res = await fetchNewer({
      fetchPage,
      known: new Set(['OLD1']),
      maxPages: 15,
      delayMs: 0,
      sleep: noSleep,
    });
    expect(res.pages).toBe(1);
    expect(res.caughtUp).toBe(true);
  });

  it('追满上限仍未撞见已知条目 → caughtUp=false（调用方应退回完整加载）', async () => {
    const fetchPage = vi.fn().mockResolvedValue(pageWith(['N1', 'N2']));
    const res = await fetchNewer({
      fetchPage,
      known: new Set(['NEVER']),
      maxPages: 3,
      delayMs: 0,
      sleep: noSleep,
    });

    expect(res.pages).toBe(3);
    expect(res.caughtUp).toBe(false);
  });

  it('全都是已知条目时 fresh 为空、caughtUp 为 true', async () => {
    const fetchPage = vi.fn().mockResolvedValue(pageWith(['OLD1', 'OLD2']));
    const res = await fetchNewer({
      fetchPage,
      known: new Set(['OLD1', 'OLD2']),
      maxPages: 15,
      delayMs: 0,
      sleep: noSleep,
    });
    expect(res.fresh).toHaveLength(0);
    expect(res.caughtUp).toBe(true);
  });

  it('一页没有视频（0 条）不算撞见已知条目，继续翻', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(pageWith([]))
      .mockResolvedValueOnce(pageWith(['N1', 'OLD1']));

    const res = await fetchNewer({
      fetchPage,
      known: new Set(['OLD1']),
      maxPages: 15,
      delayMs: 0,
      sleep: noSleep,
    });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(res.fresh.map((c) => c.bvid)).toEqual(['N1']);
  });

  it('限速：只在页与页之间等待', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(pageWith(['N1']))
      .mockResolvedValueOnce(pageWith(['N2', 'OLD1']));

    await fetchNewer({
      fetchPage,
      known: new Set(['OLD1']),
      maxPages: 15,
      delayMs: 400,
      sleep,
    });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(400);
  });

  it('逐页回调新条目', async () => {
    const seen: string[][] = [];
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(pageWith(['N1']))
      .mockResolvedValueOnce(pageWith(['N2', 'OLD1']));

    await fetchNewer({
      fetchPage,
      known: new Set(['OLD1']),
      maxPages: 15,
      onPage: (fresh) => seen.push(fresh.map((c) => c.bvid)),
      delayMs: 0,
      sleep: noSleep,
    });
    expect(seen).toEqual([['N1'], ['N2']]);
  });

  it('maxPages 为 0 时不发请求', async () => {
    const fetchPage = vi.fn();
    const res = await fetchNewer({
      fetchPage,
      known: new Set(),
      maxPages: 0,
      delayMs: 0,
      sleep: noSleep,
    });
    expect(fetchPage).not.toHaveBeenCalled();
    expect(res.caughtUp).toBe(false);
  });
});
