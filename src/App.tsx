import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VideoCard } from './types';
import { InPageDataSource } from './data/inPage';
import {
  loadRead,
  saveRead,
  markRead,
  markAllRead,
  loadLastVisit,
  saveLastVisit,
} from './lib/readState';
import VideoGrid from './components/VideoGrid';
import { BILIBILI_HOME } from './lib/route';
import './styles.css';

type SortKey = 'latest' | 'play';
type FilterKey = 'all' | 'unread';

export default function App() {
  const source = useMemo(() => new InPageDataSource(), []);

  const [cards, setCards] = useState<VideoCard[]>([]);
  const [offset, setOffset] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('latest');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [readSet, setReadSet] = useState<Set<string>>(() => loadRead());

  const lastVisit = useRef(loadLastVisit()).current;
  const initialised = useRef(false);

  const loadMore = useCallback(
    async (reset: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const page = await source.fetchPage(reset ? null : offset);
        setCards(prev => {
          const merged = reset ? page.items : [...prev, ...page.items];
          // 动态流翻页可能重复返回同一条，按 bvid 去重
          const seen = new Set<string>();
          return merged.filter(c => (seen.has(c.bvid) ? false : (seen.add(c.bvid), true)));
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

  // 首次拉取。用 ref 挡住 React StrictMode 的二次执行，避免重复请求。
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    void loadMore(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 离开页面时记录访问时间，供下次标记「NEW」。
  // 注意 cleanup 必须返回 void —— saveLastVisit 现在返回 boolean（写入是否成功），
  // 直接简写会让 cleanup 变成 () => boolean，React 的类型不接受。
  useEffect(
    () => () => {
      saveLastVisit(Date.now());
    },
    [],
  );

  const onOpen = useCallback((card: VideoCard) => {
    setReadSet(prev => {
      const next = markRead(prev, card.bvid);
      saveRead(next);
      return next;
    });
  }, []);

  const onMarkAllRead = useCallback(() => {
    setReadSet(() => {
      const next = markAllRead(cards.map(c => c.bvid));
      saveRead(next);
      return next;
    });
  }, [cards]);

  const visible = useMemo(() => {
    const list = filter === 'unread' ? cards.filter(c => !readSet.has(c.bvid)) : cards.slice();
    list.sort((a, b) => (sort === 'play' ? b.play - a.play : b.pubdate - a.pubdate));
    return list;
  }, [cards, filter, readSet, sort]);

  return (
    <div className="bff-root">
      <div className="bff-bar">
        <strong>只看关注</strong>

        <select value={sort} onChange={e => setSort(e.target.value as SortKey)}>
          <option value="latest">最新发布</option>
          <option value="play">播放量最高</option>
        </select>

        <select value={filter} onChange={e => setFilter(e.target.value as FilterKey)}>
          <option value="all">全部</option>
          <option value="unread">未读</option>
        </select>

        <button type="button" onClick={onMarkAllRead} disabled={cards.length === 0}>
          全部标记已读
        </button>
        <button type="button" onClick={() => void loadMore(true)} disabled={loading}>
          刷新
        </button>

        <span className="bff-count">
          {visible.length} / {cards.length}
        </span>

        {/* 我们接管后隐藏了整个 body，B站 404 页上的导航也没了，
            所以必须自己提供一个出口 */}
        <a className="bff-back" href={BILIBILI_HOME}>
          返回 B站
        </a>
      </div>

      {error && <div className="bff-empty">接口出错：{error}</div>}

      {!error && (
        <VideoGrid cards={visible} readSet={readSet} lastVisit={lastVisit} onOpen={onOpen} />
      )}

      {!error && hasMore && (
        <div className="bff-more">
          <button type="button" onClick={() => void loadMore(false)} disabled={loading}>
            {loading ? '加载中…' : '加载更多'}
          </button>
        </div>
      )}
    </div>
  );
}
