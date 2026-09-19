/** 内容类型：视频投稿 / 图文（含纯文字）动态 */
export type FeedItemKind = 'video' | 'image';

/**
 * 动态流里的一条内容。
 *
 * 从 `VideoCard` 泛化而来：视频和图文共用同一个卡片模型，靠 `kind` 区分。
 * 泛化的动机有两层：
 *  1. 有些 UP 主要发图文，只显示视频会漏掉他们大部分内容；
 *  2. 它同时也是"支持多平台"要做的同一件事 —— 两处都要求"卡片不一定是视频"。
 *
 * 2026-09-13 实测的字段来源：
 *  - 视频：`modules.module_dynamic.major.archive`（`major.type === 'MAJOR_TYPE_ARCHIVE'`）
 *  - 图文：`modules.module_dynamic.major.opus`（`major.type === 'MAJOR_TYPE_OPUS'`）
 */
export interface FeedItem {
  /**
   * 稳定唯一 id —— **去重、已读、缓存都用它**。
   *
   * 视频是 `bvid`；图文是动态的 `id_str`。注意 `id_str` 是
   * **19 位数字字符串，超过 JS 安全整数上限，绝不能 `Number()` 它**。
   */
  id: string;
  kind: FeedItemKind;
  /** 视频标题；图文取 `opus.title`，为空时退回正文 */
  title: string;
  /** 视频封面 / 图文首图（纯文字动态为空串）。**已保证为 https://**，否则会被混合内容拦截 */
  cover: string;
  /** 封面原始像素尺寸；0 = 未知 */
  coverW: number;
  coverH: number;
  /** 图文共几张图；视频恒为 0 */
  imageCount: number;
  /** 视频时长；图文为 null */
  durationText: string | null;
  /** 播放量。图文没有这个概念，恒为 0 */
  play: number;
  /** 弹幕数。图文恒为 0 */
  danmaku: number;
  /** 点赞数 */
  like: number;
  /**
   * 秒级时间戳，来自 `module_author.pub_ts`（B站 返回的是字符串）。
   * 注意：`archive` 内**没有**任何时间字段，不要试图从那里取。
   * 使用时须 ×1000 转为毫秒。
   */
  pubdate: number;
  upMid: number;
  upName: string;
  /** 已保证为 https:// */
  upFace: string;
  /** 跳转 B站 原站：视频页 `/video/<bvid>` 或图文页 `/opus/<id_str>` */
  url: string;
}

export interface FeedPage {
  items: FeedItem[];
  nextOffset: string | null;
  hasMore: boolean;
  /**
   * 本页**全部**条目中最早的发布时刻（秒级）。
   *
   * 判据必须取自原始条目而不是映射后的卡片 —— 一页里可能一条**可显示**的内容
   * 都没有（全是转发/直播推广位），那时就无法从卡片判断这页翻到了哪个时间点，
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
