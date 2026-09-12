import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VideoCard } from '../types';
import { InPageDataSource } from '../data/inPage';

export interface FeedApi {
  cards: VideoCard[];
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  loadMore: (reset: boolean) => void;
}

/** 动态流的分页加载。翻页可能重复返回同一条，按 bvid 去重。 */
export function useFeed(): FeedApi {
  const source = useMemo(() => new InPageDataSource(), []);
  const [cards, setCards] = useState<VideoCard[]>([]);
  const [offset, setOffset] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const loadMore = useCallback(
    async (reset: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const page = await source.fetchPage(reset ? null : offset);
        setCards((prev) => {
          const merged = reset ? page.items : [...prev, ...page.items];
          const seen = new Set<string>();
          return merged.filter((c) => (seen.has(c.bvid) ? false : (seen.add(c.bvid), true)));
        });
        setOffset(page.nextOffset);
        setHasMore(page.hasMore);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [source, offset],
  );

  useEffect(() => {
    // 挡住 React StrictMode 的二次执行
    if (started.current) return;
    started.current = true;
    void loadMore(true);
  }, [loadMore]);

  return {
    cards,
    hasMore,
    loading,
    error,
    loadMore: (reset: boolean) => void loadMore(reset),
  };
}
