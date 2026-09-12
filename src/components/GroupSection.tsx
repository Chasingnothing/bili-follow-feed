import type { VideoCard } from '../types';
import type { Group } from '../lib/localGroups';
import { useScrollToTopOnPage } from '../hooks/useScrollToTopOnPage';
import VideoGrid from './VideoGrid';

export interface MoveApi {
  onMove: (dir: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** 本节正在被拖动 */
  dragging: boolean;
  /** 放置提示：'before' 落在本节上方，'after' 落在下方 */
  dropEdge: 'before' | 'after' | null;
  onDragStart: () => void;
  onDragOver: (edge: 'before' | 'after') => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

interface Props {
  group: Group;
  videos: VideoCard[];
  readSet: Set<string>;
  lastVisit: number;
  collapsed: boolean;
  videoCountBeforeFilter: number;
  /** 本板块当前页码，1-based */
  page: number;
  move: MoveApi;
  onToggle: (groupId: string) => void;
  onOpen: (card: VideoCard) => void;
  onPageChange: (page: number) => void;
  /** 打开某个 UP 的分组菜单 */
  onPick: (upMid: number, el: HTMLElement) => void;
}

/**
 * 一个分组板块。标题左端是 `+`/`−` 折叠按钮，右端是排序控件。
 *
 * 标题**不能是 `<button>`** —— 里面还要放拖动柄和 ↑/↓ 按钮，按钮套按钮是非法
 * HTML，浏览器会把内层拆掉（和卡片上 `<a>` 嵌 `<a>` 是同一类问题）。
 * 所以标题是 `<div>`，折叠改用内部的 `<button class="bff-section-toggle">`。
 *
 * 空板块**不隐藏** —— 直接过滤掉会让用户以为分组丢了。
 */
export default function GroupSection({
  group,
  videos,
  readSet,
  lastVisit,
  collapsed,
  videoCountBeforeFilter,
  page,
  move,
  onToggle,
  onOpen,
  onPageChange,
  onPick,
}: Props) {
  const filteredOut = videoCountBeforeFilter - videos.length;
  // 翻页后把本板块滚回顶部 —— 否则页数少的那一页会让板块变矮、视野跳到下一个板块
  const { ref, bump } = useScrollToTopOnPage<HTMLElement>();

  const sectionClass = [
    'bff-section',
    move.dragging ? 'is-dragging' : '',
    move.dropEdge ? `drop-${move.dropEdge}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section
      className={sectionClass}
      ref={ref}
      /*
       * 落点必须挂在**整个 section** 上。之前只挂在标题那条（约 40px），
       * 而板块有几百上千像素高 —— 拖到板块中间（95% 的面积）根本不算落点，
       * 被判成"板块外"而取消，用户会觉得是自己手不准。
       */
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const r = e.currentTarget.getBoundingClientRect();
        const ratio = (e.clientY - r.top) / Math.max(1, r.height);
        // 中线附近留死区：否则在分界线上轻微移动会让指示线来回闪
        const edge =
          ratio < 0.44
            ? 'before'
            : ratio > 0.56
              ? 'after'
              : (move.dropEdge ?? (ratio < 0.5 ? 'before' : 'after'));
        move.onDragOver(edge);
      }}
      onDrop={(e) => {
        e.preventDefault();
        move.onDrop();
      }}
    >
      <div className="bff-section-head">
        <button
          type="button"
          className="bff-section-toggle"
          onClick={() => onToggle(group.id)}
          aria-expanded={!collapsed}
          title={collapsed ? '展开' : '折叠'}
        >
          <span className="bff-fold">{collapsed ? '+' : '−'}</span>
          <span className="bff-section-name">{group.name}</span>
          <span className="bff-section-count">
            {videos.length}
            {filteredOut > 0 && (
              <span className="bff-section-hidden">（已筛掉 {filteredOut}）</span>
            )}
          </span>
        </button>

        <span
          className="bff-drag"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            move.onDragStart();
          }}
          onDragEnd={move.onDragEnd}
          title="拖动调整板块顺序"
        >
          ⠿
        </span>

        <button
          type="button"
          className="bff-mv"
          onClick={() => move.onMove(-1)}
          disabled={!move.canMoveUp}
          title="上移一位"
        >
          ↑
        </button>
        <button
          type="button"
          className="bff-mv"
          onClick={() => move.onMove(1)}
          disabled={!move.canMoveDown}
          title="下移一位"
        >
          ↓
        </button>
      </div>

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
            onPick={onPick}
          />
        ))}
    </section>
  );
}
