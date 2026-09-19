import type { FeedItem } from '../types';
import type { Group } from '../lib/localGroups';
import { PAGE_SIZE, clampPage } from '../lib/pagination';
import { useScrollToTopOnPage } from '../hooks/useScrollToTopOnPage';
import FeedGrid from './FeedGrid';
import Pager from './Pager';

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

/** 模式 2 专有的板块操作（「拉取更多」/「多看一条」/ 计数器） */
export interface UpPullApi {
  /** 该板块的 UP 总数 —— 计数器的分母 */
  upTotal: number;
  /** 其中已有缓存的 UP 数 —— 分子 */
  upCached: number;
  /** 其中已查过的 UP 数（含"查过但没内容"的）—— 用来解释分子为什么上不去 */
  upChecked: number;
  /** 当前层数，1-based */
  layer: number;
  /** 层数上限 */
  maxLayer: number;
  /** 正在批量拉取时的进度；没在拉就是 null */
  progress: { done: number; total: number } | null;
  /**
   * 上一次拉取的结果，显示在本板块**最底部**。
   *
   * 以前是一个固定在页面顶部的提示条 —— 但用户是盯着页面下方的板块看，
   * 根本看不到，所以改成挂在对应板块自己身上。
   */
  status: { text: string; resumable: boolean } | null;
  onPullMore: () => void;
  /** 请求在下一个 UP 边界停下（已拉到的保留） */
  onPause: () => void;
  onResume: () => void;
  onDismissStatus: () => void;
  onMoreLayer: () => void;
}

interface Props {
  group: Group;
  items: FeedItem[];
  readSet: Set<string>;
  lastVisit: number;
  collapsed: boolean;
  itemCountBeforeFilter: number;
  /** 本板块当前页码，1-based */
  page: number;
  move: MoveApi;
  onToggle: (groupId: string) => void;
  onOpen: (item: FeedItem) => void;
  onPageChange: (page: number) => void;
  /** 打开某个 UP 的分组菜单 */
  onPick: (upMid: number, el: HTMLElement) => void;
  /** 只有模式 2 会传 */
  upPull?: UpPullApi;
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
  items,
  readSet,
  lastVisit,
  collapsed,
  itemCountBeforeFilter,
  page,
  move,
  onToggle,
  onOpen,
  onPageChange,
  onPick,
  upPull,
}: Props) {
  const filteredOut = itemCountBeforeFilter - items.length;
  // 翻页后把本板块滚回顶部 —— 否则页数少的那一页会让板块变矮、视野跳到下一个板块
  const { ref, bump } = useScrollToTopOnPage<HTMLElement>();
  const current = clampPage(page, items.length, PAGE_SIZE);

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
            {items.length}
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

      {!collapsed && (
        <>
          {items.length === 0 ? (
            <div className="bff-section-empty">
              {itemCountBeforeFilter === 0
                ? upPull
                  ? '还没有拉取这个板块的内容'
                  : '这个分组最近没有更新'
                : '当前筛选下没有内容'}
            </div>
          ) : (
            <FeedGrid
              items={items}
              readSet={readSet}
              lastVisit={lastVisit}
              page={current}
              onOpen={onOpen}
              onPick={onPick}
            />
          )}

          {/*
           * 模式 2：两个按钮在**页码条上方**（用户明确要求）。
           * 「拉取更多」= 扩大 UP 覆盖；「多看一条」= 加深层数，后者不发任何请求。
           */}
          {upPull && (
            <div className="bff-upbar">
              {/*
               * 同一个按钮：没在拉时是「拉取更多」，拉取中变成「暂停」。
               * 关注多的人一个板块可能要拉几分钟，必须能停下来。
               */}
              <button
                type="button"
                className={`bff-upbar-go${upPull.progress ? ' is-busy' : ''}`}
                onClick={upPull.progress ? upPull.onPause : upPull.onPullMore}
                title={
                  upPull.progress
                    ? '在下一个 UP 之后停下（已拉到的内容会保留）'
                    : '把这个板块里还没拉过的 UP 拉一遍'
                }
              >
                {upPull.progress
                  ? `⏸ 暂停（${upPull.progress.done}/${upPull.progress.total}）`
                  : '⟳ 拉取更多'}
              </button>

              <span className="bff-upcount" title="分子是已经有内容的 UP 数，分母是这个板块的 UP 总数">
                已保存 {upPull.upCached} / {upPull.upTotal} 个 UP
                {upPull.upChecked > upPull.upCached && (
                  <span
                    className="bff-upempty"
                    title="这些 UP 的动态流里一条可显示的内容都没有（全是转发或直播推广位）"
                  >
                    （{upPull.upChecked - upPull.upCached} 个无内容）
                  </span>
                )}
              </span>

              <button
                type="button"
                className="bff-upbar-go"
                onClick={upPull.onMoreLayer}
                disabled={upPull.layer >= upPull.maxLayer}
                title={
                  upPull.layer >= upPull.maxLayer
                    ? `每个 UP 最多保留 ${upPull.maxLayer} 条`
                    : '每个 UP 多显示一条（读缓存，不发请求）'
                }
              >
                {upPull.layer >= upPull.maxLayer
                  ? '已全部显示'
                  : `⤓ 多看一条（${upPull.layer}/${upPull.maxLayer}）`}
              </button>
            </div>
          )}

          {items.length > 0 && (
            <Pager
              page={current}
              total={items.length}
              onChange={(p) => {
                onPageChange(p);
                bump();
              }}
            />
          )}
        </>
      )}

      {/*
       * 拉取结果挂在板块**最底部** —— 固定在页面顶部的提示，正在看下方板块的人根本看不到。
       * 放在折叠判断**之外**：板块收起时也该能看到上次拉取的结果。
       */}
      {upPull?.status && (
        <div className={`bff-upstatus${upPull.status.resumable ? ' is-paused' : ''}`}>
          <span className="bff-upstatus-text">{upPull.status.text}</span>
          {upPull.status.resumable && (
            <button type="button" className="bff-upbar-go" onClick={upPull.onResume}>
              继续
            </button>
          )}
          <button
            type="button"
            className="bff-upstatus-close"
            onClick={upPull.onDismissStatus}
            title="关闭"
          >
            ×
          </button>
        </div>
      )}
    </section>
  );
}
