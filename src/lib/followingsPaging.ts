/**
 * 关注列表翻页的终止判断。
 *
 * 抽成纯函数是因为这里有一个**静默失效**的风险点：
 *
 * B站 的 `ps` 有服务端上限（2026-09 实测：传 `ps=100` 只返回 50 条）。
 * 如果哪天有人把 `PAGE_SIZE` 改成 100 想少发一半请求，那么**每一页**都会
 * 返回 50 条 —— 而"短页即末页"这条判据会让它在**第一页就停下**，
 * 结果只导入 50 个人，且不报错。
 *
 * 所以判据的优先级是：
 *   1. `total` 已知且已收齐   → 完成（最可靠）
 *   2. 本页为空               → 完成
 *   3. 本页不足一页           → 完成（服务端上限高于 PAGE_SIZE 时的兜底）
 *   4. 翻满页数上限           → **截断**（要告诉用户，不能静默）
 */
export type PagingDecision = 'continue' | 'done' | 'truncated';

export interface PagingState {
  /** 到目前为止收到的条数 */
  got: number;
  /** B站 报的关注总数（0 表示这一页没给出） */
  total: number;
  /** 本页返回的条数 */
  pageLen: number;
}

export function decidePaging(
  state: PagingState,
  pageSize: number,
  maxPages: number,
  /** 刚刚处理完的页码，从 1 开始 */
  page: number,
): PagingDecision {
  // ① total 已知时它是**唯一可靠**的判据。
  //    注意这里不能先判"短页"：服务端对 ps 有上限（实测传 100 只给 50），
  //    那样会在第一页就把 50 < 100 当成"末页"而提前收工 —— 静默少导入。
  if (state.total > 0) {
    if (state.got >= state.total) return 'done';
    if (state.pageLen === 0) return 'done'; // 服务端异常，别死循环
    if (page >= maxPages) return 'truncated';
    return 'continue';
  }

  // ② total 未知（老接口行为 / 字段缺失）→ 退回"短页即末页"
  if (state.pageLen === 0) return 'done';
  if (state.pageLen < pageSize) return 'done';
  if (page >= maxPages) return 'truncated';
  return 'continue';
}
