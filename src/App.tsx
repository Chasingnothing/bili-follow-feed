import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VideoCard } from './types';
import { useFeed } from './hooks/useFeed';
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
import GroupSection from './components/GroupSection';
import Sidebar from './components/Sidebar';
import GroupPicker from './components/GroupPicker';
import GroupMenu from './components/GroupMenu';
import BatchBar from './components/BatchBar';
import { BILIBILI_HOME } from './lib/route';
import './styles.css';

type SortKey = 'latest' | 'play';
type FilterKey = 'all' | 'unread';
type ViewMode = 'grouped' | 'flat';

/** localStorage 的常见配额（Chrome 约 5 MB），仅用于「存储占用」展示 */
const QUOTA_BYTES = 5 * 1024 * 1024;

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

  const lastVisit = useRef(loadLastVisit()).current;
  const collapseSeeded = useRef(false);

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

      <main className="bff-main">
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

          <button type="button" onClick={onMarkAllRead} disabled={feed.cards.length === 0}>
            全部标记已读
          </button>
          <button type="button" onClick={() => feed.loadMore(true)} disabled={feed.loading}>
            刷新
          </button>

          <span className="bff-count">
            {visibleFlat.length} / {feed.cards.length}
          </span>

          <a className="bff-back" href={BILIBILI_HOME}>
            返回 B站
          </a>
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
          <VideoGrid cards={visibleFlat} readSet={readSet} lastVisit={lastVisit} onOpen={onOpen} />
        )}

        {!feed.error &&
          view === 'grouped' &&
          sections.map((s) => (
            <GroupSection
              key={s.group.id}
              group={s.group}
              videos={s.videos}
              readSet={readSet}
              lastVisit={lastVisit}
              collapsed={collapsedSections.has(s.group.id)}
              videoCountBeforeFilter={sectionTotals.get(s.group.id) ?? 0}
              onToggle={toggleSection}
              onOpen={onOpen}
            />
          ))}

        {!feed.error && feed.hasMore && (
          <div className="bff-more">
            <button type="button" onClick={() => feed.loadMore(false)} disabled={feed.loading}>
              {feed.loading ? '加载中…' : '加载更多'}
            </button>
          </div>
        )}
      </main>

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
