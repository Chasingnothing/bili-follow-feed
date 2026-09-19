import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeedPage, FeedItem } from '../types';
import { InPageDataSource } from '../data/inPage';
import type { FeedDataSource } from '../data/source';
import {
  cutoffFor,
  fetchNewer,
  fillToCutoff,
  offsetForKept,
  shiftCheckpoints,
  withinWindow,
  coversWindow,
  visibleCutoff,
  NO_MANUAL_FLOOR,
  WINDOW_OPTIONS,
} from '../lib/feedWindow';
import type { PageCheckpoint } from '../lib/feedWindow';
import { readJson, writeJson } from '../lib/storage';

/** 页与页之间的等待：探针实测 30 页 / 400ms 可稳定跑完 */
const PAGE_DELAY_MS = 400;
/** 完整加载时的翻页上限。实测 30 页≈3 天，40 页留余量 */
const MAX_FILL_PAGES = 40;
/** 增量刷新时最多往下追几页；追不上说明离线太久，退回完整加载 */
const MAX_INCREMENTAL_PAGES = 15;
/** 距上次写入多久之内连增量刷新都跳过（防抖，避免连续刷新打接口） */
const FRESH_MS = 60 * 1000;

const CACHE_KEY = 'bff:feedCache';
/**
 * 用户选的时间窗也要落盘。
 *
 * 否则重新打开页面时窗口会回到默认的 1 天，而缓存里存的是 `hours: 72` ——
 * `cached.hours === hours` 不成立，于是**白白重拉一遍**。
 */
const HOURS_KEY = 'bff:feedHours';
/** 缓存里最多留多少张卡片 */
const MAX_CACHED_CARDS = 600;
/**
 * 完整加载时的**渲染节流**间隔。
 *
 * 完整加载会连续翻最多 40 页。原先每页都 `setCards` + `setFilledPages`，
 * 也就是 40 次全量重渲染 —— 关注多的人会觉得页面卡死。
 * 现在卡片先累积进 `cardsRef`（**逻辑立即生效**），画面最多每 400ms 刷新一次。
 */
const RENDER_FLUSH_MS = 400;

export interface MoreProgress {
  done: number;
  total: number;
}

export interface FeedApi {
  cards: FeedItem[];
  hasMore: boolean;
  /** 首屏加载中（无缓存可用时才会出现） */
  loading: boolean;
  /** 后台补齐时间窗中 */
  filling: boolean;
  /** 后台补齐被用户暂停了（可以「继续」接着拉） */
  paused: boolean;
  /** 后台增量刷新中（已经在显示缓存内容） */
  refreshing: boolean;
  filledPages: number;
  covered: boolean;
  capReached: boolean;
  error: string | null;
  windowHours: number;
  setWindowHours: (h: number) => void;
  loadMore: (pages: number) => void;
  loadingMore: boolean;
  moreProgress: MoreProgress | null;
  /** 请求在下一个页边界停下（已拉到的内容保留） */
  pause: () => void;
  /** 从暂停处接着补齐 */
  resume: () => void;
  refresh: () => void;
}

function realSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * `useFeed` 的可注入依赖。
 *
 * 存在的唯一理由是**为了能测**：这个 hook 管着请求编排、节流、定时器和缓存读写，
 * 是本项目最容易出错的地方（v0.8.3–v0.8.9 的四个 bug 全在这里），
 * 而它此前一条测试都没有。生产代码一个参数都不传，行为与以前完全一致。
 *
 * 与 `fillToCutoff` / `fetchNewer` 的做法一致 —— 那里也是"依赖全部由参数注入，
 * 测试时传假的 fetchPage / sleep 即可"。
 */
export interface FeedDeps {
  source: FeedDataSource;
  sleep: (ms: number) => Promise<void>;
  /** 页与页之间的等待 */
  delayMs: number;
  /** 画面刷新节流间隔 */
  flushMs: number;
  /** 增量刷新的防抖窗口：距上次写盘多久之内连增量都跳过 */
  freshMs: number;
  /** 当前时间（毫秒）。测试里可控，用来验证防抖与时间窗 */
  now: () => number;
}

interface FeedCache {
  /**
   * 缓存结构版本。
   *
   * 加它是因为卡片模型从 `VideoCard`（`bvid`）泛化成了 `FeedItem`（`id` + `kind`）：
   * 老缓存里的卡片没有 `id`，读回来会让 React key 变成 undefined、已读状态对不上。
   * 动态流本来就能重新拉，所以直接让旧缓存失效是最省事也最安全的做法。
   */
  v: number;
  at: number;
  hours: number;
  cards: FeedItem[];
  /** 已加载到的尾部游标。**必须一起存** —— 否则缓存命中后「加载更多」会从第 1 页重来 */
  tailOffset: string | null;
  /**
   * 每页一个检查点，用于卡片被截断时**仍然能算出一个有效游标**。
   * 老版本缓存没有这个字段 → 按空数组处理。
   */
  checkpoints?: PageCheckpoint[];
}

/** 卡片模型泛化后从 1 提到 2 */
const CACHE_VERSION = 2;

/** 手动「加载更多」的页数选项 */
export const LOAD_MORE_OPTIONS = [1, 3, 5, 10];

/** 读回用户上次选的时间窗；存的值不合法（老版本 / 手改）时回落默认的 1 天 */
function loadStoredHours(): number {
  const h = readJson<number>(HOURS_KEY, 24);
  return WINDOW_OPTIONS.some((o) => o.hours === h) ? h : 24;
}

/**
 * 动态流加载。
 *
 * 三种路径：
 *  1. **无缓存** → 完整加载：第一页秒出，再后台补齐到时间窗边界
 *  2. **有缓存** → 先把缓存铺上（刷新页面不白屏、不重拉），再**增量刷新**：
 *     从顶部往下抓，撞见已知条目就停。离开 1 小时通常只需 1 页
 *  3. **增量追不上**（离线太久）→ 退回完整加载
 */
export function useFeed(overrides: Partial<FeedDeps> = {}): FeedApi {
  // 冻结在第一渲染：依赖在 hook 生命周期内不应该变（测试传一次就够了），
  // 用 ref 而不是 useMemo 是为了避免调用方传对象字面量导致每渲染都重建
  const depsRef = useRef<FeedDeps | null>(null);
  if (depsRef.current === null) {
    depsRef.current = {
      source: overrides.source ?? new InPageDataSource(),
      sleep: overrides.sleep ?? realSleep,
      delayMs: overrides.delayMs ?? PAGE_DELAY_MS,
      flushMs: overrides.flushMs ?? RENDER_FLUSH_MS,
      freshMs: overrides.freshMs ?? FRESH_MS,
      now: overrides.now ?? Date.now,
    };
  }
  const { source, sleep, delayMs, flushMs, freshMs, now } = depsRef.current;

  const [cards, setCards] = useState<FeedItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [filling, setFilling] = useState(false);
  const [paused, setPaused] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filledPages, setFilledPages] = useState(0);
  const [covered, setCovered] = useState(false);
  const [capReached, setCapReached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [windowHours, setWindowHours] = useState(loadStoredHours);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreProgress, setMoreProgress] = useState<MoreProgress | null>(null);

  const started = useRef(false);
  const tailOffset = useRef<string | null>(null);
  const cardsRef = useRef<FeedItem[]>([]);
  const hoursRef = useRef(windowHours);
  /** 加载代次：切换时间窗会启动新加载，旧的那次应丢弃自己的结果 */
  const gen = useRef(0);
  /** 每翻完一页记一条，用于截断后仍能算出有效游标 —— 见 feedWindow.offsetForKept */
  const checkpointsRef = useRef<PageCheckpoint[]>([]);
  /**
   * 手动「加载更多」拉到的最旧一条的时间。
   *
   * 窗口边界**不该挡住用户手动要来的内容**：窗口被盖满之后再点「加载更多」，
   * 拉回来的必然全是窗口之外的旧内容，照窗口过滤就会表现为"点了没反应"。
   * `NO_MANUAL_FLOOR` 表示还没手动加载过。
   */
  const manualFloorRef = useRef<number>(NO_MANUAL_FLOOR);
  /**
   * 用户点了暂停。
   *
   * 用 ref 而不是 state 的原因：`fillToCutoff` 是在 await 之间轮询这个标记的，
   * 用 state 会读到闭包里的旧值（而且要等一次重渲染才生效）。
   */
  const pauseRequestedRef = useRef(false);
  /**
   * 暂停时记下"怎么继续"。
   *
   * 三个长任务（后台补齐 / 增量刷新 / 手动加载更多）的续跑方式各不相同，
   * 与其加一个任务类型枚举再分派，不如直接存一个闭包 —— `resume()` 只管调用它。
   */
  const resumeFnRef = useRef<(() => void) | null>(null);

  /**
   * 时间窗是【显示】范围；`cardsRef` 里保留的是【已拉到的】深度（通常更深）。
   *
   * 两者分开之后：缩小窗口不需要重新拉取（只是显示变少），扩大窗口也不需要
   * 重拉已有的部分（从游标接着往下追加就行）。
   */
  const windowFilter = useCallback((all: FeedItem[]) => {
    const cutoff = visibleCutoff(hoursRef.current, manualFloorRef.current, now());
    // 「仅首页」(0) 时 visibleCutoff 返回 -Infinity，等价于不过滤
    return withinWindow(all, cutoff);
  }, []);

  const applyCards = useCallback(
    (next: FeedItem[]) => {
      cardsRef.current = next;
      setCards(windowFilter(next));
    },
    [windowFilter],
  );

  // ── 渲染节流（只用于后台翻页）──────────────────────────────────────────
  const pagesRef = useRef(0);
  const hasMoreRef = useRef(true);
  const pendingFlush = useRef<number | null>(null);
  /** 0 表示"从未刷新过"，于是第一次 scheduleFlush 会立即刷新（首屏必须秒出） */
  const lastFlushAt = useRef(0);
  /** 已收进 `cardsRef` 的 bvid，用于跨页去重；每次从零加载时重建 */
  const seenRef = useRef<Set<string>>(new Set());

  const flushNow = useCallback(() => {
    if (pendingFlush.current !== null) {
      clearTimeout(pendingFlush.current);
      pendingFlush.current = null;
    }
    lastFlushAt.current = now();
    setCards(windowFilter(cardsRef.current));
    setFilledPages(pagesRef.current);
    setHasMore(hasMoreRef.current);
  }, [windowFilter]);

  const scheduleFlush = useCallback(() => {
    const elapsed = now() - lastFlushAt.current;
    if (elapsed >= flushMs) {
      flushNow();
      return;
    }
    if (pendingFlush.current !== null) return;
    pendingFlush.current = window.setTimeout(() => {
      pendingFlush.current = null;
      flushNow();
    }, flushMs - elapsed);
  }, [flushNow]);

  // 卸载时清掉待处理的定时器，避免在已卸载的组件上 setState
  useEffect(
    () => () => {
      if (pendingFlush.current !== null) clearTimeout(pendingFlush.current);
    },
    [],
  );

  const persistCache = useCallback((hours: number) => {
    const truncated = cardsRef.current.length > MAX_CACHED_CARDS;
    // 截断后原来的游标指向的位置已经不在缓存里了：
    // 直接保留会漏一段，置 null 会让每次刷新都从第 1 页空转。
    // 改用一个"不超过截断点"的检查点游标，既不漏也不空转（见 offsetForKept）。
    const tail = truncated
      ? offsetForKept(checkpointsRef.current, MAX_CACHED_CARDS)
      : tailOffset.current;
    writeJson(CACHE_KEY, {
      v: CACHE_VERSION,
      at: now(),
      hours,
      cards: cardsRef.current.slice(0, MAX_CACHED_CARDS),
      tailOffset: tail,
      checkpoints: checkpointsRef.current,
    } satisfies FeedCache);
  }, []);

  /**
   * 把一页的结果并进 `cardsRef`，并记一个检查点。
   *
   * `fullLoad`（从零）与「扩大窗口时的续拉」共用这一段 —— 两者的区别只在于
   * 调用前 `cardsRef` / `checkpointsRef` 是不是空的。
   */
  const applyPage = useCallback(
    (page: FeedPage) => {
      const added: FeedItem[] = [];
      for (const c of page.items) {
        if (seenRef.current.has(c.id)) continue;
        seenRef.current.add(c.id);
        added.push(c);
      }
      if (added.length > 0) cardsRef.current = [...cardsRef.current, ...added];
      hasMoreRef.current = page.hasMore;
      // 检查点每一页都要记：「这页处理完后累计多少张卡」+「从这页之后再往下的游标」
      if (page.nextOffset) {
        checkpointsRef.current.push({ count: cardsRef.current.length, offset: page.nextOffset });
      }
      scheduleFlush();
    },
    [scheduleFlush],
  );

  /**
   * 从 `startOffset` 往下翻，直到覆盖 `hours` 窗口 / 流到底 / 翻满上限。
   *
   * **不重置任何状态** —— 所以"在已有卡片上接着往下拉"和"从零开始拉"是同一条
   * 代码路径。这就是"扩大窗口 = 纯追加"的实现方式。
   */
  const runFill = useCallback(
    async (hours: number, myGen: number, startOffset: string | null) => {
      // 开始一次补齐 → 先清掉上一轮的暂停标记（「继续」也是走这条路径）
      pauseRequestedRef.current = false;
      setPaused(false);
      setFilling(true);
      try {
        const res = await fillToCutoff({
          fetchPage: (offset) => source.fetchPage(offset),
          startOffset,
          cutoffTs: cutoffFor(hours, now()),
          // 总页数上限是全局的：续拉时要把已经翻过的页数扣掉
          maxPages: Math.max(0, MAX_FILL_PAGES - pagesRef.current - 1),
          onPage: (p) => {
            if (myGen !== gen.current) return;
            applyPage(p);
            pagesRef.current += 1;
            tailOffset.current = p.nextOffset;
          },
          delayMs,
          sleep,
          shouldStop: () => pauseRequestedRef.current,
        });

        if (myGen !== gen.current) return;

        if (res.stoppedBy === 'paused') {
          // 用户主动中断：已拉到的照样落盘，游标停在这一页，之后能接着拉
          setPaused(true);
          resumeFnRef.current = () => {
            void runFill(hoursRef.current, gen.current, tailOffset.current);
          };
          persistCache(hours);
          return;
        }

        setCovered(res.covered);
        setCapReached(res.stoppedBy === 'cap');
        persistCache(hours);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        // 保证最后一页一定画出来（节流可能把它攒在待处理的定时器里）
        flushNow();
        setFilling(false);
      }
    },
    [source, applyPage, persistCache, flushNow],
  );

  /** 完整加载：清空 → 第一页秒出 → 后台补齐到窗口边界 */
  const fullLoad = useCallback(
    async (hours: number, myGen: number) => {
      setLoading(true);
      setCapReached(false);
      setFilledPages(0);
      setMoreProgress(null);
      tailOffset.current = null;
      pagesRef.current = 0;
      checkpointsRef.current = [];
      seenRef.current = new Set();
      cardsRef.current = [];
      // 从头开始时手动下限也归零，否则会一直显示"上次手动加载到的更早位置"
      manualFloorRef.current = NO_MANUAL_FLOOR;
      pauseRequestedRef.current = false;
      setPaused(false);

      try {
        const first = await source.fetchPage(null);
        if (myGen !== gen.current) return;
        applyPage(first);
        tailOffset.current = first.nextOffset;
        // 首屏已出，后续是后台补齐 —— 不能让 UI 一直显示"加载中"
        flushNow();
        setLoading(false);

        if (hours === 0) {
          setCovered(true);
          persistCache(hours);
          return;
        }

        await runFill(hours, myGen, first.nextOffset);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        flushNow();
        setLoading(false);
      }
    },
    [source, applyPage, persistCache, flushNow, runFill],
  );

  /**
   * 把增量刷新的结果并进列表。
   *
   * ⚠️ 头部插入会改变所有卡片的下标，检查点的 count 必须同步平移。
   * 漏了这一步会在截断时选中一个越过截断点的检查点 → 恢复后**漏掉中间几条**。
   */
  const mergeFresh = useCallback(
    (fresh: FeedItem[]) => {
      if (fresh.length === 0) return;
      applyCards([...fresh, ...cardsRef.current]);
      checkpointsRef.current = shiftCheckpoints(checkpointsRef.current, fresh.length);
    },
    [applyCards],
  );

  /**
   * 增量刷新：从顶部往下抓，撞见已知条目即停。
   * 追到上限还没撞见（离线太久）就返回 false，由调用方退回完整加载。
   */
  const incremental = useCallback(
    async (cachedCards: FeedItem[], myGen: number): Promise<'merged' | 'fallback'> => {
      pauseRequestedRef.current = false;
      setPaused(false);
      setRefreshing(true);
      let res: Awaited<ReturnType<typeof fetchNewer>>;
      try {
        res = await fetchNewer({
          fetchPage: (offset) => source.fetchPage(offset),
          known: new Set(cachedCards.map((c) => c.id)),
          maxPages: MAX_INCREMENTAL_PAGES,
          delayMs,
          sleep,
          shouldStop: () => pauseRequestedRef.current,
        });
      } finally {
        setRefreshing(false);
      }

      if (myGen !== gen.current) return 'merged';

      // ⚠️ 暂停**不等于**"没追上"：后者意味着缓存与新增之间有断层、必须整体重来。
      // 暂停只是"先停一下"，已收到的 fresh 是有效的，并进去就好。
      if (res.paused) {
        mergeFresh(res.fresh);
        setPaused(true);
        resumeFnRef.current = () => {
          void incremental(cardsRef.current, gen.current);
        };
        persistCache(hoursRef.current);
        return 'merged';
      }

      // 没追上 = 缓存与新增之间有断层，必须整体重来，不能把两段接上
      if (!res.caughtUp) return 'fallback';

      mergeFresh(res.fresh);
      persistCache(hoursRef.current);
      return 'merged';
    },
    [source, applyCards, persistCache, mergeFresh],
  );

  const load = useCallback(
    async (hours: number, force: boolean) => {
      const myGen = ++gen.current;
      setError(null);

      if (!force) {
        const cached = readJson<FeedCache | null>(CACHE_KEY, null);
        if (
          cached &&
          // 结构版本不符就直接丢弃 —— 老卡片没有 id/kind，读回来是坏的
          cached.v === CACHE_VERSION &&
          cached.hours === hours &&
          Array.isArray(cached.cards) &&
          cached.cards.length
        ) {
          // ① 先把缓存铺上：刷新页面不白屏，也不重跑 10 页
          applyCards(cached.cards);
          tailOffset.current = cached.tailOffset ?? null;
          // 检查点必须一起恢复，否则本轮一旦发生截断，游标又会被置 null
          checkpointsRef.current = cached.checkpoints ?? [];
          // 深度信息也要恢复，否则「扩大窗口」会以为自己只有第一页
          pagesRef.current = cached.checkpoints?.length ?? 0;
          seenRef.current = new Set(cached.cards.map((c) => c.id));
          setCovered(true);
          setHasMore(true);
          setLoading(false);

          // ② 刚拉过就连增量都跳过，避免连续刷新打接口
          if (now() - cached.at < freshMs) return;

          // ③ 增量刷新；追不上就退回完整加载
          const outcome = await incremental(cached.cards, myGen);
          if (outcome === 'fallback' && myGen === gen.current) {
            await fullLoad(hours, myGen);
          }
          return;
        }
      }

      await fullLoad(hours, myGen);
    },
    [incremental, fullLoad, applyCards],
  );

  useEffect(() => {
    if (started.current) return; // 挡住 React StrictMode 的二次执行
    started.current = true;
    void load(windowHours, false);
    // 只在挂载时跑一次；窗口变化由 setWindowHours 自己触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  /**
   * 切换时间窗 —— **不再清空重拉**。
   *
   * 时间窗只是【显示】范围，`cardsRef` 里保留的是【已拉到的】深度，于是：
   *  - 新窗口比已有深度**浅** → 0 个请求，只是显示变少
   *  - 新窗口比已有深度**深** → 从现有游标**接着往下拉**（纯追加）
   *  - 没有数据 / 游标不可用 → 才退回完整加载
   */
  const applyWindow = useCallback(
    async (h: number, myGen: number) => {
      const all = cardsRef.current;

      if (all.length === 0) {
        await fullLoad(h, myGen);
        return;
      }

      // 先按新窗口刷新显示。缩小窗口的情况到这里就结束了，一个请求都不发。
      flushNow();

      if (h === 0 || coversWindow(all, cutoffFor(h, now()))) {
        setCovered(true);
        persistCache(h);
        return;
      }

      // 深度不够，需要接着往下拉。游标不可用（例如老缓存）就只能重来。
      if (tailOffset.current === null) {
        await fullLoad(h, myGen);
        return;
      }

      await runFill(h, myGen, tailOffset.current);
    },
    [fullLoad, runFill, persistCache, flushNow],
  );

  const changeWindow = useCallback(
    (h: number) => {
      hoursRef.current = h;
      setWindowHours(h);
      writeJson(HOURS_KEY, h);
      // 重新选窗口 = 重新声明"我要看多久"，此前的"手动看更早"作废
      manualFloorRef.current = NO_MANUAL_FLOOR;
      const myGen = ++gen.current;
      setError(null);
      void applyWindow(h, myGen);
    },
    [applyWindow],
  );

  const refresh = useCallback(() => {
    void load(hoursRef.current, true);
  }, [load]);

  /**
   * 手动继续往下翻 `pages` 页。
   * 逐页追加并实时更新进度 —— 一次点 10 页要跑约 8 秒，不能没有任何反馈。
   */
  const loadMore = useCallback(
    (pages: number) => {
      void (async () => {
        pauseRequestedRef.current = false;
        setPaused(false);
        setLoadingMore(true);
        setMoreProgress({ done: 0, total: pages });
        setError(null);
        try {
          for (let i = 0; i < pages; i++) {
            if (pauseRequestedRef.current) {
              // 剩下的页数记下来，「继续」时接着拉
              const remaining = pages - i;
              setPaused(true);
              resumeFnRef.current = () => loadMore(remaining);
              break;
            }

            const page = await source.fetchPage(tailOffset.current);

            const seen = new Set(cardsRef.current.map((c) => c.id));
            const added = page.items.filter((c) => !seen.has(c.id));
            if (added.length > 0) {
              // 手动加载来的内容**必须能看见** —— 放宽显示下限。
              // 否则窗口盖满之后每次点「加载更多」拉回的都是窗口外的旧内容，全被滤掉，
              // 表现为"点了没反应"。
              let oldest = manualFloorRef.current;
              for (const c of added) if (c.pubdate < oldest) oldest = c.pubdate;
              manualFloorRef.current = oldest;
            }
            applyCards([...cardsRef.current, ...added]);

            setHasMore(page.hasMore);
            // 与 hasMoreRef 保持同步：完整加载的节流刷新会用后者覆盖 state
            hasMoreRef.current = page.hasMore;
            // 手动翻页也要记检查点，否则「加载更多」拉深之后截断仍然会丢游标
            if (page.nextOffset) {
              checkpointsRef.current.push({
                count: cardsRef.current.length,
                offset: page.nextOffset,
              });
            }
            tailOffset.current = page.nextOffset;
            setMoreProgress({ done: i + 1, total: pages });

            const exhausted = !page.hasMore || !page.nextOffset || page.oldestPubTs === 0;
            if (exhausted) break;
            if (i < pages - 1) await sleep(delayMs);
          }
          persistCache(hoursRef.current);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setLoadingMore(false);
          // 进度多留一会儿再清，避免闪一下就没了
          await sleep(600);
          setMoreProgress(null);
        }
      })();
    },
    [source, applyCards, persistCache],
  );

  /**
   * 暂停动态流拉取。
   *
   * 只是**置一个标记** —— 真正的停止发生在下一页开始之前，所以当前这一页会跑完。
   * 这样做的好处是结果一页都不丢（已交付的页都已经进了 `cardsRef` 并落了盘），
   * 代价是最多多等一次限速（约 400ms）+ 一次请求往返。
   *
   * 三个长任务都认这个标记：后台补齐、增量刷新、手动加载更多。
   */
  const pause = useCallback(() => {
    pauseRequestedRef.current = true;
  }, []);

  /** 从暂停处接着跑 —— 续跑方式由暂停时的任务自己登记在 `resumeFnRef` 里 */
  const resume = useCallback(() => {
    const fn = resumeFnRef.current;
    resumeFnRef.current = null;
    pauseRequestedRef.current = false;
    setPaused(false);
    fn?.();
  }, []);

  return {
    cards,
    hasMore,
    loading,
    filling,
    paused,
    refreshing,
    filledPages,
    covered,
    capReached,
    error,
    windowHours,
    setWindowHours: changeWindow,
    loadMore,
    loadingMore,
    moreProgress,
    pause,
    resume,
    refresh,
  };
}
