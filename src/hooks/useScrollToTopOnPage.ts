import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 翻页后把容器滚回自己的顶部。
 *
 * 解决的问题：某板块 22 条视频，第 1 页 20 条、第 2 页只剩 2 条 —— 板块整体变矮，
 * 下方内容全部上移，用户的视野就"跳"到了下一个板块上。滚回本板块顶部之后，
 * 无论这页有几条，看到都是从板块开头开始的内容。
 *
 * 用 tick + effect 而不是在点击处直接 scrollIntoView：React 会合并状态更新，
 * 必须等这一轮渲染把 DOM 高度改完再滚，否则滚的是旧布局的位置。
 */
export function useScrollToTopOnPage<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (tick === 0) return;
    ref.current?.scrollIntoView({ block: 'start' });
  }, [tick]);

  /** 在设置页码的同时调用它，触发一次"渲染完成后再滚动" */
  const bump = useCallback(() => setTick((n) => n + 1), []);

  return { ref, bump };
}
