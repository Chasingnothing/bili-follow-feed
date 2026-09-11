export interface VideoCard {
  bvid: string;
  title: string;
  /** 已保证为 https://，否则 HTTPS 页面会按混合内容拦截 */
  cover: string;
  durationText: string;
  play: number;
  danmaku: number;
  /**
   * 秒级时间戳，来自 `module_author.pub_ts`（B站 返回的是字符串）。
   * 注意：`archive` 内**没有**任何时间字段，不要试图从那里取。
   * 使用时须 ×1000 转为毫秒。
   */
  pubdate: number;
  upMid: number;
  upName: string;
  upFace: string;
  /** 跳转 B站 原视频页 */
  url: string;
}

export interface FeedPage {
  items: VideoCard[];
  nextOffset: string | null;
  hasMore: boolean;
}
