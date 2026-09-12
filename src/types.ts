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
  /**
   * 本页**全部**条目中最早的发布时刻（秒级）。
   *
   * 判据必须取自原始条目而不是映射后的视频卡片 —— 一页 21 条里可能一条视频都
   * 没有（全是图文/转发），那时就无法从卡片判断这页翻到了哪个时间点，
   * 「翻到覆盖 N 天」的停止条件会失效。
   * 没有任何条目时为 0（调用方据此判定"到头了"）。
   */
  oldestPubTs: number;
}

/** B站 关注分组。tagid -10=特别关注、0=默认分组，两者恒定。 */
export interface BiliTag {
  tagid: number;
  name: string;
  count: number;
}

/**
 * 裁剪后的关注项 —— 只保留落盘需要的字段。
 * B站 原始项还带 sign / vip / official_verify 等，体积是这里的 4-5 倍。
 */
export interface TrimmedFollowedUp {
  mid: number;
  uname: string;
  /** 已提升为 https */
  face: string;
  /** null = 只在 B站 默认分组 */
  tag: number[] | null;
  special: 0 | 1;
}

/** 当前登录用户 */
export interface SelfInfo {
  mid: number;
  uname: string;
}

/** 侧边栏与卡片链接所需的 UP 信息 */
export interface UpInfo {
  mid: number;
  name: string;
  /** 已提升为 https */
  face: string;
  isSpecial: boolean;
}
