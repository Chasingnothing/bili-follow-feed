import type { FeedItem } from '../types';
import { PAGE_SIZE, clampPage, pageSlice } from '../lib/pagination';
import FeedCard from './FeedCard';

interface Props {
  items: FeedItem[];
  readSet: Set<string>;
  lastVisit: number;
  onOpen: (item: FeedItem) => void;
  /** 打开某个 UP 的分组菜单 */
  onPick: (upMid: number, el: HTMLElement) => void;
  /** 当前页码，1-based */
  page: number;
}

/**
 * 卡片网格，**自带分页裁剪，但不渲染页码条**。
 *
 * 分页不只是为了少滚动 —— 未分类板块能到几百条，全渲染意味着 DOM 里同时挂着
 * 几百个卡片节点。分页把每次渲染压到 20 个。
 *
 * 页码条由调用方渲染：模式 1 想要「网格 → 页码条」，而模式 2 要
 * 「网格 → 拉取更多/多看一条 → 页码条」（用户明确要求按钮在页码条**上方**）。
 * 所以这里只负责网格。调用方用 `clampPage(page, items.length, PAGE_SIZE)` 拿到
 * 同一套夹取后的页码给 `Pager`。
 */
export default function FeedGrid({ items, readSet, lastVisit, onOpen, onPick, page }: Props) {
  if (items.length === 0) {
    return <div className="bff-empty">没有可显示的内容</div>;
  }

  // 筛选/排序变化后原页码可能越界，这里夹一下
  const current = clampPage(page, items.length, PAGE_SIZE);

  return (
    <div className="bff-grid">
      {pageSlice(items, current, PAGE_SIZE).map((c) => (
        <FeedCard
          key={c.id}
          item={c}
          read={readSet.has(c.id)}
          isNew={c.pubdate * 1000 > lastVisit}
          onOpen={onOpen}
          onPick={onPick}
        />
      ))}
    </div>
  );
}
