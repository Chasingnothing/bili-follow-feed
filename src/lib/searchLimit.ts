/**
 * 侧边栏搜索的**渲染上限**。
 *
 * 搜索时会把所有匹配项都渲染出来（并且强制展开所属分组，见 `Sidebar.isCollapsed`）。
 * 关注数很大时，搜一个常见字可能一次渲染上千行 —— 输入框会明显卡顿。
 *
 * 这里只限制**渲染条数**，不限制匹配数：
 * 「全选本组」和分组计数仍然按全部匹配项算，所以功能没有被削弱。
 */
export const SEARCH_ROW_LIMIT = 50;

export interface Limited<T> {
  /** 用于渲染的前若干项 */
  shown: T[];
  /** 因超出上限而未渲染的数量（0 表示全部显示了） */
  hidden: number;
}

export function limitMatches<T>(items: T[], limit: number = SEARCH_ROW_LIMIT): Limited<T> {
  // limit <= 0 视为"不限制" —— 避免调用方传 0 时把列表清空
  if (limit <= 0 || items.length <= limit) return { shown: items, hidden: 0 };
  return { shown: items.slice(0, limit), hidden: items.length - limit };
}
