import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeedItem } from './types';
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
  getHiddenMids,
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
import { buildUpSections, MAX_LAYER } from './lib/upSections';
import { fetchUpToN, fetchManyUps, type BatchResult } from './lib/upFetch';
import { InPageDataSource } from './data/inPage';
import {
  loadAllItems,
  saveUpItems,
  cachedUsage,
  touchUp,
  MAX_PER_UP,
} from './lib/upVideoCache';
import { PAGE_SIZE, clampPage } from './lib/pagination';
import Pager from './components/Pager';
import { HIDDEN_ID } from './lib/upIndex';
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
  loadMode,
  saveMode,
  type FeedMode,
} from './lib/uiState';
import FeedGrid from './components/FeedGrid';
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
/** 内容类型筛选：视频 / 图文 / 全部 */
type TypeKey = 'all' | 'video' | 'image';

/**
 * 排序用的"热度"。
 *
 * 图文**没有播放量**，所以「播放量最高」这个排序对它们全算 0 —— 混排时会把所有
 * 图文挤到底部，看起来像坏了。这里按类型取各自有意义的指标：
 * 视频用播放量，图文用点赞数。
 */
function hotness(item: FeedItem): number {
  return item.kind === 'image' ? item.like : item.play;
}

/** localStorage 的常见配额（Chrome 约 5 MB），仅用于「存储占用」展示 */
const QUOTA_BYTES = 5 * 1024 * 1024;
/** 平铺视图在页码表里的 key */
const FLAT_KEY = '__flat__';

// ── 模式 2「拉取更多」的节奏 ────────────────────────────────────────────

/** 页与页之间的等待（`feed/space` 一页 12 条，节奏和动态流一致） */
const PULL_PAGE_DELAY_MS = 400;
/** 单个 UP 最多翻几页 —— 一页通常就够，但图文/转发为主的 UP 要接着翻 */
const MAX_PAGES_PER_UP = 3;
/** 每拉多少个 UP 歇一下（防风控） */
const PULL_BATCH = 20;
/** 歇多久 */
const PULL_BATCH_PAUSE_MS = 2000;
/** 这么久之内拉过的 UP 就跳过，避免连点两次白跑一整轮 */
const PULL_FRESH_MS = 10 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 模式 2 里板块不允许拖动排序。
 *
 * 不是"忘了做"：模式 2 的板块顺序跟随本地分组顺序，而拖拽排序要写 `reorderGroups`
 * 去改分组本身 —— 那会连带影响侧边栏和模式 1 的板块顺序。为了避免一个拖动把
 * 另一个视图的布局也搅了，模式 2 先只读。
 */
const NO_MOVE: MoveApi = {
  onMove: () => {},
  canMoveUp: false,
  canMoveDown: false,
  dragging: false,
  dropEdge: null,
  onDragStart: () => {},
  onDragOver: () => {},
  onDrop: () => {},
  onDragEnd: () => {},
};

export default function App() {
  // 模式 2（UP 主拉取）不用动态流 —— 见 useFeed 的 enabled 参数
  const [mode, setMode] = useState<FeedMode>(() => loadMode());
  const feed = useFeed({}, mode === 'feed');
  const followings = useFollowings();

  const [groups, setGroups] = useState<Group[]>(() => loadGroups());
  const [membership, setMembership] = useState<Record<string, string[]>>(() => loadMembership());
  /** 本地分组数据被改动过的计数 —— 用来让派生值（分歧、占用）重新计算 */
  const [dataVersion, setDataVersion] = useState(0);

  const [sort, setSort] = useState<SortKey>('latest');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [typeFilter, setTypeFilter] = useState<TypeKey>('all');
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

  // ── 模式 2（UP 主拉取）────────────────────────────────────────────────

  /**
   * 每个板块的层数（每个 UP 显示前几条）。
   *
   * **刻意只存内存、不落盘** —— 刷新后一律回到第一层。
   * 曾经落盘过，结果是"点过「多看一条」的板块被永久记住，跨会话悄悄停在第二层"。
   * 重置的代价是零（「多看一条」只读缓存、不发请求），所以没有理由持久化。
   * 理由详见 `lib/uiState.ts` 末尾那段注释。
   */
  const [upLayers, setUpLayers] = useState<Record<string, number>>({});
  /**
   * 缓存内容被改动过的计数。
   *
   * `loadAllItems()` 要扫一遍 localStorage 并逐个解析，不能每次渲染都跑，
   * 所以用它当依赖：只有真的拉过/揭示过才重新读。
   */
  const [upCacheVersion, setUpCacheVersion] = useState(0);
  /**
   * 正在批量拉取的板块与进度。**全局只有一个** ——
   * 允许两个板块同时拉会让请求量翻倍，正好抵消掉限速的意义。
   */
  const [pulling, setPulling] = useState<{ groupId: string; done: number; total: number } | null>(
    null,
  );
  /** 暂停后记下"是哪个板块、怎么继续" */
  const upResumeRef = useRef<{ groupId: string; fn: () => void } | null>(null);
  const upPauseRef = useRef(false);
  /**
   * 每个板块自己的拉取结果。
   *
   * 以前是一个全局提示条，固定在页面顶部 —— 但用户是盯着页面**下方**的板块看，
   * 根本看不到。改成挂在对应板块的最底部。
   */
  const [pullStatus, setPullStatus] = useState<
    Record<string, { text: string; resumable: boolean } | undefined>
  >({});

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

  const onOpen = useCallback((card: FeedItem) => {
    setReadSet((prev) => {
      const next = markRead(prev, card.id);
      if (!saveRead(next)) setStorageWarning(true);
      return next;
    });
  }, []);

  // ── 排序与筛选 ────────────────────────────────────────────────────────

  const collator = useCallback(
    (a: FeedItem, b: FeedItem) => (sort === 'play' ? hotness(b) - hotness(a) : b.pubdate - a.pubdate),
    [sort],
  );

  /** 处于「隐藏」的 UP —— **不取关**，只是把他的视频从页面滤掉 */
  const hiddenMids = useMemo(() => getHiddenMids(), [membership, dataVersion]);

  const sortedAll = useMemo(
    () =>
      feed.cards
        .filter((c) => !hiddenMids.has(c.upMid))
        .sort(collator),
    [feed.cards, hiddenMids, collator],
  );

  const hiddenCount = useMemo(
    () => feed.cards.filter((c) => hiddenMids.has(c.upMid)).length,
    [feed.cards, hiddenMids],
  );
  const visibleFlat = useMemo(
    () =>
      sortedAll
        .filter((c) => typeFilter === 'all' || c.kind === typeFilter)
        .filter((c) => filter !== 'unread' || !readSet.has(c.id)),
    [sortedAll, filter, readSet, typeFilter],
  );

  /** 主区不渲染「隐藏」板块 —— 它只是管理入口，其内容已被过滤掉 */
  const sectionGroups = useMemo(() => groups.filter((g) => g.id !== HIDDEN_ID), [groups]);

  const sections = useMemo(
    () => buildSections(visibleFlat, sectionGroups, membership),
    [visibleFlat, sectionGroups, membership],
  );
  // 未经过滤的分区，用来告诉用户「这个板块被筛选掉了多少」
  const sectionTotals = useMemo(
    () =>
      new Map(
        buildSections(sortedAll, sectionGroups, membership).map((s) => [
          s.group.id,
          s.items.length,
        ]),
      ),
    [sortedAll, sectionGroups, membership],
  );

  // ── 模式 2 的派生数据与操作 ───────────────────────────────────────────

  /** 每个 UP 已缓存的条目。整表读一次，组件里不再逐个读 localStorage */
  const upCache = useMemo(() => loadAllItems(), [upCacheVersion]);

  const upSections = useMemo(
    () =>
      buildUpSections({
        groups,
        membership,
        followings: followings.list,
        layers: upLayers,
        cache: upCache,
        collator,
      }),
    [groups, membership, followings.list, upLayers, upCache, collator],
  );

  /** 模式 2 的条目也过一遍和模式 1 相同的筛选（类型 / 未读），否则工具条上的控件会骗人 */
  const filterForUpMode = useCallback(
    (items: FeedItem[]) =>
      items
        .filter((c) => typeFilter === 'all' || c.kind === typeFilter)
        .filter((c) => filter !== 'unread' || !readSet.has(c.id)),
    [typeFilter, filter, readSet],
  );

  /**
   * 「全部标记已读」的作用对象。
   *
   * 按模式取：模式 1 是动态流的卡片，模式 2 是按 UP 缓存的内容。
   * 不这么分的话，模式 2 里动态流是空的，这个按钮点了什么都不会发生。
   */
  const markAllTargets = useMemo(
    () => (mode === 'feed' ? feed.cards : upSections.flatMap((s) => s.items)),
    [mode, feed.cards, upSections],
  );

  const onMarkAllRead = useCallback(() => {
    setReadSet(() => {
      const next = markAllRead(markAllTargets.map((c) => c.id));
      if (!saveRead(next)) setStorageWarning(true);
      return next;
    });
  }, [markAllTargets]);

  const changeMode = useCallback((m: FeedMode) => {    setMode(m);
    saveMode(m);
    // 切模式时把暂停状态清掉，否则「继续」会去续一个已经不该跑的任务
    upPauseRef.current = false;
    upResumeRef.current = null;
  }, []);

  const changeLayer = useCallback((groupId: string, next: number) => {
    // 只改内存，不落盘 —— 刷新后回到第一层（见 upLayers 的注释）
    setUpLayers((prev) => ({ ...prev, [groupId]: next }));
    // 揭示缓存内容也算"用过"这些 UP，否则它们会因为"很久没发请求"被先淘汰
    setUpCacheVersion((v) => v + 1);
  }, []);

  /**
   * 「拉取更多」：把这个板块**全部** UP 拉一遍（每 20 个歇一下，可暂停）。
   *
   * 已拉过的也会重新拉（用户选的行为），但 `isFresh` 会跳过刚拉过的，
   * 避免连点两次白跑一整轮。
   */
  const pullMore = useCallback(
    (groupId: string, mids: number[]) => {
      // 全局一次只跑一个板块：两个同时拉会让请求量翻倍，抵消掉限速的意义
      if (pulling) return;
      const source = new InPageDataSource();
      upPauseRef.current = false;
      // 一次性取出"上次拉取时间"，避免在循环里为每个 UP 读一次 localStorage
      const fetchedAtMap = new Map(cachedUsage().map((e) => [e.mid, e.at]));
      // 新一轮开始 → 清掉上一轮的结果条
      setPullStatus((s) => ({ ...s, [groupId]: undefined }));

      const run = (targets: number[]) => {
        setPulling({ groupId, done: 0, total: targets.length });
        void fetchManyUps({
          mids: targets,
          want: MAX_PER_UP,
          isFresh: (mid) => {
            const at = fetchedAtMap.get(mid) ?? 0;
            return at > 0 && Date.now() - at < PULL_FRESH_MS;
          },
          fetchUp: (mid) =>
            fetchUpToN({
              mid,
              want: MAX_PER_UP,
              fetchPage: (offset) => source.fetchUpSpace(mid, offset),
              maxPages: MAX_PAGES_PER_UP,
              delayMs: PULL_PAGE_DELAY_MS,
              sleep,
              shouldStop: () => upPauseRef.current,
            }),
          onFetched: (mid, items) => {
            saveUpItems(mid, items, Date.now());
            setUpCacheVersion((v) => v + 1);
          },
          onProgress: (done, total) => setPulling({ groupId, done, total }),
          pauseEvery: PULL_BATCH,
          pauseMs: PULL_BATCH_PAUSE_MS,
          sleep,
          shouldStop: () => upPauseRef.current,
        }).then((res: BatchResult) => {
          setPulling(null);
          setUpCacheVersion((v) => v + 1);

          if (res.paused) {
            // 续拉从"已处理"处接着走 —— 跳过/失败/空结果的 UP 也算处理过了
            upResumeRef.current = { groupId, fn: () => run(targets.slice(res.processed)) };
            setPullStatus((s) => ({
              ...s,
              [groupId]: { text: `已暂停 · 还剩 ${targets.length - res.processed} 个`, resumable: true },
            }));
            return;
          }

          upResumeRef.current = null;
          const parts = [`成功 ${res.fetched} 个 UP`];
          if (res.empty > 0) parts.push(`${res.empty} 个没有可显示的内容`);
          if (res.skipped > 0) parts.push(`跳过 ${res.skipped} 个（刚拉过）`);
          if (res.failed > 0) parts.push(`失败 ${res.failed} 个`);
          setPullStatus((s) => ({ ...s, [groupId]: { text: parts.join('；'), resumable: false } }));
        });
      };

      run(mids);
    },
    [pulling],
  );

  /** 继续某个板块被暂停的拉取。按钮在板块底部，所以由它把 groupId 传进来。 */
  const resumePull = useCallback((groupId: string) => {
    const r = upResumeRef.current;
    if (!r || r.groupId !== groupId) return;
    upResumeRef.current = null;
    upPauseRef.current = false;
    setPullStatus((s) => ({ ...s, [groupId]: { text: '正在继续…', resumable: false } }));
    r.fn();
  }, []);

  const dismissPullStatus = useCallback((groupId: string) => {
    setPullStatus((s) => ({ ...s, [groupId]: undefined }));
  }, []);

  // ── 空板块默认折叠（只在首次拿到分区时做一次）─────────────────────────

  useEffect(() => {
    if (collapseSeeded.current || sections.length === 0) return;
    collapseSeeded.current = true;
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      for (const s of sections) if (s.items.length === 0) next.add(s.group.id);
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
      // 操作已应用 → 立即清空选择。否则下一次操作会把**同一批人**又加进
      // 另一个分组（用户以为已经换了一批，实际没有）。
      setSelected(new Set());
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

  /**
   * ⚠️ 必须用 `useCallback` 包装。
   *
   * `Sidebar` 是 `memo` 的（见 Sidebar.tsx 末尾的说明）。这里原先是内联箭头
   * `onOpenGroupMenu={(el) => ...}` —— 每次渲染都产生新函数引用，会让 memo
   * **完全失效**，于是加载动态流时侧边栏跟着重渲染几千行，表现为页面卡死。
   */
  const openGroupMenu = useCallback((el: HTMLElement) => {
    setMenuAnchor(el.getBoundingClientRect());
  }, []);

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
        followingsTotal={followings.total}
        followingsTruncated={followings.truncated}
        batchActive={batchActive}
        selected={selected}
        diverged={diverged}
        onToggleBatch={toggleBatch}
        onToggleSelect={toggleSelect}
        onSelectMany={selectMany}
        onPick={pickFor}
        onRefresh={followings.refresh}
        onMergeImport={mergeNow}
        onOpenGroupMenu={openGroupMenu}
      />

      <main className={`bff-main${batchActive ? ' is-batch' : ''}`}>
        {/* 工具条与批量面板一起吸顶，保证选 UP 时两者都看得见 */}
        <div className="bff-sticky-head">
        <div className="bff-bar">
          <strong>只看关注</strong>

          {/* 模式切换：「动态流」是全局时间线，「UP 主拉取」是按板块逐个 UP 补内容 */}
          <span className="bff-typeseg" role="group" aria-label="切换模式">
            {(
              [
                ['feed', '动态流'],
                ['upPull', 'UP 主拉取'],
              ] as Array<[FeedMode, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={mode === key ? 'is-on' : ''}
                aria-pressed={mode === key}
                onClick={() => changeMode(key)}
              >
                {label}
              </button>
            ))}
          </span>

          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="latest">最新发布</option>
            {/* 图文没有播放量，按类型换个说法，否则标签是骗人的 */}
            <option value="play" title="视频按播放量，图文按点赞数">
              {typeFilter === 'image' ? '点赞最多' : '播放量最高'}
            </option>
          </select>

          <span className="bff-typeseg" role="group" aria-label="按内容类型筛选">
            {(
              [
                ['all', '全部'],
                ['video', '视频'],
                ['image', '图文'],
              ] as Array<[TypeKey, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={typeFilter === key ? 'is-on' : ''}
                aria-pressed={typeFilter === key}
                onClick={() => setTypeFilter(key)}
              >
                {label}
              </button>
            ))}
          </span>

          <select value={filter} onChange={(e) => setFilter(e.target.value as FilterKey)}>
            <option value="all">全部</option>
            <option value="unread">未读</option>
          </select>

          {/* 模式 2 天然是分组结构，也没有时间窗概念（按 UP 补内容，与"多久以前"无关） */}
          {mode === 'feed' && (
            <>
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
            </>
          )}

          {/* 「全部标记已读」按模式取目标：模式 2 里动态流是空的，标它没有意义 */}
          <button type="button" onClick={onMarkAllRead} disabled={markAllTargets.length === 0}>
            全部标记已读
          </button>

          {/* 「刷新」和「N / M」都是动态流的概念，模式 2 没有 */}
          {mode === 'feed' && (
            <>
              <button type="button" onClick={feed.refresh} disabled={feed.loading || feed.filling}>
                刷新
              </button>

              <span className="bff-count">
                {visibleFlat.length} / {feed.cards.length}
                {hiddenCount > 0 && (
                  <span className="bff-hidden-hint" title="这些 UP 在「隐藏」分组里，视频已被过滤">
                    （已隐藏 {hiddenCount} 条）
                  </span>
                )}
              </span>
            </>
          )}

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

        {mode === 'upPull' && upSections.length === 0 && (
          <div className="bff-empty">
            模式 2 只显示<strong>已归类</strong>的分组 —— 「未分类」里那几百个 UP 不在这里逐个拉。
            <br />
            先去左侧把他们分到几个分组里，再回到这个模式。
          </div>
        )}

        {/*
         * 模式 2：板块由「该分组的 UP 列表 → 各自的缓存」组装，与模式 1 的数据流相反，
         * 所以走另一条渲染分支，不复用 sections。
         */}
        {mode === 'upPull' &&
          upSections.map((s) => (
            <GroupSection
              key={s.group.id}
              group={s.group}
              items={filterForUpMode(s.items)}
              readSet={readSet}
              lastVisit={lastVisit}
              collapsed={collapsedSections.has(s.group.id)}
              itemCountBeforeFilter={s.items.length}
              page={pages[s.group.id] ?? 1}
              // 模式 2 不允许拖动排序（没有 moveApi），传一个禁用的空实现
              move={NO_MOVE}
              onToggle={toggleSection}
              onOpen={onOpen}
              onPageChange={(p) => setPage(s.group.id, p)}
              onPick={pickFor}
              upPull={{
                upTotal: s.ups.length,
                upCached: s.cachedCount,
                upChecked: s.checkedCount,
                layer: s.layer,
                maxLayer: MAX_LAYER,
                progress: pulling?.groupId === s.group.id ? pulling : null,
                status: pullStatus[s.group.id] ?? null,
                onPullMore: () => pullMore(s.group.id, s.ups.map((u) => u.mid)),
                onPause: () => {
                  upPauseRef.current = true;
                },
                onResume: () => resumePull(s.group.id),
                onDismissStatus: () => dismissPullStatus(s.group.id),
                onMoreLayer: () => {
                  changeLayer(s.group.id, Math.min(MAX_LAYER, s.layer + 1));
                  // 揭示时更新"使用时间"，否则正在看的板块反而会被先淘汰
                  for (const u of s.ups) touchUp(u.mid, Date.now());
                },
              }}
            />
          ))}

        {mode === 'feed' && !feed.error && view === 'flat' && (
          <div ref={flatScroll.ref}>
            <FeedGrid
              items={visibleFlat}
              readSet={readSet}
              lastVisit={lastVisit}
              onOpen={onOpen}
              onPick={pickFor}
              page={pages[FLAT_KEY] ?? 1}
            />
            <Pager
              page={clampPage(pages[FLAT_KEY] ?? 1, visibleFlat.length, PAGE_SIZE)}
              total={visibleFlat.length}
              onChange={(p) => {
                setPage(FLAT_KEY, p);
                flatScroll.bump();
              }}
            />
          </div>
        )}

        {mode === 'feed' &&
          !feed.error &&
          view === 'grouped' &&
          sections.map((s, idx) => (
            <GroupSection
              key={s.group.id}
              group={s.group}
              items={s.items}
              readSet={readSet}
              lastVisit={lastVisit}
              collapsed={collapsedSections.has(s.group.id)}
              itemCountBeforeFilter={sectionTotals.get(s.group.id) ?? 0}
              page={pages[s.group.id] ?? 1}
              move={moveApiFor(s.group.id, idx)}
              onToggle={toggleSection}
              onOpen={onOpen}
              onPageChange={(p) => setPage(s.group.id, p)}
              onPick={pickFor}
            />
          ))}

      </main>

      {/*
       * 悬浮「加载更多」是**动态流的翻页**入口，模式 2 里没有这个概念
       * （那边每个板块有自己的「拉取更多」），所以整个隐藏。
       */}
      {mode === 'feed' && (
        <LoadMoreBar
          loaded={feed.cards.length}
          hasMore={feed.hasMore}
          busy={feed.loading || feed.filling || feed.loadingMore}
          progress={feed.moreProgress}
          filling={feed.filling}
          paused={feed.paused}
          filledPages={feed.filledPages}
          refreshing={feed.refreshing}
          raised={batchActive}
          onLoad={feed.loadMore}
          onPause={feed.pause}
          onResume={feed.resume}
        />
      )}
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
