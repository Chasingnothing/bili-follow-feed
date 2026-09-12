import { describe, it, expect, vi } from 'vitest';
import { fillToCutoff, cutoffFor, WINDOW_OPTIONS } from './feedWindow';
import type { FeedPage } from '../types';

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
