import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useFeed, type FeedApi, type FeedDeps } from './useFeed';
import type { FeedDataSource } from '../data/source';
import type { FeedPage, VideoCard } from '../types';
import { cutoffFor } from '../lib/feedWindow';

/**
 * `useFeed` 的测试。
 *
 * 这是本项目唯一一个"真发请求 + 真读写 localStorage + 真管定时器"的 hook，
 * 而 v0.8.3–v0.8.9 的四个 bug **全部**出在它里面。之前它一条测试都没有，
 * 只能靠人工点页面验证 —— 于是那几个 bug 都是你发现的，不是我发现的。
 *
 * 手法：
 *  - 把 hook 挂到一个探针组件上，渲染后就能读它的返回值
 *  - 用假的 `FeedDataSource`（脚本化分页）代替真网络
 *  - 用注入的 `sleep` / `now` 控制时序，测试里不真等
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── 基础设施 ────────────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: Root;
let nowMs: number;

beforeEach(() => {
  localStorage.clear();
  nowMs = 1_800_000_000_000;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const now = () => nowMs;
const noopSleep = () => Promise.resolve();

function mountFeed(overrides: Partial<FeedDeps> = {}): () => FeedApi {
  const box: { api: FeedApi | null } = { api: null };
  function Probe() {
    box.api = useFeed(overrides);
    return null;
  }
  act(() => {
    root.render(<Probe />);
  });
  return () => {
    if (!box.api) throw new Error('hook 还没挂载');
    return box.api;
  };
}

/** 让挂起的 promise 链跑完（注入的 sleep 立即 resolve，所以只需推微任务） */
async function settle(turns = 40) {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function card(bvid: string, pubdate: number): VideoCard {
  return {
    bvid,
    title: bvid,
    cover: '',
    durationText: '',
    play: 0,
    danmaku: 0,
    pubdate,
    upMid: 1,
    upName: 'up',
    upFace: '',
    url: '',
  };
}

/**
 * 造 `count` 页、每页 `per` 张。第 n 张的时间是 `nowSec - n*stepSec`。
 * 所以 `stepSec` 越小，同样页数覆盖的时间越短（越容易翻到页数上限）。
 */
function scriptedPages(count: number, per: number, nowSec: number, stepSec: number): FeedPage[] {
  const pages: FeedPage[] = [];
  let t = nowSec;
  for (let p = 0; p < count; p++) {
    const items: VideoCard[] = [];
    for (let i = 0; i < per; i++) {
      items.push(card(`BV${p}_${i}`, t));
      t -= stepSec;
    }
    const last = p === count - 1;
    pages.push({
      items,
      nextOffset: last ? null : `off${p + 1}`,
      hasMore: !last,
      oldestPubTs: items.length ? items[items.length - 1].pubdate : 0,
    });
  }
  return pages;
}

/** 脚本化的假数据源，并记录每次请求带的游标 */
function sourceFrom(pages: FeedPage[]) {
  const calls: Array<string | null> = [];
  let i = 0;
  const source: FeedDataSource = {
    async fetchPage(offset: string | null) {
      calls.push(offset);
      if (i >= pages.length) throw new Error('假数据源没有更多页了');
      return pages[i++];
    },
  };
  return { source, calls };
}

/** 可控的 sleep：每次调用都挂起，直到测试显式放行 —— 用来在循环中间插暂停 */
function gatedSleep() {
  const waiters: Array<() => void> = [];
  return {
    sleep: () => new Promise<void>((r) => waiters.push(r)),
    releaseAll: () => {
      while (waiters.length) waiters.shift()!();
    },
    pending: () => waiters.length,
    /** 反复放行直到不再有等待者 */
    drain: async () => {
      for (let i = 0; i < 300 && waiters.length > 0; i++) {
        // 放行与随之而来的微任务必须在同一个 act 里，否则 React 会警告
        await act(async () => {
          while (waiters.length) waiters.shift()!();
          await Promise.resolve();
        });
      }
    },
  };
}

function quick(over: Partial<FeedDeps>) {
  return { sleep: noopSleep, delayMs: 0, flushMs: 0, now, ...over };
}

const nowSec = () => Math.floor(nowMs / 1000);
const HOUR_S = 3600;

// ── A. 冷启动完整加载 ───────────────────────────────────────────────────

describe('A. 冷启动', () => {
  it('从第 1 页开始连续翻，直到流到底，卡片合并去重', async () => {
    const pages = scriptedPages(3, 5, nowSec(), 4000);
    const { source, calls } = sourceFrom(pages);
    const feed = mountFeed(quick({ source }));

    await settle();

    expect(calls).toEqual([null, 'off1', 'off2']);
    expect(feed().cards).toHaveLength(15);
    expect(feed().error).toBeNull();
  });

  it('同一 bvid 在多页里重复出现时只保留一份', async () => {
    const pages = scriptedPages(2, 3, nowSec(), 4000);
    // 第 2 页重复第 1 页的最后一条
    pages[1].items[0] = pages[0].items[2];
    const { source } = sourceFrom(pages);
    const feed = mountFeed(quick({ source }));

    await settle();

    expect(feed().cards).toHaveLength(5);
    expect(new Set(feed().cards.map((c) => c.bvid)).size).toBe(5);
  });

  it('卡片按动态流顺序排列（新的在前）', async () => {
    const pages = scriptedPages(2, 3, nowSec(), 4000);
    const { source } = sourceFrom(pages);
    const feed = mountFeed(quick({ source }));

    await settle();

    const ts = feed().cards.map((c) => c.pubdate);
    expect([...ts].sort((a, b) => b - a)).toEqual(ts);
  });
});

// ── B. 缓存与增量刷新（防抖） ───────────────────────────────────────────

describe('B. 缓存命中', () => {
  function seedCache(at: number, cards: VideoCard[], over: Record<string, unknown> = {}) {
    localStorage.setItem(
      'bff:feedCache',
      JSON.stringify({ at, hours: 24, cards, tailOffset: 'offX', ...over }),
    );
  }

  it('B1 缓存不到 60 秒 → 一个请求都不发', async () => {
    seedCache(nowMs - 30_000, [card('BVcached', nowSec() - 100)]);
    const { source, calls } = sourceFrom([]);
    const feed = mountFeed(quick({ source }));

    await settle();

    expect(calls).toEqual([]);
    expect(feed().cards.map((c) => c.bvid)).toEqual(['BVcached']);
  });

  it('B2 缓存过期 → 只拉 1 页就停（撞见已知条目）', async () => {
    const known = card('BVknown', nowSec() - 100);
    seedCache(nowMs - 2 * HOUR_S * 1000, [known]);
    const page1: FeedPage = {
      items: [card('BVnew1', nowSec()), card('BVnew2', nowSec() - 10), known],
      nextOffset: 'off1',
      hasMore: true,
      oldestPubTs: known.pubdate,
    };
    const { source, calls } = sourceFrom([page1]);
    const feed = mountFeed(quick({ source }));

    await settle();

    // 核心断言：只发了 1 个请求，而不是把整个窗口重拉一遍
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeNull();
    // 新条目插到最前面，旧的原样保留
    expect(feed().cards.map((c) => c.bvid)).toEqual(['BVnew1', 'BVnew2', 'BVknown']);
  });

  it('缓存时间窗不匹配时不复用（否则会显示错窗口的内容）', async () => {
    seedCache(nowMs - 30_000, [card('BVcached', nowSec() - 100)], { hours: 6 });
    const { source, calls } = sourceFrom(scriptedPages(1, 2, nowSec(), 4000));
    const feed = mountFeed(quick({ source }));

    await settle();

    expect(calls.length).toBeGreaterThan(0);
    expect(feed().cards.map((c) => c.bvid)).not.toContain('BVcached');
  });
});

// ── C. 时间窗 ───────────────────────────────────────────────────────────

describe('C. 时间窗', () => {
  it('C1 24h → 72h：只追加，不重拉已有部分', async () => {
    // stepSec=4000 → 每页 5 张跨 20000s（5.5h）；24h 需要 5 页，72h 需要 12 页
    const pages = scriptedPages(12, 5, nowSec(), 4000);
    const { source, calls } = sourceFrom(pages);
    const feed = mountFeed(quick({ source }));

    await settle();
    const cardsAt24 = feed().cards.length;
    const callsAt24 = calls.length;

    // 拉取停在"已覆盖 24h 边界"（5 页），而不是翻到底
    expect(callsAt24).toBe(5);
    // 不变量：显示出来的每一条都在窗口内
    // （拉到的 25 张里有 3 张比 24h 边界更旧，被显示过滤器挡掉了）
    expect(feed().cards.every((c) => c.pubdate >= cutoffFor(24, nowMs))).toBe(true);
    expect(cardsAt24).toBeGreaterThan(0);

    act(() => feed().setWindowHours(72));
    await settle();

    // 只增不减
    expect(feed().cards.length).toBeGreaterThan(cardsAt24);
    // 已有的没有被清掉
    expect(feed().cards.slice(0, cardsAt24).map((c) => c.bvid)).toEqual(
      pages.flatMap((p) => p.items).slice(0, cardsAt24).map((c) => c.bvid),
    );
    // 新增的请求都是"接着往下翻"（带游标），没有从第 1 页重来
    const later = calls.slice(callsAt24);
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((o) => o !== null)).toBe(true);
  });

  it('C2 72h → 6h：一个请求都不发，只是显示变少', async () => {
    const pages = scriptedPages(12, 5, nowSec(), 4000);
    const { source, calls } = sourceFrom(pages);
    const feed = mountFeed(quick({ source }));

    act(() => feed().setWindowHours(72));
    await settle();
    const cardsAt72 = feed().cards.length;
    const callsAt72 = calls.length;

    act(() => feed().setWindowHours(6));
    await settle();

    expect(calls.length).toBe(callsAt72);
    expect(feed().cards.length).toBeLessThan(cardsAt72);
  });

  it('C3 时间窗选择落盘（否则重新打开会退回 1 天并白拉一遍）', async () => {
    const { source } = sourceFrom(scriptedPages(2, 5, nowSec(), 4000));
    const feed = mountFeed(quick({ source }));

    await settle();
    act(() => feed().setWindowHours(72));
    await settle();

    expect(JSON.parse(localStorage.getItem('bff:feedHours')!)).toBe(72);
  });
});

// ── D. 加载更多 ─────────────────────────────────────────────────────────

describe('D. 加载更多', () => {
  it('窗口盖满之后仍能看到更早的内容（v0.8.7 的回归）', async () => {
    const pages = scriptedPages(12, 5, nowSec(), 4000);
    const { source, calls } = sourceFrom(pages);
    const feed = mountFeed(quick({ source }));

    await settle(); // 24h → 5 页
    const before = feed().cards.length;

    act(() => feed().loadMore(1));
    await settle();

    // 旧实现里新拉到的内容会被时间窗滤掉，界面上毫无变化 —— 这条断言就是为此
    expect(feed().cards.length).toBeGreaterThan(before);
    expect(calls.length).toBeGreaterThan(5);
  });

  it('流到底时标记 hasMore 为 false', async () => {
    const pages = scriptedPages(2, 5, nowSec(), 4000);
    const { source } = sourceFrom(pages);
    const feed = mountFeed(quick({ source }));

    await settle();
    act(() => feed().loadMore(3));
    await settle();

    expect(feed().hasMore).toBe(false);
  });
});

// ── E. 暂停 ─────────────────────────────────────────────────────────────

describe('E. 暂停', () => {
  it('E1 补齐中暂停 → 停下，且已拉到的内容保留', async () => {
    const gate = gatedSleep();
    const pages = scriptedPages(12, 5, nowSec(), 4000);
    const { source, calls } = sourceFrom(pages);
    const feed = mountFeed(quick({ source, sleep: gate.sleep }));

    // 首屏 1 页 + 补齐的第 1 页（fillToCutoff 是"先取页、后 sleep"），
    // 所以第 1 次 gate 出现时已经拉了 2 页
    await settle();
    expect(calls).toHaveLength(2);

    act(() => feed().pause());
    await gate.drain();
    await settle();

    expect(feed().paused).toBe(true);
    expect(calls).toHaveLength(2); // 没有再发请求
    expect(feed().cards).toHaveLength(10); // 已拉到的两页都还在
  });

  it('E2 继续 → 从暂停处接着拉，不重新请求第 1 页', async () => {
    const gate = gatedSleep();
    const pages = scriptedPages(12, 5, nowSec(), 4000);
    const { source, calls } = sourceFrom(pages);
    const feed = mountFeed(quick({ source, sleep: gate.sleep }));

    await settle();
    act(() => feed().pause());
    await gate.drain();
    await settle();
    expect(feed().paused).toBe(true);

    // 用 async act 包住：resume() 会立刻发起请求，其后续的 setState 必须落在 act 内
    await act(async () => {
      feed().resume();
      await Promise.resolve();
    });
    await gate.drain();
    await settle();

    expect(calls.length).toBeGreaterThan(1);
    // 续拉的每一个请求都带游标 —— 没有从头再来
    expect(calls.slice(1).every((o) => o !== null)).toBe(true);
    expect(feed().cards.length).toBeGreaterThan(5);
  });

  it('E3 增量刷新中暂停 → 不得退化成完整重载（最容易写错的地方）', async () => {
    const known = card('BVknown', nowSec() - 100);
    localStorage.setItem(
      'bff:feedCache',
      JSON.stringify({ at: nowMs - 2 * HOUR_S * 1000, hours: 24, cards: [known], tailOffset: 'offX' }),
    );
    const gate = gatedSleep();
    // 每页都是全新条目 → 增量会一直翻，正好停在 sleep 上
    const pages: FeedPage[] = [0, 1].map((p) => ({
      items: [card(`BVn${p}`, nowSec() - p * 10)],
      nextOffset: `off${p + 1}`,
      hasMore: true,
      oldestPubTs: nowSec() - p * 10,
    }));
    const { source, calls } = sourceFrom(pages);
    const feed = mountFeed(quick({ source, sleep: gate.sleep }));

    await settle();
    expect(calls).toHaveLength(1);

    act(() => feed().pause());
    await gate.drain();
    await settle();

    expect(feed().paused).toBe(true);
    // 关键：暂停不能被当成"没追上"。后者会触发 fullLoad，从 null 重新拉第 1 页。
    // 所以整个过程中只允许出现一次 null（增量刷新自己那次首页）。
    expect(calls.filter((o) => o === null)).toHaveLength(1);
  });
});

// ── F. 游标与缓存 ───────────────────────────────────────────────────────

describe('F. 游标与缓存', () => {
  it('卡片超过 600 张被截断时，游标不能变成 null（v0.8.4 的修复）', async () => {
    // stepSec=30 → 40 页只覆盖 6.7 小时，一定翻到页数上限；40×20 = 800 张 > 600
    const pages = scriptedPages(45, 20, nowSec(), 30);
    const { source } = sourceFrom(pages);
    const feed = mountFeed(quick({ source }));

    await settle();

    const cached = JSON.parse(localStorage.getItem('bff:feedCache')!) as {
      cards: VideoCard[];
      tailOffset: string | null;
      checkpoints?: unknown[];
    };
    expect(cached.cards).toHaveLength(600);
    // 旧实现在这里存的是 null，导致每次刷新「加载更多」都要从第 1 页空转
    expect(cached.tailOffset).not.toBeNull();
    expect(cached.checkpoints?.length).toBeGreaterThan(0);
    expect(feed().cards.length).toBeGreaterThan(600);
  });

  it('因为"已覆盖窗口"而停下时，游标是最后一页的 nextOffset', async () => {
    // 6 页 × 5 张 × 4000s：第 5 页（index 4）的最早一条越过 24h 边界 → 以 covered 收尾，
    // 此时游标仍然有效（不同于"流到底"那种情况）
    const pages = scriptedPages(6, 5, nowSec(), 4000);
    const { source } = sourceFrom(pages);
    mountFeed(quick({ source }));

    await settle();

    const cached = JSON.parse(localStorage.getItem('bff:feedCache')!) as { tailOffset: string | null };
    expect(cached.tailOffset).toBe('off5');
  });

  it('流真的到底时游标为 null（没有更多可翻，这是正常的）', async () => {
    const pages = scriptedPages(2, 5, nowSec(), 4000);
    const { source } = sourceFrom(pages);
    mountFeed(quick({ source }));

    await settle();

    const cached = JSON.parse(localStorage.getItem('bff:feedCache')!) as { tailOffset: string | null };
    expect(cached.tailOffset).toBeNull();
  });
});

// ── G. 错误 ─────────────────────────────────────────────────────────────

describe('G. 错误', () => {
  it('接口报错时把原因暴露出来，而不是白屏', async () => {
    const source: FeedDataSource = {
      async fetchPage() {
        throw new Error('B站接口返回 -101：账号未登录');
      },
    };
    const feed = mountFeed(quick({ source }));

    await settle();

    expect(feed().error).toContain('-101');
    expect(feed().cards).toEqual([]);
    expect(feed().loading).toBe(false);
  });

  it('报错之后仍然可以重试（refresh 会再发请求）', async () => {
    let attempt = 0;
    const source: FeedDataSource = {
      async fetchPage() {
        attempt++;
        if (attempt === 1) throw new Error('网络断了');
        return { items: [card('BVok', nowSec())], nextOffset: null, hasMore: false, oldestPubTs: nowSec() };
      },
    };
    const feed = mountFeed(quick({ source }));

    await settle();
    expect(feed().error).not.toBeNull();

    act(() => feed().refresh());
    await settle();

    expect(feed().error).toBeNull();
    expect(feed().cards.map((c) => c.bvid)).toEqual(['BVok']);
  });
});
