import { useMemo, useState } from 'react';
import type { TrimmedFollowedUp } from '../types';
import type { Group } from '../lib/localGroups';
import { UNCATEGORIZED_ID } from '../lib/upIndex';
import { upSpaceUrl } from '../lib/links';
import {
  loadCollapsed,
  saveCollapsed,
  toggleCollapsed,
  SIDEBAR_COLLAPSED_KEY,
} from '../lib/uiState';

interface Props {
  groups: Group[];
  membership: Record<string, string[]>;
  followings: TrimmedFollowedUp[];
  loading: boolean;
  error: string | null;
  lastSync: number;
  fromCache: boolean;

  batchActive: boolean;
  selected: Set<number>;
  diverged: Set<number>;

  onToggleBatch: () => void;
  onToggleSelect: (mid: number) => void;
  onSelectMany: (mids: number[], on: boolean) => void;
  onPick: (mid: number, el: HTMLElement) => void;
  onRefresh: () => void;
  onMergeImport: () => void;
  onOpenGroupMenu: (el: HTMLElement) => void;
}

function syncLabel(ts: number, fromCache: boolean): string {
  if (!ts) return '未同步';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${fromCache ? '缓存' : '已同步'} ${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function Sidebar(props: Props) {
  const {
    groups,
    membership,
    followings,
    loading,
    error,
    lastSync,
    fromCache,
    batchActive,
    selected,
    diverged,
    onToggleBatch,
    onToggleSelect,
    onSelectMany,
    onPick,
    onRefresh,
    onMergeImport,
    onOpenGroupMenu,
  } = props;

  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed(SIDEBAR_COLLAPSED_KEY));

  function toggleGroup(id: string) {
    setCollapsed((prev) => {
      const next = toggleCollapsed(prev, id);
      saveCollapsed(SIDEBAR_COLLAPSED_KEY, next);
      return next;
    });
  }

  // mid → 所属本地分组（空/缺失 = 未分类）
  const byGroup = useMemo(() => {
    const map = new Map<string, TrimmedFollowedUp[]>();
    for (const g of groups) map.set(g.id, []);
    if (!map.has(UNCATEGORIZED_ID)) map.set(UNCATEGORIZED_ID, []);

    for (const u of followings) {
      const gids = membership[String(u.mid)];
      const targets = gids && gids.length > 0 ? gids : [UNCATEGORIZED_ID];
      for (const gid of targets) {
        // 脏引用（指向已删除的分组）按未分类处理
        const bucket = map.has(gid) ? gid : UNCATEGORIZED_ID;
        map.get(bucket)!.push(u);
      }
    }
    return map;
  }, [groups, followings, membership]);

  const q = query.trim().toLowerCase();
  const ordered = useMemo(() => [...groups].sort((a, b) => a.order - b.order), [groups]);

  const isCollapsed = (id: string) => (q ? false : collapsed.has(id));

  return (
    <aside className="bff-side">
      <div className="bff-side-head">
        <input
          className="bff-search"
          type="search"
          placeholder="搜索 UP 主…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="bff-side-actions">
          <button type="button" onClick={onToggleBatch} className={batchActive ? 'is-on' : ''}>
            {batchActive ? '退出批量' : '批量'}
          </button>
          <button type="button" onClick={(e) => onOpenGroupMenu(e.currentTarget)}>
            分组 ⋯
          </button>
        </div>
        <div className="bff-side-status">
          {loading ? '加载中…' : syncLabel(lastSync, fromCache)}
        </div>
      </div>

      {error && <div className="bff-side-error">拉取关注列表失败：{error}</div>}

      <div className="bff-side-list">
        {ordered.map((g) => {
          const all = byGroup.get(g.id) ?? [];
          const items = q ? all.filter((u) => u.uname.toLowerCase().includes(q)) : all;
          if (q && items.length === 0) return null;

          const folded = isCollapsed(g.id);
          const allSelected = items.length > 0 && items.every((u) => selected.has(u.mid));

          return (
            <div className="bff-side-group" key={g.id}>
              <div className="bff-side-grouphead">
                <button
                  type="button"
                  className="bff-fold"
                  onClick={() => toggleGroup(g.id)}
                  aria-expanded={!folded}
                  title={folded ? '展开' : '折叠'}
                >
                  {folded ? '+' : '−'}
                </button>
                {batchActive && (
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => onSelectMany(items.map((u) => u.mid), !allSelected)}
                    title="全选本组"
                  />
                )}
                <span className="bff-side-groupname" title={g.name}>
                  {g.name}
                </span>
                <span className="bff-side-count">{items.length}</span>
              </div>

              {!folded && (
                <div className="bff-side-items">
                  {items.map((u) => (
                    <div className="bff-up-row" key={u.mid}>
                      {batchActive && (
                        <input
                          type="checkbox"
                          checked={selected.has(u.mid)}
                          onChange={() => onToggleSelect(u.mid)}
                        />
                      )}
                      <a
                        className="bff-up-link"
                        href={upSpaceUrl(u.mid)}
                        target="_blank"
                        rel="noreferrer"
                        title={`${u.uname} 的主页`}
                      >
                        <img
                          className="bff-up-face"
                          src={u.face}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                        <span className="bff-up-name">{u.uname}</span>
                      </a>
                      {diverged.has(u.mid) && (
                        <span className="bff-diverged" title="B站 侧的分组已变更">
                          ↻
                        </span>
                      )}
                      <button
                        type="button"
                        className="bff-up-more"
                        onClick={(e) => onPick(u.mid, e.currentTarget)}
                        title="调整分组"
                      >
                        ⋯
                      </button>
                    </div>
                  ))}
                  {items.length === 0 && <div className="bff-side-none">（空）</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="bff-side-foot">
        <button type="button" onClick={onRefresh} disabled={loading}>
          刷新关注列表
        </button>
        <button type="button" onClick={onMergeImport} disabled={loading}>
          补充导入分组
        </button>
        <a
          className="bff-side-link"
          href="https://space.bilibili.com/"
          target="_blank"
          rel="noreferrer"
        >
          去 B站 管理分组 →
        </a>
      </div>
    </aside>
  );
}
