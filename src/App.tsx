import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VideoCard } from './types';
import { useFeed } from './hooks/useFeed';
import { WINDOW_OPTIONS } from './lib/feedWindow';
import { useScrollToTopOnPage } from './hooks/useScrollToTopOnPage';
import { useFollowings } from './hooks/useFollowings';
import {
  acknowledgeDivergence,
  applyBatch,
  canUndoBatch,
  createGroup,
  deleteGroup,
  detectDivergence,
  loadGroups,
  loadMembership,
  mergeImport,
  pruneStale,
  renameGroup,
  reorderGroup,
  reorderGroups,
  resetAllDiverged,
  resetFromBilibili,
  seedFromBilibili,
  undoLastBatch,
  type BatchOp,
  type Group,
} from './lib/localGroups';
import { buildSections } from './lib/grouping';
import {
  loadRead,
  saveRead,
  markRead,
  markAllRead,
  loadLastVisit,
  saveLastVisit,
} from './lib/readState';
import { bffUsage } from './lib/storage';
import {
  loadCollapsed,
  saveCollapsed,
  toggleCollapsed,
  SECTION_COLLAPSED_KEY,
} from './lib/uiState';
import VideoGrid from './components/VideoGrid';
import GroupSection, { type MoveApi } from './components/GroupSection';
import Sidebar from './components/Sidebar';
import GroupPicker from './components/GroupPicker';
import GroupMenu from './components/GroupMenu';
import BatchBar from './components/BatchBar';
import LoadMoreBar from './components/LoadMoreBar';
import BatchGroupPanel from './components/BatchGroupPanel';
import { BILIBILI_HOME } from './lib/route';
import './styles.css';

type SortKey = 'latest' | 'play';
type FilterKey = 'all' | 'unread';
type ViewMode = 'grouped' | 'flat';

/** localStorage 的常见配额（Chrome 约 5 MB），仅用于「存储占用」展示 */
const QUOTA_BYTES = 5 * 1024 * 1024;
/** 平铺视图在页码表里的 key */
const FLAT_KEY = '__flat__';

export default function App() {
  const feed = useFeed();
  const followings = useFollowings();

  const [groups, setGroups] = useState<Group[]>(() => loadGroups());
  const [membership, setMembership] = useState<Record<string, string[]>>(() => loadMembership());
  /** 本地分组数据被改动过的计数 —— 用来让派生值（分歧、占用）重新计算 */
  const [dataVersion, setDataVersion] = useState(0);

  const [sort, setSort] = useState<SortKey>('latest');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [view, setView] = useState<ViewMode>('grouped');
  const [readSet, setReadSet] = useState<Set<string>>(() => loadRead());
  const [storageWarning, setStorageWarning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [batchActive, setBatchActive] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [canUndo, setCanUndo] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() =>
    loadCollapsed(SECTION_COLLAPSED_KEY),
  );
  const [picker, setPicker] = useState<{ mid: number; name: string; anchor: DOMRect } | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  /** 每个板块 / 平铺视图各自的页码，1-based。key 为 groupId（平铺用 FLAT_KEY） */
  const [pages, setPages] = useState<Record<string, number>>({});
  /** 正在被拖动的板块 id */
  const [dragId, setDragId] = useState<string | null>(null);
  /** 拖动悬停位置：落在哪个板块的上方还是下方 */
  const [dropEdge, setDropEdge] = useState<{ id: string; edge: 'before' | 'after' } | null>(null);

  const lastVisit = useRef(loadLastVisit()).current;
  const collapseSeeded = useRef(false);
  /** 平铺视图翻页后也要滚回顶部 */
  const flatScroll = useScrollToTopOnPage<HTMLDivElement>();

  const refreshLocal = useCallback(() => {
    setGroups(loadGroups());
    setMembership(loadMembership());
    setDataVersion((v) => v + 1);
  }, []);

  // 离开页面时记录访问时间，供下次标记「NEW」。
  // cleanup 必须返回 void —— saveLastVisit 返回 boolean（写入是否成功）。
  useEffect(
    () => () => {
      saveLastVisit(Date.now());
    },
    [],
  );

  // 关注列表拉完（可能刚做过首次导入）后刷新本地分组状态
  useEffect(() => {
    refreshLocal();
  }, [followings.lastSync, refreshLocal]);

  // ── 已读 ──────────────────────────────────────────────────────────────

  const onOpen = useCallback((card: VideoCard) => {
    setReadSet((prev) => {
      const next = markRead(prev, card.bvid);
      if (!saveRead(next)) setStorageWarning(true);
      return next;
    });
  }, []);

  const onMarkAllRead = useCallback(() => {
    setReadSet(() => {
      const next = markAllRead(feed.cards.map((c) => c.bvid));
      if (!saveRead(next)) setStorageWarning(true);
      return next;
    });
  }, [feed.cards]);

  // ── 排序与筛选 ────────────────────────────────────────────────────────

  const collator = useCallback(
    (a: VideoCard, b: VideoCard) => (sort === 'play' ? b.play - a.play : b.pubdate - a.pubdate),
    [sort],
  );

  const sortedAll = useMemo(() => [...feed.cards].sort(collator), [feed.cards, collator]);
  const visibleFlat = useMemo(
    () => (filter === 'unread' ? sortedAll.filter((c) => !readSet.has(c.bvid)) : sortedAll),
    [sortedAll, filter, readSet],
  );

  const sections = useMemo(
    () => buildSections(visibleFlat, groups, membership),
    [visibleFlat, groups, membership],
  );
  // 未经过滤的分区，用来告诉用户「这个板块被筛选掉了多少」
  const sectionTotals = useMemo(
    () =>
      new Map(
        buildSections(sortedAll, groups, membership).map((s) => [s.group.id, s.videos.length]),
      ),
    [sortedAll, groups, membership],
  );

  // ── 空板块默认折叠（只在首次拿到分区时做一次）─────────────────────────

  useEffect(() => {
    if (collapseSeeded.current || sections.length === 0) return;
    collapseSeeded.current = true;
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      for (const s of sections) if (s.videos.length === 0) next.add(s.group.id);
      saveCollapsed(SECTION_COLLAPSED_KEY, next);
      return next;
    });
  }, [sections]);

  const toggleSection = useCallback((id: string) => {
    setCollapsedSections((prev) => {
      const next = toggleCollapsed(prev, id);
      saveCollapsed(SECTION_COLLAPSED_KEY, next);
      return next;
    });
  }, []);

  const setPage = useCallback((key: string, page: number) => {
    setPages((prev) => ({ ...prev, [key]: page }));
  }, []);

  // ── 板块排序 ──────────────────────────────────────────────────────────

  const resetDrag = useCallback(() => {
    setDragId(null);
    setDropEdge(null);
  }, []);

  const moveSection = useCallback(
    (id: string, dir: -1 | 1) => {
      reorderGroup(id, dir);
      refreshLocal();
    },
    [refreshLocal],
  );

  /** 把正在拖的板块插到目标板块的前/后 */
  const dropSection = useCallback(
    (targetId: string, edge: 'before' | 'after') => {
      const dragging = dragId;
      resetDrag();
      if (!dragging || dragging === targetId) return;

      const ids = sections.map((s) => s.group.id);
      const without = ids.filter((id) => id !== dragging);
      let at = without.indexOf(targetId);
      if (at < 0) return;
      if (edge === 'after') at += 1;
      without.splice(at, 0, dragging);

      reorderGroups(without);
      refreshLocal();
    },
    [dragId, sections, resetDrag, refreshLocal],
  );

  const moveApiFor = useCallback(
    (id: string, index: number): MoveApi => ({
      onMove: (dir) => moveSection(id, dir),
      canMoveUp: index > 0,
      canMoveDown: index < sections.length - 1,
      dragging: dragId === id,
      dropEdge: dropEdge?.id === id ? dropEdge.edge : null,
      onDragStart: () => setDragId(id),
      onDragOver: (edge) => {
        if (dragId && dragId !== id) setDropEdge({ id, edge });
      },
      onDrop: () => {
        if (dropEdge && dropEdge.id === id) dropSection(id, dropEdge.edge);
        else resetDrag();
      },
      onDragEnd: resetDrag,
    }),
    [moveSection, sections.length, dragId, dropEdge, dropSection, resetDrag],
  );

  // 排序 / 筛选 / 时间窗变了之后，原来的页码指向的内容已经不是同一批，全部回到第 1 页
  useEffect(() => {
    setPages({});
  }, [sort, filter, feed.windowHours]);

  // ── 批量分类 ──────────────────────────────────────────────────────────

  const toggleBatch = useCallback(() => {
    setBatchActive((active) => {
      if (active) setSelected(new Set());
      return !active;
    });
  }, []);

  const toggleSelect = useCallback((mid: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(mid)) next.delete(mid);
      else next.add(mid);
      return next;
    });
  }, []);

  const selectMany = useCallback((mids: number[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const m of mids) {
        if (on) next.add(m);
        else next.delete(m);
      }
      return next;
    });
  }, []);

  const runBatch = useCallback(
    (op: BatchOp) => {
      const n = selected.size;
      if (n === 0) return;
      const ok = applyBatch([...selected], op);
      refreshLocal();
      setCanUndo(canUndoBatch());
      setLastAction(`已应用到 ${n} 个 UP`);
      if (!ok) setStorageWarning(true);
    },
    [selected, refreshLocal],
  );

  const undoBatch = useCallback(() => {
    if (!undoLastBatch()) return;
    refreshLocal();
    setCanUndo(false);
    setLastAction(null);
  }, [refreshLocal]);

  // ── 单个 UP 的分组菜单 ────────────────────────────────────────────────

  const pickFor = useCallback(
    (mid: number, el: HTMLElement) => {
      const u = followings.list.find((x) => x.mid === mid);
      setPicker({ mid, name: u?.uname ?? `UP ${mid}`, anchor: el.getBoundingClientRect() });
    },
    [followings.list],
  );

  const toggleUpGroup = useCallback(
    (gid: string) => {
      if (!picker) return;
      const cur = loadMembership()[String(picker.mid)] ?? [];
      applyBatch([picker.mid], {
        type: cur.includes(gid) ? 'remove' : 'add',
        groupId: gid,
      });
      refreshLocal();
    },
    [picker, refreshLocal],
  );

  const clearUpGroups = useCallback(() => {
    if (!picker) return;
    applyBatch([picker.mid], { type: 'clear' });
    refreshLocal();
    setPicker(null);
  }, [picker, refreshLocal]);

  const resetUp = useCallback(() => {
    if (!picker) return;
    resetFromBilibili(picker.mid, followings.list);
    refreshLocal();
    setPicker(null);
  }, [picker, followings.list, refreshLocal]);

  // ── 分歧的批量处理 ────────────────────────────────────────────────────

  const alignDiverged = useCallback(() => {
    const n = resetAllDiverged(followings.list);
    refreshLocal();
    setNotice(`已按 B站 对齐 ${n} 个 UP 的分组`);
  }, [followings.list, refreshLocal]);

  const keepLocalClasses = useCallback(() => {
    const n = acknowledgeDivergence(followings.list);
    refreshLocal();
    setNotice(`已保留你的分类，不再提示这 ${n} 项`);
  }, [followings.list, refreshLocal]);

  // ── 分组管理 ──────────────────────────────────────────────────────────

  const newGroup = useCallback(
    (name: string) => {
      if (!createGroup(name)) setNotice('分组名重复、为空、或超过 16 字');
      refreshLocal();
    },
    [refreshLocal],
  );

  const renameG = useCallback(
    (id: string, name: string) => {
      if (!renameGroup(id, name)) setNotice('重命名失败：名称重复、为空、或超过 16 字');
      refreshLocal();
    },
    [refreshLocal],
  );

  const deleteG = useCallback(
    (g: Group) => {
      const n = followings.list.filter((u) => (membership[String(u.mid)] ?? []).includes(g.id)).length;
      const ok = window.confirm(
        `删除分组「${g.name}」？\n\n组内 ${n} 个 UP 会回到「未分类」。\n这只会改动本页的分类，你的 B站 账号不受影响。`,
      );
      if (!ok) return;
      deleteGroup(g.id);
      refreshLocal();
    },
    [followings.list, membership, refreshLocal],
  );

  const reorderG = useCallback(
    (id: string, dir: -1 | 1) => {
      reorderGroup(id, dir);
      refreshLocal();
    },
    [refreshLocal],
  );

  const forceOverwrite = useCallback(() => {
    const ok = window.confirm(
      '这会用 B站 当前的分组重建全部本地分类。\n\n你在本页做过的所有分类都会丢失（B站 账号不受影响）。确定继续？',
    );
    if (!ok) return;
    seedFromBilibili(followings.tags, followings.list);
    refreshLocal();
    setMenuAnchor(null);
  }, [followings.tags, followings.list, refreshLocal]);

  const mergeNow = useCallback(() => {
    const { added, adopted } = mergeImport(followings.tags, followings.list);
    refreshLocal();
    const parts: string[] = [];
    if (added > 0) parts.push(`已为 ${added} 个未分类 UP 补充分组`);
    if (adopted.length > 0) parts.push(`B站 的同名分组已并入本地：${adopted.join('、')}`);
    setNotice(parts.length > 0 ? parts.join('；') : '没有需要补充的 UP');
  }, [followings.tags, followings.list, refreshLocal]);

  const cleanup = useCallback(() => {
    const freed = pruneStale(followings.list);
    if (!saveRead(new Set())) setStorageWarning(true);
    refreshLocal();
    setNotice(`已清理历史数据，释放约 ${(freed / 1024).toFixed(1)} KB`);
  }, [followings.list, refreshLocal]);

  // ── 派生值 ────────────────────────────────────────────────────────────

  const diverged = useMemo(
    () => detectDivergence(followings.list),
    // dataVersion 让重置/导入之后重新计算
    [followings.list, dataVersion],
  );

  const usage = useMemo(() => bffUsage(), [dataVersion, readSet, membership]);

  /** 选中的 UP **已全部在**里面的分组 —— 面板上这些图标会显示为已完成 */
  const allContained = useMemo(() => {
    const ids = [...selected];
    const out = new Set<string>();
    if (ids.length === 0) return out;
    for (const g of groups) {
      if (ids.every((mid) => (membership[String(mid)] ?? []).includes(g.id))) out.add(g.id);
    }
    return out;
  }, [groups, membership, selected]);

  /** 选中的 UP 是否都还没有任何分组（即都处于未分类） */
  const allUncategorized = useMemo(() => {
    const ids = [...selected];
    return ids.length > 0 && ids.every((mid) => (membership[String(mid)] ?? []).length === 0);
  }, [membership, selected]);

  return (
    <div className="bff-root">
      <Sidebar
        groups={groups}
        membership={membership}
        followings={followings.list}
        loading={followings.loading}
        error={followings.error}
        lastSync={followings.lastSync}
        fromCache={followings.fromCache}
        batchActive={batchActive}
        selected={selected}
        diverged={diverged}
        onToggleBatch={toggleBatch}
        onToggleSelect={toggleSelect}
        onSelectMany={selectMany}
        onPick={pickFor}
        onRefresh={followings.refresh}
        onMergeImport={mergeNow}
        onOpenGroupMenu={(el) => setMenuAnchor(el.getBoundingClientRect())}
      />

      <main className={`bff-main${batchActive ? ' is-batch' : ''}`}>
        {/* 工具条与批量面板一起吸顶，保证选 UP 时两者都看得见 */}
        <div className="bff-sticky-head">
        <div className="bff-bar">
          <strong>只看关注</strong>

          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="latest">最新发布</option>
            <option value="play">播放量最高</option>
          </select>

          <select value={filter} onChange={(e) => setFilter(e.target.value as FilterKey)}>
            <option value="all">全部</option>
            <option value="unread">未读</option>
          </select>

          <select value={view} onChange={(e) => setView(e.target.value as ViewMode)}>
            <option value="grouped">分组视图</option>
            <option value="flat">平铺视图</option>
          </select>

          <select
            value={feed.windowHours}
            onChange={(e) => feed.setWindowHours(Number(e.target.value))}
            disabled={feed.loading}
            title="翻页加载到覆盖多久之前的内容。翻页越多越慢，但分组板块越完整"
          >
            {WINDOW_OPTIONS.map((o) => (
              <option key={o.hours} value={o.hours}>
                {o.hours === 0 ? '仅加载首页' : `加载到 ${o.label}前`}
              </option>
            ))}
          </select>

          <button type="button" onClick={onMarkAllRead} disabled={feed.cards.length === 0}>
            全部标记已读
          </button>
          <button type="button" onClick={feed.refresh} disabled={feed.loading || feed.filling}>
            刷新
          </button>

          <span className="bff-count">
            {visibleFlat.length} / {feed.cards.length}
          </span>

          <a className="bff-back" href={BILIBILI_HOME}>
            返回 B站
          </a>
        </div>

        {batchActive && (
          <BatchGroupPanel
            groups={groups}
            selectedCount={selected.size}
            allContained={allContained}
            allUncategorized={allUncategorized}
            onAdd={(gid) => runBatch({ type: 'add', groupId: gid })}
            onClearAll={() => runBatch({ type: 'clear' })}
          />
        )}
        </div>

        {diverged.size > 0 && (
          <div className="bff-diverge-bar">
            <span>
              有 <strong>{diverged.size}</strong> 个 UP 的 B站 分组已变更（右侧有 ↻，点它可单独处理）
            </span>
            <button type="button" onClick={alignDiverged}>
              全部按 B站 对齐
            </button>
            <button type="button" onClick={keepLocalClasses}>
              保持我的分类
            </button>
          </div>
        )}

        {feed.filling && (
          <div className="bff-filling">
            正在补齐更早的内容… 已翻 {feed.filledPages} 页 / 累计 {feed.cards.length} 条
            <span className="bff-filling-hint">（可以先用，内容会陆续补上）</span>
          </div>
        )}

        {feed.capReached && !feed.filling && (
          <div className="bff-filling bff-capped">
            已加载 {feed.cards.length} 条，达到翻页上限仍未覆盖所选时间窗。想看得更早请用底部的「加载更多」。
          </div>
        )}

        {storageWarning && (
          <div className="bff-warn">
            本地存储写入失败，已读状态与分组可能不会被保存。
            <button type="button" onClick={() => setStorageWarning(false)}>
              知道了
            </button>
          </div>
        )}

        {notice && (
          <div className="bff-notice">
            {notice}
            <button type="button" onClick={() => setNotice(null)}>
              ×
            </button>
          </div>
        )}

        {feed.error && <div className="bff-empty">接口出错：{feed.error}</div>}

        {!feed.error && view === 'flat' && (
          <div ref={flatScroll.ref}>
            <VideoGrid
              cards={visibleFlat}
              readSet={readSet}
              lastVisit={lastVisit}
              onOpen={onOpen}
              page={pages[FLAT_KEY] ?? 1}
              onPageChange={(p) => {
                setPage(FLAT_KEY, p);
                flatScroll.bump();
              }}
            />
          </div>
        )}

        {!feed.error &&
          view === 'grouped' &&
          sections.map((s, idx) => (
            <GroupSection
              key={s.group.id}
              group={s.group}
              videos={s.videos}
              readSet={readSet}
              lastVisit={lastVisit}
              collapsed={collapsedSections.has(s.group.id)}
              videoCountBeforeFilter={sectionTotals.get(s.group.id) ?? 0}
              page={pages[s.group.id] ?? 1}
              move={moveApiFor(s.group.id, idx)}
              onToggle={toggleSection}
              onOpen={onOpen}
              onPageChange={(p) => setPage(s.group.id, p)}
            />
          ))}

      </main>

      <LoadMoreBar
        loaded={feed.cards.length}
        hasMore={feed.hasMore}
        busy={feed.loading || feed.filling || feed.loadingMore}
        progress={feed.moreProgress}
        refreshing={feed.refreshing}
        raised={batchActive}
        onLoad={feed.loadMore}
      />

      {batchActive && (
        <BatchBar
          count={selected.size}
          groups={groups}
          canUndo={canUndo}
          lastAction={lastAction}
          onApply={runBatch}
          onUndo={undoBatch}
          onClearSelection={() => setSelected(new Set())}
          onExit={toggleBatch}
        />
      )}

      {picker && (
        <GroupPicker
          upName={picker.name}
          groups={groups}
          current={membership[String(picker.mid)] ?? []}
          diverged={diverged.has(picker.mid)}
          anchor={picker.anchor}
          onToggle={toggleUpGroup}
          onClear={clearUpGroups}
          onReset={resetUp}
          onCreate={newGroup}
          onClose={() => setPicker(null)}
        />
      )}

      {menuAnchor && (
        <GroupMenu
          anchor={menuAnchor}
          groups={groups}
          usage={usage}
          quotaBytes={QUOTA_BYTES}
          onNewGroup={newGroup}
          onRename={renameG}
          onDelete={deleteG}
          onReorder={reorderG}
          onForceOverwrite={forceOverwrite}
          onCleanup={cleanup}
          onClose={() => setMenuAnchor(null)}
        />
      )}
    </div>
  );
}
