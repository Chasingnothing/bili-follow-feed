import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeedPage, VideoCard } from '../types';
import { InPageDataSource } from '../data/inPage';
import { cutoffFor, fillToCutoff } from '../lib/feedWindow';
import { readJson, writeJson } from '../lib/storage';

/** 页与页之间的等待：探针实测 30 页 / 400ms 可稳定跑完 */
const PAGE_DELAY_MS = 400;
/** 自动补齐的翻页上限。实测 30 页≈3 天，40 页留余量 */
const MAX_FILL_PAGES = 40;
const CACHE_KEY = 'bff:feedCache';
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHED_CARDS = 400;

export interface MoreProgress {
  done: number;
  total: number;
}

export interface FeedApi {
  cards: VideoCard[];
  hasMore: boolean;
  /** 首屏加载中 */
  loading: boolean;
  /** 后台自动补齐时间窗中 */
  filling: boolean;
  filledPages: number;
  covered: boolean;
  /** 撞上翻页上限而停（窗口未覆盖全） */
  capReached: boolean;
  error: string | null;
  windowHours: number;
  setWindowHours: (h: number) => void;
  /** 手动继续往下翻 pages 页 */
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
}

/** 手动「加载更多」的页数选项 */
export const LOAD_MORE_OPTIONS = [1, 3, 5, 10];

/**
 * 动态流加载。
 *
 * 两段式：**第一页先渲染**（秒开），再后台翻页补齐到时间窗边界；
 * 超出窗口之后由用户手动「加载更多」按页续接。
 */
export function useFeed(): FeedApi {
  const source = useMemo(() => new InPageDataSource(), []);

  const [cards, setCards] = useState<VideoCard[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [filling, setFilling] = useState(false);
  const [filledPages, setFilledPages] = useState(0);
  const [covered, setCovered] = useState(false);
  const [capReached, setCapReached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [windowHours, setWindowHours] = useState(24);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreProgress, setMoreProgress] = useState<MoreProgress | null>(null);

  const started = useRef(false);
  /** 已加载到的尾部游标，供续接翻页 */
  const tailOffset = useRef<string | null>(null);
  /** 与 cards 同步的镜像，便于在异步流程里读写当前全集 */
  const cardsRef = useRef<VideoCard[]>([]);
  const hoursRef = useRef(windowHours);
  /** 加载代次：切换时间窗会启动新加载，旧的那次应丢弃自己的结果 */
  const gen = useRef(0);

  const applyCards = useCallback((next: VideoCard[]) => {
    cardsRef.current = next;
    setCards(next);
  }, []);

  const persistCache = useCallback((hours: number) => {
    writeJson(CACHE_KEY, {
      at: Date.now(),
      hours,
      cards: cardsRef.current.slice(0, MAX_CACHED_CARDS),
    } satisfies FeedCache);
  }, []);

  const load = useCallback(
    async (hours: number, force: boolean) => {
      const myGen = ++gen.current;
      setLoading(true);
      setError(null);
      setCapReached(false);
      setFilledPages(0);
      setMoreProgress(null);
      tailOffset.current = null;

      if (!force) {
        const cached = readJson<FeedCache | null>(CACHE_KEY, null);
        if (cached && cached.hours === hours && Date.now() - cached.at < CACHE_TTL_MS) {
          applyCards(cached.cards);
          setCovered(true);
          setHasMore(true);
          setLoading(false);
          return;
        }
      }

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
        // ── 第一页：尽快出内容 ──
        const first = await source.fetchPage(null);
        if (myGen !== gen.current) return;
        push(first);
        setHasMore(first.hasMore);
        tailOffset.current = first.nextOffset;
        // 首屏已出，后续是后台补齐 —— 不能让 UI 一直显示"加载中"
        setLoading(false);

        if (hours === 0) {
          setCovered(true);
          return;
        }

        // ── 后台补齐到窗口边界 ──
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
          // 进度保留一小会儿再清，避免闪一下就没了
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
