import type { VideoCard } from '../types';
import type { Group } from '../lib/localGroups';
import { useScrollToTopOnPage } from '../hooks/useScrollToTopOnPage';
import VideoGrid from './VideoGrid';

interface Props {
  group: Group;
  videos: VideoCard[];
  readSet: Set<string>;
  lastVisit: number;
  collapsed: boolean;
  videoCountBeforeFilter: number;
  /** 本板块当前页码，1-based */
  page: number;
  onToggle: (groupId: string) => void;
  onOpen: (card: VideoCard) => void;
  onPageChange: (page: number) => void;
}

/**
 * 一个分组板块。标题左端是 `+`/`−` 折叠按钮。
 *
 * 空板块**不隐藏** —— 直接过滤掉会让用户以为分组丢了。显示明确占位即可，
 * 折叠状态由上层持久化（空板块默认折叠，见 App 的初始化逻辑）。
 *
 * 分页状态与折叠状态一样由上层持有：板块只是展示，不自己记状态。
 */
export default function GroupSection({
  group,
  videos,
  readSet,
  lastVisit,
  collapsed,
  videoCountBeforeFilter,
  page,
  onToggle,
  onOpen,
  onPageChange,
}: Props) {
  const filteredOut = videoCountBeforeFilter - videos.length;
  // 翻页后把本板块滚回顶部 —— 否则页数少的那一页会让板块变矮、视野跳到下一个板块
  const { ref, bump } = useScrollToTopOnPage<HTMLElement>();

  return (
    <section className="bff-section" ref={ref}>
      <button
        type="button"
        className="bff-section-head"
        onClick={() => onToggle(group.id)}
        aria-expanded={!collapsed}
        title={collapsed ? '展开' : '折叠'}
      >
        <span className="bff-fold">{collapsed ? '+' : '−'}</span>
        <span className="bff-section-name">{group.name}</span>
        <span className="bff-section-count">
          {videos.length}
          {filteredOut > 0 && <span className="bff-section-hidden">（已筛掉 {filteredOut}）</span>}
        </span>
      </button>

      {!collapsed &&
        (videos.length === 0 ? (
          <div className="bff-section-empty">
            {videoCountBeforeFilter === 0 ? '这个分组最近没有更新' : '当前筛选下没有内容'}
          </div>
        ) : (
          <VideoGrid
            cards={videos}
            readSet={readSet}
            lastVisit={lastVisit}
            page={page}
            onPageChange={(p) => {
              onPageChange(p);
              bump();
            }}
            onOpen={onOpen}
          />
        ))}
    </section>
  );
}
