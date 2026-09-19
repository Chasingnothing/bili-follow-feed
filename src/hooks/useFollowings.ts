import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BiliTag, TrimmedFollowedUp, UpInfo } from '../types';
import { fetchFollowings, fetchSelf, fetchTags, RELATION_PAGE_SIZE } from '../data/relation';
import { readJson, writeJson } from '../lib/storage';
import { buildUpIndex } from '../lib/upIndex';
import { isSeeded, seedFromBilibili } from '../lib/localGroups';

import { decidePaging } from '../lib/followingsPaging';

const CACHE_KEY = 'bff:followingsCache';
/**
 * 翻页上限：100 页 × 50 = **5000 人**。
 *
 * 原先只有 40 页（2000 人），而且超出时**静默丢弃** —— 关注超过 2000 的用户
 * 会以为分组不完整是 B站 的问题。现在靠 `decidePaging` 判定成"截断"并提示。
 *
 * `ps` 这条路提不上去：服务端上限就是 50（实测传 `ps=100` 只返回 50 条），
 * 所以只能靠 `pn` 翻得更多。`pn=100` 实测不报错（返回空页）。
 */
const MAX_PAGES = 100;
/** 分页之间停一下，别把自己送进风控 */
const PAGE_DELAY_MS = 300;
/** 缓存新鲜期：超过就自动重新拉 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface FollowingsCache {
  at: number;
  list: TrimmedFollowedUp[];
  tags: BiliTag[];
  /** B站 报的关注总数（0 = 未知） */
  total?: number;
  /** 上一轮是否因为翻到页数上限而没拉全 */
  truncated?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FollowingsApi {
  /** 当前关注列表（裁剪后的字段） */
  list: TrimmedFollowedUp[];
  /** B站 的分组列表，用于分组名与「补充导入」 */
  tags: BiliTag[];
  /** mid → UP 信息。**内存计算**，不落盘 —— 避免多一份可能漂移的派生缓存 */
  upIndex: Record<string, UpInfo>;
  /** B站 报的关注总数（0 = 未知） */
  total: number;
  /** 是否因为翻到页数上限而**没拉全** —— 界面必须把它显示出来，不能静默 */
  truncated: boolean;
  loading: boolean;
  error: string | null;
  lastSync: number;
  fromCache: boolean;
  refresh: () => void;
}

/**
 * 拉取并缓存关注列表与 B站 分组。
 *
 * 分页终止用「某页返回不足一页」判断，比先查一次 total 少一个请求。
 * 首次成功拉取后，如果本地从未初始化过分组，会按 B站 分组做一次初始化。
 */
export function useFollowings(): FollowingsApi {
  const [list, setList] = useState<TrimmedFollowedUp[]>([]);
  const [tags, setTags] = useState<BiliTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState(0);
  const [fromCache, setFromCache] = useState(false);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const started = useRef(false);

  const load = useCallback(async (force: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const cached = readJson<FollowingsCache | null>(CACHE_KEY, null);
      if (!force && cached && cached.list && Date.now() - cached.at < CACHE_TTL_MS) {
        setList(cached.list);
        setTags(cached.tags ?? []);
        setTotal(cached.total ?? 0);
        setTruncated(Boolean(cached.truncated));
        setLastSync(cached.at);
        setFromCache(true);
        return;
      }

      const self = await fetchSelf();
      const tagList = await fetchTags();

      const all: TrimmedFollowedUp[] = [];
      let seenTotal = 0;
      let wasTruncated = false;

      for (let pn = 1; pn <= MAX_PAGES; pn++) {
        const page = await fetchFollowings(self.mid, pn);
        all.push(...page.items);
        if (page.total > 0) seenTotal = page.total;

        const decision = decidePaging(
          { got: all.length, total: seenTotal, pageLen: page.items.length },
          RELATION_PAGE_SIZE,
          MAX_PAGES,
          pn,
        );
        if (decision === 'done') break;
        if (decision === 'truncated') {
          wasTruncated = true;
          break;
        }
        await sleep(PAGE_DELAY_MS);
      }

      const at = Date.now();
      writeJson(CACHE_KEY, {
        at,
        list: all,
        tags: tagList,
        total: seenTotal,
        truncated: wasTruncated,
      } satisfies FollowingsCache);

      // 首次导入：本地从未初始化过分组时，按 B站 分组建立起点
      if (!isSeeded()) seedFromBilibili(tagList, all);

      setList(all);
      setTags(tagList);
      setTotal(seenTotal);
      setTruncated(wasTruncated);
      setLastSync(at);
      setFromCache(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 挡住 React StrictMode 的二次执行，避免重复拉取
    if (started.current) return;
    started.current = true;
    void load(false);
  }, [load]);

  const upIndex = useMemo(() => buildUpIndex(list), [list]);

  return {
    list,
    tags,
    upIndex,
    total,
    truncated,
    loading,
    error,
    lastSync,
    fromCache,
    refresh: () => void load(true),
  };
}
