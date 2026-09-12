import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeedPage, VideoCard } from '../types';
import { InPageDataSource } from '../data/inPage';
import { cutoffFor, fillToCutoff } from '../lib/feedWindow';
import { readJson, writeJson } from '../lib/storage';

/** 页与页之间的等待：探针实测 30 页 / 400ms 可稳定跑完 */
const PAGE_DELAY_MS = 400;
/** 翻页上限。实测 30 页≈3 天，40 页留一点余量 */
const MAX_FILL_PAGES = 40;
const CACHE_KEY = 'bff:feedCache';
/** 缓存新鲜期：避免你连续刷新几次就重复翻 10 页 */
const CACHE_TTL_MS = 10 * 60 * 1000;
/** 缓存里最多留多少张卡片，防止 localStorage 被撑大 */
const MAX_CACHED_CARDS = 400;

export interface FeedApi {
  cards: VideoCard[];
  hasMore: boolean;
  /** 首屏或手动刷新中 */
  loading: boolean;
  /** 后台补齐时间窗中 */
  filling: boolean;
  filledPages: number;
  /** 是否已覆盖到窗口边界 */
  covered: boolean;
  /** 是撞上页数上限而停的（说明窗口没覆盖全） */
  capReached: boolean;
  error: string | null;
  windowHours: number;
  setWindowHours: (h: number) => void;
  loadMore: () => void;
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

/**
 * 动态流加载。
 *
 * 两段式：**第一页先渲染**（秒开），然后再后台翻页补齐到时间窗边界。
 * 这样绝不会让你白等 7 秒才看到第一屏。
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

  const started = useRef(false);
  /** 已加载到的尾部游标，供「加载更多」续接。放 ref 而不是 localStorage —— 它是会话内状态 */
  const tailOffset = useRef<string | null>(null);
  /**
   * 加载代次。用户中途切换时间窗会启动新的加载，旧的那次可能还在翻页 ——
   * 每次 await 之后核对代次，过期的直接丢弃，避免两批数据交错追加。
   */
  const gen = useRef(0);

  const load = useCallback(
    async (hours: number, force: boolean) => {
      const myGen = ++gen.current;
      setLoading(true);
      setError(null);
      setCapReached(false);
      setFilledPages(0);
      tailOffset.current = null;

      // 命中缓存就不用重新翻页
      if (!force) {
        const cached = readJson<FeedCache | null>(CACHE_KEY, null);
        if (cached && cached.hours === hours && Date.now() - cached.at < CACHE_TTL_MS) {
          setCards(cached.cards);
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
        setCards([...collected]);
      };

      try {
        // ── 第一页：尽快出内容 ──
        const first = await source.fetchPage(null);
        if (myGen !== gen.current) return;
        push(first);
        setHasMore(first.hasMore);
        tailOffset.current = first.nextOffset;
        // 首屏已经出来了，后续是后台补齐 —— 不能让 UI 一直处于"加载中"
        setLoading(false);

        if (hours === 0) {
          setCovered(true);
          return;
        }

        // ── 后台补齐到窗口边界 ──
        setFilling(true);
        const cutoff = cutoffFor(hours);
        const res = await fillToCutoff({
          fetchPage: (offset) => source.fetchPage(offset),
          startOffset: first.nextOffset,
          cutoffTs: cutoff,
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

        writeJson(CACHE_KEY, {
          at: Date.now(),
          hours,
          cards: collected.slice(0, MAX_CACHED_CARDS),
        } satisfies FeedCache);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
        setFilling(false);
      }
    },
    [source],
  );

  useEffect(() => {
    if (started.current) return; // 挡住 React StrictMode 的二次执行
    started.current = true;
    void load(windowHours, false);
    // 只在挂载时跑一次；windowHours 的变化由 setWindowHours 自己触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const changeWindow = useCallback(
    (h: number) => {
      setWindowHours(h);
      void load(h, true); // 换窗口是明确的操作，绕过缓存
    },
    [load],
  );

  const refresh = useCallback(() => {
    void load(windowHours, true);
  }, [load, windowHours]);

  /** 继续往下翻一页（超出时间窗之后的手动加载） */
  const loadMore = useCallback(() => {
    void (async () => {
      setLoading(true);
      try {
        const page = await source.fetchPage(tailOffset.current);
        setCards((prev) => {
          const seen = new Set(prev.map((c) => c.bvid));
          return [...prev, ...page.items.filter((c) => !seen.has(c.bvid))];
        });
        setHasMore(page.hasMore);
        tailOffset.current = page.nextOffset;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [source]);

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
    refresh,
  };
}
