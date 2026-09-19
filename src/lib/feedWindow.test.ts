import { describe, it, expect, vi } from 'vitest';
import {
  fillToCutoff,
  cutoffFor,
  WINDOW_OPTIONS,
  fetchNewer,
  offsetForKept,
  shiftCheckpoints,
  withinWindow,
  coversWindow,
  visibleCutoff,
  NO_MANUAL_FLOOR,
  type PageCheckpoint,
} from './feedWindow';
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

describe('offsetForKept', () => {
  const cps: PageCheckpoint[] = [
    { count: 12, offset: 'o12' },
    { count: 24, offset: 'o24' },
    { count: 30, offset: 'o30' },
    { count: 42, offset: 'o42' },
  ];

  it('取"覆盖不超过 keep"的最后一个检查点', () => {
    expect(offsetForKept(cps, 600)).toBe('o42');
    expect(offsetForKept(cps, 42)).toBe('o42');
    expect(offsetForKept(cps, 41)).toBe('o30');
    expect(offsetForKept(cps, 30)).toBe('o30');
    expect(offsetForKept(cps, 29)).toBe('o24');
  });

  it('keep 比第一页还小时返回 null', () => {
    expect(offsetForKept(cps, 11)).toBeNull();
    expect(offsetForKept(cps, 0)).toBeNull();
  });

  it('没有检查点时返回 null（老版本缓存没有这个字段）', () => {
    expect(offsetForKept([], 600)).toBeNull();
  });

  it('同一页有多条时取 count 最大的那个（乱序输入也稳）', () => {
    const messy: PageCheckpoint[] = [
      { count: 20, offset: 'b' },
      { count: 10, offset: 'a' },
      { count: 15, offset: 'c' },
    ];
    expect(offsetForKept(messy, 17)).toBe('c');
  });

  it('count 为 0 的检查点（整页没有视频）也算有效', () => {
    expect(offsetForKept([{ count: 0, offset: 'zero' }], 600)).toBe('zero');
  });
});

describe('shiftCheckpoints', () => {
  const cps: PageCheckpoint[] = [
    { count: 12, offset: 'a' },
    { count: 24, offset: 'b' },
  ];

  it('整体平移计数', () => {
    expect(shiftCheckpoints(cps, 5)).toEqual([
      { count: 17, offset: 'a' },
      { count: 29, offset: 'b' },
    ]);
  });

  it('平移 0 时原样返回同一个引用', () => {
    expect(shiftCheckpoints(cps, 0)).toBe(cps);
  });

  it('不修改入参', () => {
    shiftCheckpoints(cps, 5);
    expect(cps[0].count).toBe(12);
  });

  it('平移后 offsetForKept 会选到正确的那个（这就是它存在的理由）', () => {
    // 头部插入 5 张后只保留 24 张：正确的恢复点是"原 count=19 处"，
    // 也就是原 count=12 那条平移后的 17。若不平移，会选中 24 → 越过截断点 → 漏内容。
    const shifted = shiftCheckpoints(cps, 5);
    expect(offsetForKept(cps, 24)).toBe('b'); // 未平移：错，指向 24（已越界）
    expect(offsetForKept(shifted, 24)).toBe('a'); // 平移后：正确
  });
});

describe('withinWindow', () => {
  const card = (bvid: string, pubdate: number): VideoCard =>
    ({
      bvid,
      title: '',
      cover: '',
      durationText: '',
      play: 0,
      danmaku: 0,
      pubdate,
      upMid: 0,
      upName: '',
      upFace: '',
      url: '',
    }) satisfies VideoCard;

  const cards = [card('a', 1000), card('b', 500), card('c', 100)];

  it('只保留 pubdate >= cutoff 的卡片', () => {
    expect(withinWindow(cards, 500).map((c) => c.bvid)).toEqual(['a', 'b']);
    expect(withinWindow(cards, 1001)).toEqual([]);
  });

  it('边界值算在内（>= 而不是 >）', () => {
    // cutoff 是"窗口的起点"，比它新的才留下；正好等于边界的那条要保留
    expect(withinWindow(cards, 100).map((c) => c.bvid)).toEqual(['a', 'b', 'c']);
    expect(withinWindow(cards, 101).map((c) => c.bvid)).toEqual(['a', 'b']);
  });

  it('总是返回新数组（否则 setState 会因为引用相同而跳过渲染）', () => {
    const out = withinWindow(cards, 0);
    expect(out).not.toBe(cards);
    expect(out).toHaveLength(3);
  });
});

describe('coversWindow', () => {
  const card = (pubdate: number): VideoCard =>
    ({
      bvid: String(pubdate),
      title: '',
      cover: '',
      durationText: '',
      play: 0,
      danmaku: 0,
      pubdate,
      upMid: 0,
      upName: '',
      upFace: '',
      url: '',
    }) satisfies VideoCard;

  it('最旧的一条越过边界 → 已覆盖', () => {
    expect(coversWindow([card(900), card(400), card(100)], 500)).toBe(true);
  });

  it('最旧的还没到边界 → 未覆盖', () => {
    expect(coversWindow([card(900), card(600)], 500)).toBe(false);
  });

  it('空列表不算覆盖', () => {
    expect(coversWindow([], 500)).toBe(false);
  });

  it('顺序无关（取的是最小值）', () => {
    expect(coversWindow([card(100), card(900)], 500)).toBe(true);
  });
});

describe('visibleCutoff', () => {
  const NOW = 1_800_000_000_000; // ms

  it('没手动加载过时就是时间窗边界', () => {
    // 1 天窗 → 边界 = now/1000 - 86400
    expect(visibleCutoff(24, NO_MANUAL_FLOOR, NOW)).toBe(Math.floor(NOW / 1000) - 86400);
  });

  it('⚠️ 回归：手动加载到更早的内容时，下限要跟着放宽（否则「加载更多」点了没反应）', () => {
    const windowCutoff = Math.floor(NOW / 1000) - 86400;
    const manual = windowCutoff - 100000; // 手动加载到了更早
    expect(visibleCutoff(24, manual, NOW)).toBe(manual);
  });

  it('手动下限比窗口还新时，仍以窗口为准（不会反而显示更少）', () => {
    const windowCutoff = Math.floor(NOW / 1000) - 86400;
    expect(visibleCutoff(24, windowCutoff + 5000, NOW)).toBe(windowCutoff);
  });

  it('hours=0（仅首页）不过滤，返回 -Infinity', () => {
    expect(visibleCutoff(0, NO_MANUAL_FLOOR, NOW)).toBe(Number.NEGATIVE_INFINITY);
    expect(visibleCutoff(0, 12345, NOW)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('窗口越大边界越早', () => {
    const h6 = visibleCutoff(6, NO_MANUAL_FLOOR, NOW);
    const h72 = visibleCutoff(72, NO_MANUAL_FLOOR, NOW);
    expect(h72).toBeLessThan(h6);
  });
});
