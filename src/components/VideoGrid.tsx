import type { VideoCard as Card } from '../types';
import { PAGE_SIZE, clampPage, pageSlice } from '../lib/pagination';
import VideoCard from './VideoCard';
import Pager from './Pager';

interface Props {
  cards: Card[];
  readSet: Set<string>;
  lastVisit: number;
  onOpen: (card: Card) => void;
  /** 打开某个 UP 的分组菜单 */
  onPick: (upMid: number, el: HTMLElement) => void;
  /** 当前页码，1-based */
  page: number;
  onPageChange: (page: number) => void;
}

/**
 * 卡片网格，**自带分页**。
 *
 * 分页不只是为了少滚动 —— 未分类板块能到 451 条，全渲染意味着 DOM 里同时挂着
 * 451 个卡片节点。分页把每次渲染压到 20 个。
 */
export default function VideoGrid({
  cards,
  readSet,
  lastVisit,
  onOpen,
  onPick,
  page,
  onPageChange,
}: Props) {
  if (cards.length === 0) {
    return <div className="bff-empty">没有可显示的视频</div>;
  }

  // 筛选/排序变化后原页码可能越界，这里夹一下
  const current = clampPage(page, cards.length, PAGE_SIZE);

  return (
    <>
      <div className="bff-grid">
        {pageSlice(cards, current, PAGE_SIZE).map((c) => (
          <VideoCard
            key={c.bvid}
            card={c}
            read={readSet.has(c.bvid)}
            isNew={c.pubdate * 1000 > lastVisit}
            onOpen={onOpen}
            onPick={onPick}
          />
        ))}
      </div>
      <Pager page={current} total={cards.length} onChange={onPageChange} />
    </>
  );
}
