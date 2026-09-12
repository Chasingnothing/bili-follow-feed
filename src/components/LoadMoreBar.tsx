import { LOAD_MORE_OPTIONS, type MoreProgress } from '../hooks/useFeed';

interface Props {
  loaded: number;
  hasMore: boolean;
  busy: boolean;
  progress: MoreProgress | null;
  /** 批量操作条出现时上移让位，避免两个浮动条叠在一起 */
  raised: boolean;
  onLoad: (pages: number) => void;
}

/**
 * 右下角的悬浮「加载更多」。
 *
 * 之前它固定在整个页面的末尾，看别的板块时想加载就得先滚到底 —— 现在浮在视口上，
 * 任何位置都能点。
 *
 * 用 select 而不是「按钮 + 次数选择」两步：选完即加载，少一次点击。
 */
export default function LoadMoreBar({ loaded, hasMore, busy, progress, raised, onLoad }: Props) {
  if (!hasMore && !progress) return null;

  return (
    <div className={`bff-loadmore${raised ? ' bff-loadmore--raised' : ''}`}>
      <span className="bff-loadmore-count">已加载 {loaded} 条</span>

      {progress ? (
        <span className="bff-loadmore-progress">
          加载中 {progress.done}/{progress.total} 页…
        </span>
      ) : (
        <select
          value=""
          disabled={busy}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (n > 0) onLoad(n);
          }}
          title="继续往下翻几页"
        >
          <option value="">加载更多 ▾</option>
          {LOAD_MORE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              再加载 {n} 页
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
