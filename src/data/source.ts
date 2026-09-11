import type { FeedPage } from '../types';

/**
 * 数据源抽象 —— 这是 UI 层唯一认识的接口。
 *
 * 热身版由 `InPageDataSource` 实现（站内 fetch，靠浏览器会话带登录态）；
 * 路线 1 将由 `HttpDataSource` 实现（调本地后端）。UI 组件不感知差异，
 * 因此本层是"热身版资产可复用到路线 1"的关键。
 */
export interface FeedDataSource {
  /** @param offset 上一页返回的游标；首页传 null */
  fetchPage(offset: string | null): Promise<FeedPage>;
}
