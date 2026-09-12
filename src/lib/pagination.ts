/** 每个板块 / 平铺视图一页显示多少条 */
export const PAGE_SIZE = 20;

export function pageCount(total: number, size: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

/** 把页码夹到合法范围 —— 筛选变化后原来的页码可能越界 */
export function clampPage(page: number, total: number, size: number = PAGE_SIZE): number {
  return Math.min(Math.max(1, page), pageCount(total, size));
}

export function pageSlice<T>(items: T[], page: number, size: number = PAGE_SIZE): T[] {
  const p = clampPage(page, items.length, size);
  const start = (p - 1) * size;
  return items.slice(start, start + size);
}

/** 当前页显示的是第几条到第几条（1-based，闭区间） */
export function pageRange(
  page: number,
  total: number,
  size: number = PAGE_SIZE,
): { from: number; to: number } {
  if (total <= 0) return { from: 0, to: 0 };
  const p = clampPage(page, total, size);
  const from = (p - 1) * size + 1;
  return { from, to: Math.min(total, p * size) };
}

/**
 * 生成页码条，超出部分折叠成 `…`。
 *
 * 未分类板块能有 451 条 = 23 页，全列出来就没法看了，所以必须折叠：
 * 首尾页恒在，当前页左右各留 `span` 个。
 */
export function pageNumbers(
  current: number,
  total: number,
  span = 1,
): Array<number | '…'> {
  if (total <= 0) return [];
  // 页数不多时全列出来，反而更清楚
  if (total <= span * 2 + 5) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const cur = Math.min(Math.max(1, current), total);
  const out: Array<number | '…'> = [1];

  const from = Math.max(2, cur - span);
  const to = Math.min(total - 1, cur + span);

  if (from > 2) out.push('…');
  for (let i = from; i <= to; i++) out.push(i);
  if (to < total - 1) out.push('…');

  out.push(total);
  return out;
}
