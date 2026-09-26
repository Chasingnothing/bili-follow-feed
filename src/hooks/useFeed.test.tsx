import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useFeed, type FeedApi, type FeedDeps } from './useFeed';
import type { FeedDataSource } from '../data/source';
import type { FeedPage, FeedItem } from '../types';
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

function mountFeed(overrides: Partial<FeedDeps> = {}, enabled = true): () => FeedApi {
  const box: { api: FeedApi | null } = { api: null };
  function Probe() {
    box.api = useFeed(overrides, enabled);
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

/** `enabled` 可以中途改的版本 —— 用来测"切回动态流才开始加载" */
function mountToggleable(overrides: Partial<FeedDeps> = {}, initiallyEnabled = false) {
  const state = { enabled: initiallyEnabled };
  const box: { api: FeedApi | null } = { api: null };
  function Probe() {
    box.api = useFeed(overrides, state.enabled);
    return null;
  }
  const render = () => {
    act(() => {
      root.render(<Probe />);
    });
  };
  render();
  return {
    api: () => {
      if (!box.api) throw new Error('hook 还没挂载');
      return box.api;
    },
    setEnabled: (v: boolean) => {
      state.enabled = v;
      render();
    },
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

function card(id: string, pubdate: number): FeedItem {
  return {
    id,
    kind: 'video',
    title: id,
    cover: '',
    coverW: 0,
    coverH: 0,
    imageCount: 0,
    durationText: '',
    play: 0,
    danmaku: 0,
    like: 0,
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
    const items: FeedItem[] = [];
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
  it('enabled=false 时一个请求都不发（模式 2 用不到动态流）', async () => {
    const { source, calls } = sourceFrom(scriptedPages(3, 5, nowSec(), 4000));
    const feed = mountFeed(quick({ source }), false);

    await settle();

    expect(calls).toEqual([]);
    expect(feed().cards).toEqual([]);
  });

  it('enabled 从 false 变 true 时才开始加载（切回动态流）', async () => {
    const { source, calls } = sourceFrom(scriptedPages(3, 5, nowSec(), 4000));
    const h = mountToggleable(quick({ source }), false);

    await settle();
    expect(calls).toEqual([]);

    h.setEnabled(true);
    await settle();

    expect(calls.length).toBeGreaterThan(0);
    expect(h.api().cards.length).toBeGreaterThan(0);
  });

  it('enabled=true 时照常加载（默认行为不变）', async () => {
    const { source, calls } = sourceFrom(scriptedPages(1, 2, nowSec(), 4000));
    const feed = mountFeed(quick({ source }));

    await settle();

    expect(calls.length).toBeGreaterThan(0);
    expect(feed().cards.length).toBeGreaterThan(0);
  });

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
    expect(new Set(feed().cards.map((c) => c.id)).size).toBe(5);
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
  function seedCache(at: number, cards: FeedItem[], over: Record<string, unknown> = {}) {
    localStorage.setItem(
      'bff:feedCache',
      // v: 2 = 当前卡片结构版本（FeedItem）。不带它会被当成老缓存丢弃。
      JSON.stringify({ v: 2, at, hours: 24, cards, tailOffset: 'offX', ...over }),
    );
  }

  it('⚠️ 卡片结构版本不符的缓存必须丢弃（老卡片没有 id/kind，读回来是坏的）', async () => {
    // 模拟 v0.8.x 留下的缓存：卡片里是 bvid 而不是 id
    localStorage.setItem(
      'bff:feedCache',
      JSON.stringify({
        at: nowMs - 30_000,
        hours: 24,
        cards: [{ bvid: 'BVold', title: 'old', pubdate: nowSec() - 100, play: 0 }],
        tailOffset: 'offX',
      }),
    );
    const { source, calls } = sourceFrom(scriptedPages(1, 2, nowSec(), 4000));
    const feed = mountFeed(quick({ source }));

    await settle();

    // 不能复用，必须重新拉
    expect(calls.length).toBeGreaterThan(0);
    expect(feed().cards.map((c) => c.id)).not.toContain('BVold');
  });

  it('B1 缓存不到 10 秒 → 一个请求都不发（只防手抖连按刷新）', async () => {
    seedCache(nowMs - 5_000, [card('BVcached', nowSec() - 100)]);
    const { source, calls } = sourceFrom([]);
    const feed = mountFeed(quick({ source }));

    await settle();

    expect(calls).toEqual([]);
    expect(feed().cards.map((c) => c.id)).toEqual(['BVcached']);
  });

  /**
   * 回归：**浏览器 F5 应该检查更新**（用户报告的问题 1）。
   *
   * 防抖原本是 60 秒，于是"打开页面 → 没看到新的 → 按 F5 再确认一次"
   * 这个再正常不过的操作会**落在防抖里，一个请求都不发**。
   * 现在只有 10 秒，30 秒的缓存会照常去检查。
   */
  it('B1b 缓存 30 秒 → 会去检查更新（旧的 60 秒防抖会跳过这里）', async () => {
    const known = card('BVknown', nowSec() - 100);
    seedCache(nowMs - 30_000, [known]);
    const page1: FeedPage = {
      items: [card('BVnew', nowSec()), known],
      nextOffset: 'off1',
      hasMore: true,
      oldestPubTs: known.pubdate,
    };
    const { source, calls } = sourceFrom([page1]);
    const feed = mountFeed(quick({ source }));

    await settle();

    expect(calls).toHaveLength(1);
    expect(feed().cards.map((c) => c.id)).toEqual(['BVnew', 'BVknown']);
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
    expect(feed().cards.map((c) => c.id)).toEqual(['BVnew1', 'BVnew2', 'BVknown']);
  });

  it('缓存时间窗不匹配时不复用（否则会显示错窗口的内容）', async () => {
    seedCache(nowMs - 30_000, [card('BVcached', nowSec() - 100)], { hours: 6 });
    const { source, calls } = sourceFrom(scriptedPages(1, 2, nowSec(), 4000));
    const feed = mountFeed(quick({ source }));

    await settle();

    expect(calls.length).toBeGreaterThan(0);
    expect(feed().cards.map((c) => c.id)).not.toContain('BVcached');
  });

  /**
   * 回归：**刷新页面时增量请求报错，以前是静默失败**。
   *
   * 界面上的「刷新」按钮走 `fullLoad`（有 catch），浏览器 F5 走缓存命中后的
   * `incremental` —— 而 `incremental` 原本只有 `try/finally`、**没有 catch**：
   * 异常一路穿出 `load`（调用处是 `void load(...)`），变成未处理的 rejection，
   * `setError` 永远不会被调用。
   *
   * 用户看到的是"刷新了但没有检查更新"，实际是**检查了、失败了、没说话**。
   */
  it('刷新页面时增量请求报错，要把原因暴露出来（不再是静默失败）', async () => {
    const known = card('BVknown', nowSec() - 100);
    seedCache(nowMs - 2 * HOUR_S * 1000, [known]);
    const source: FeedDataSource = {
      async fetchPage() {
        throw new Error('B站接口返回 -412：请求被拦截');
      },
    };
    const feed = mountFeed(quick({ source }));

    await settle();

    // 缓存照常显示（拿不到新的就先看旧的，这部分行为是对的）
    expect(feed().cards.map((c) => c.id)).toEqual(['BVknown']);
    // 但失败必须说出来 —— 以前这里是 null
    expect(feed().error).toBe('B站接口返回 -412：请求被拦截');
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
    expect(feed().cards.slice(0, cardsAt24).map((c) => c.id)).toEqual(
      pages.flatMap((p) => p.items).slice(0, cardsAt24).map((c) => c.id),
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

  /**
   * 用户报告：多个浏览器都装了之后，把界面从「3 天前」切到「1 天前」，
   * **一张卡片都不渲染**。下面两条按用户的真实动作复现。
   *
   * 60 张卡跨 66 小时，所以 24 小时窗口里应该有二十多张 —— 渲染出 0 张必然是 bug。
   */
  it('C4 72h → 24h：页面同一个会话内直接切窗口', async () => {
    const pages = scriptedPages(12, 5, nowSec(), 4000);
    const { source } = sourceFrom(pages);
    const feed = mountFeed(quick({ source }));

    act(() => feed().setWindowHours(72));
    await settle();
    const at72 = feed().cards.length;
    expect(at72).toBeGreaterThan(0);

    act(() => feed().setWindowHours(24));
    await settle();

    expect(feed().cards.length).toBeGreaterThan(0);
    expect(feed().cards.every((c) => c.pubdate >= cutoffFor(24, nowMs))).toBe(true);
  });

  it('C5 刷新页面（缓存里是 72h）之后再切到 24h', async () => {
    const pages = scriptedPages(12, 5, nowSec(), 4000);

    // ── 第一次会话：拉 72h 并落盘
    {
      const { source } = sourceFrom(pages);
      const feed = mountFeed(quick({ source }));
      act(() => feed().setWindowHours(72));
      await settle();
      expect(feed().cards.length).toBeGreaterThan(0);
    }
    act(() => root.unmount());
    root = createRoot(container);

    // ── 第二次会话：从缓存铺上（此时 hours 还是 72），然后切到 24h
    const { source: source2 } = sourceFrom(pages);
    const feed2 = mountFeed(quick({ source: source2 }));
    await settle();
    expect(feed2().cards.length).toBeGreaterThan(0);

    act(() => feed2().setWindowHours(24));
    await settle();

    expect(feed2().cards.length).toBeGreaterThan(0);
    expect(feed2().cards.every((c) => c.pubdate >= cutoffFor(24, nowMs))).toBe(true);
  });

  /**
   * 回归：**用户报告的核心症状**。
   *
   * 场景（和用户描述的一模一样）：缓存里最新的内容是 30 小时前，
   * 时间窗是 3 天 → 切到 1 天 → 筛出来是空数组 → **界面一片空白**。
   *
   * 这不是"真的没有内容"，而是"缓存可能旧了"。以前缩窗口**一个请求都不发**，
   * 所以只要缓存没跟上，缩窗口就必然是白屏。
   *
   * 修法：筛出空时先花 1 个请求去顶部确认一次，有更新的就补进来。
   */
  it('缩到"窗口内一条都没有"时要去确认一次，有更新的就补进来', async () => {
    const old = card('BVold', nowSec() - 30 * HOUR_S); // 30 小时前 → 落在 24h 窗口之外
    // 缓存放的是 72h 且"刚刚写过"，这样挂载时不会触发增量刷新 ——
    // 把检查的时机隔离到"切换窗口"这一步
    localStorage.setItem(
      'bff:feedCache',
      JSON.stringify({ v: 2, at: nowMs, hours: 72, cards: [old], tailOffset: 'offX' }),
    );
    // 时间窗也要种上 —— 否则 load() 用默认的 24 去比，缓存的 hours=72 不匹配会被整个丢弃
    localStorage.setItem('bff:feedHours', '72');

    const page1: FeedPage = {
      items: [card('BVnew', nowSec() - HOUR_S), old],
      nextOffset: 'off1',
      hasMore: true,
      oldestPubTs: old.pubdate,
    };
    const { source, calls } = sourceFrom([page1, page1]);
    const feed = mountFeed(quick({ source }));

    await settle();
    // 挂载时缓存是新的（0 秒前写的），所以这里一个请求都没发
    expect(calls).toHaveLength(0);
    expect(feed().cards.map((c) => c.id)).toEqual(['BVold']);

    // 切到 1 天：BVold 在窗口之外 → 筛出空 → 必须去确认一次
    act(() => feed().setWindowHours(24));
    await settle();

    expect(calls.length).toBeGreaterThan(0);
    // 确认之后拿到了新内容，界面不该是空的
    expect(feed().cards.map((c) => c.id)).toContain('BVnew');
    expect(feed().cards.every((c) => c.pubdate >= cutoffFor(24, nowMs))).toBe(true);
  });

  /**
   * 上面两条用的是"瞬间 resolve"的假数据源，覆盖不到**真实的异步时序**：
   * 真实环境里 delayMs/flushMs 都存在，用户切窗口时后台补齐通常**还在飞**。
   *
   * 这条复现那个时序：首屏出来后补齐被 gate 挂住 → 此时切到 24h →
   * 才放行。这是用户最可能真实遇到的路径。
   */
  it('C6 后台补齐还在飞的时候切到 24h（真实时序）', async () => {
    const gate = gatedSleep();
    const pages = scriptedPages(12, 5, nowSec(), 4000);
    const { source } = sourceFrom(pages);
    const feed = mountFeed(quick({ source, sleep: gate.sleep }));

    // 首屏出来了，但后台补齐卡在 sleep 上
    await settle();
    const early = feed().cards.length;
    expect(early).toBeGreaterThan(0);
    expect(gate.pending()).toBeGreaterThan(0);

    // 趁补齐还在飞，切窗口
    act(() => feed().setWindowHours(24));
    await settle();

    // 放行所有挂起的 sleep，让两条链都跑完
    await gate.drain();
    await settle();

    expect(feed().cards.length).toBeGreaterThan(0);
    expect(feed().cards.every((c) => c.pubdate >= cutoffFor(24, nowMs))).toBe(true);
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
      JSON.stringify({
        v: 2,
        at: nowMs - 2 * HOUR_S * 1000,
        hours: 24,
        cards: [known],
        tailOffset: 'offX',
      }),
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
      cards: FeedItem[];
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
  /**
   * ⚠️ **这不是"应该通过"的测试，是记录一个真实的缺口。**
   *
   * `feed/all` 返回 `code: 0` 但条目列表为空时（风控、服务端抖动、账号异常都可能这样），
   * `applyPage` 没有"这次一个条目都没收到"的判断，`fullLoad` 也不区分
   * "真的没有内容"和"这次没拿到内容" —— 结果是：
   *   ① 页面完全空白，**而且不报任何错**（用户看到的和"你没关注任何人"一模一样）
   *   ② 这个空结果还会被 `persistCache` 落盘，把本来好的缓存覆盖掉
   *
   * 用户报告的"切到 1 天后一张卡都不渲染"最像这条链。
   */
  it('【已知缺口】接口返回空列表 → 全空、不报错、且空结果被落盘', async () => {
    const empty: FeedPage = { items: [], nextOffset: null, hasMore: false, oldestPubTs: 0 };
    const { source, calls } = sourceFrom([empty, empty, empty]);
    const feed = mountFeed(quick({ source }));

    await settle();

    // ① 一张卡都没有
    expect(feed().cards).toHaveLength(0);
    // ② 没有任何错误提示 —— 用户无从判断是"没内容"还是"出问题了"
    //    （接口明明成功返回了，只是空的）
    expect(feed().error).toBeNull();
    // ③ 空结果被写进了缓存，把可能更好的旧缓存覆盖掉
    const cached = JSON.parse(localStorage.getItem('bff:feedCache')!) as { cards: unknown[] };
    expect(cached.cards).toHaveLength(0);
    // ④ 而且不会只请求一次：`coversWindow([])` 恒为 false，
    //    于是它认定"还没覆盖到窗口"，继续往下翻（上限 40 页）
    expect(calls.length).toBeGreaterThan(1);
  });

  it('空列表即使带 has_more:true 也只请求一次就停（不会风暴）', async () => {
    // 我原本以为这里会翻满 40 页上限 —— 实测**不会**：
    // `fillToCutoff` 用 `oldestPubTs === 0`（空页）判定到头，与 has_more 无关。
    // 记下来当作回归保护，免得以后有人删掉那个判断。
    const empty: FeedPage = { items: [], nextOffset: 'x', hasMore: true, oldestPubTs: 0 };
    const many = Array.from({ length: 60 }, () => empty);
    const { source, calls } = sourceFrom(many);
    const feed = mountFeed(quick({ source }));

    await settle();

    expect(feed().cards).toHaveLength(0);
    // 首页 1 次 + runFill 1 次 = 2，然后就因为"空页 = 到头"停了
    expect(calls).toHaveLength(2);
  });

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
    expect(feed().cards.map((c) => c.id)).toEqual(['BVok']);
  });
});
