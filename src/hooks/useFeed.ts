import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeedPage, VideoCard } from '../types';
import { InPageDataSource } from '../data/inPage';
import { cutoffFor, fetchNewer, fillToCutoff } from '../lib/feedWindow';
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
/** 缓存里最多留多少张卡片 */
const MAX_CACHED_CARDS = 600;

export interface MoreProgress {
  done: number;
  total: number;
}

export interface FeedApi {
  cards: VideoCard[];
  hasMore: boolean;
  /** 首屏加载中（无缓存可用时才会出现） */
  loading: boolean;
  /** 后台补齐时间窗中 */
  filling: boolean;
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
  refresh: () => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface FeedCache {
  at: number;
  hours: number;
  cards: VideoCard[];
  /** 已加载到的尾部游标。**必须一起存** —— 否则缓存命中后「加载更多」会从第 1 页重来 */
  tailOffset: string | null;
}

/** 手动「加载更多」的页数选项 */
export const LOAD_MORE_OPTIONS = [1, 3, 5, 10];

/**
 * 动态流加载。
 *
 * 三种路径：
 *  1. **无缓存** → 完整加载：第一页秒出，再后台补齐到时间窗边界
 *  2. **有缓存** → 先把缓存铺上（刷新页面不白屏、不重拉），再**增量刷新**：
 *     从顶部往下抓，撞见已知条目就停。离开 1 小时通常只需 1 页
 *  3. **增量追不上**（离线太久）→ 退回完整加载
 */
export function useFeed(): FeedApi {
  const source = useMemo(() => new InPageDataSource(), []);

  const [cards, setCards] = useState<VideoCard[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [filling, setFilling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filledPages, setFilledPages] = useState(0);
  const [covered, setCovered] = useState(false);
  const [capReached, setCapReached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [windowHours, setWindowHours] = useState(24);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreProgress, setMoreProgress] = useState<MoreProgress | null>(null);

  const started = useRef(false);
  const tailOffset = useRef<string | null>(null);
  const cardsRef = useRef<VideoCard[]>([]);
  const hoursRef = useRef(windowHours);
  /** 加载代次：切换时间窗会启动新加载，旧的那次应丢弃自己的结果 */
  const gen = useRef(0);

  const applyCards = useCallback((next: VideoCard[]) => {
    cardsRef.current = next;
    setCards(next);
  }, []);

  const persistCache = useCallback((hours: number) => {
    // 卡片被截断时尾部游标已失去对应关系，存了会让「加载更多」跳过一段
    const truncated = cardsRef.current.length > MAX_CACHED_CARDS;
    writeJson(CACHE_KEY, {
      at: Date.now(),
      hours,
      cards: cardsRef.current.slice(0, MAX_CACHED_CARDS),
      tailOffset: truncated ? null : tailOffset.current,
    } satisfies FeedCache);
  }, []);

  /** 完整加载：第一页 → 后台补齐到窗口边界 */
  const fullLoad = useCallback(
    async (hours: number, myGen: number) => {
      setLoading(true);
      setCapReached(false);
      setFilledPages(0);
      setMoreProgress(null);
      tailOffset.current = null;

      const collected: VideoCard[] = [];
      const seen = new Set<string>();
      const push = (page: FeedPage) => {
        for (const c of page.items) {
          if (seen.has(c.bvid)) continue;
          seen.add(c.bvid);
          collected.push(c);
        }
        applyCards([...collected]);
      };

      try {
        const first = await source.fetchPage(null);
        if (myGen !== gen.current) return;
        push(first);
        setHasMore(first.hasMore);
        tailOffset.current = first.nextOffset;
        // 首屏已出，后续是后台补齐 —— 不能让 UI 一直显示"加载中"
        setLoading(false);

        if (hours === 0) {
          setCovered(true);
          persistCache(hours);
          return;
        }

        setFilling(true);
        const res = await fillToCutoff({
          fetchPage: (offset) => source.fetchPage(offset),
          startOffset: first.nextOffset,
          cutoffTs: cutoffFor(hours),
          maxPages: MAX_FILL_PAGES - 1,
          onPage: (p) => {
            if (myGen !== gen.current) return;
            push(p);
            setFilledPages((n) => n + 1);
            setHasMore(p.hasMore);
            tailOffset.current = p.nextOffset;
          },
          delayMs: PAGE_DELAY_MS,
          sleep,
        });

        if (myGen !== gen.current) return;
        setCovered(res.covered);
        setCapReached(res.stoppedBy === 'cap');
        persistCache(hours);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
        setFilling(false);
      }
    },
    [source, applyCards, persistCache],
  );

  /**
   * 增量刷新：从顶部往下抓，撞见已知条目即停。
   * 追到上限还没撞见（离线太久）就返回 false，由调用方退回完整加载。
   */
  const incremental = useCallback(
    async (cachedCards: VideoCard[], myGen: number): Promise<'merged' | 'fallback'> => {
      setRefreshing(true);
      let res: Awaited<ReturnType<typeof fetchNewer>>;
      try {
        res = await fetchNewer({
          fetchPage: (offset) => source.fetchPage(offset),
          known: new Set(cachedCards.map((c) => c.bvid)),
          maxPages: MAX_INCREMENTAL_PAGES,
          delayMs: PAGE_DELAY_MS,
          sleep,
        });
      } finally {
        setRefreshing(false);
      }

      if (myGen !== gen.current) return 'merged';
      // 没追上 = 缓存与新增之间有断层，必须整体重来，不能把两段接上
      if (!res.caughtUp) return 'fallback';

      if (res.fresh.length > 0) applyCards([...res.fresh, ...cardsRef.current]);
      persistCache(hoursRef.current);
      return 'merged';
    },
    [source, applyCards, persistCache],
  );

  const load = useCallback(
    async (hours: number, force: boolean) => {
      const myGen = ++gen.current;
      setError(null);

      if (!force) {
        const cached = readJson<FeedCache | null>(CACHE_KEY, null);
        if (cached && cached.hours === hours && Array.isArray(cached.cards) && cached.cards.length) {
          // ① 先把缓存铺上：刷新页面不白屏，也不重跑 10 页
          applyCards(cached.cards);
          tailOffset.current = cached.tailOffset ?? null;
          setCovered(true);
          setHasMore(true);
          setLoading(false);

          // ② 刚拉过就连增量都跳过，避免连续刷新打接口
          if (Date.now() - cached.at < FRESH_MS) return;

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

  const changeWindow = useCallback(
    (h: number) => {
      hoursRef.current = h;
      setWindowHours(h);
      void load(h, true); // 换窗口是明确操作，绕过缓存
    },
    [load],
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
        setLoadingMore(true);
        setMoreProgress({ done: 0, total: pages });
        setError(null);
        try {
          for (let i = 0; i < pages; i++) {
            const page = await source.fetchPage(tailOffset.current);

            const seen = new Set(cardsRef.current.map((c) => c.bvid));
            applyCards([...cardsRef.current, ...page.items.filter((c) => !seen.has(c.bvid))]);

            setHasMore(page.hasMore);
            tailOffset.current = page.nextOffset;
            setMoreProgress({ done: i + 1, total: pages });

            const exhausted = !page.hasMore || !page.nextOffset || page.oldestPubTs === 0;
            if (exhausted) break;
            if (i < pages - 1) await sleep(PAGE_DELAY_MS);
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

  return {
    cards,
    hasMore,
    loading,
    filling,
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
    refresh,
  };
}
