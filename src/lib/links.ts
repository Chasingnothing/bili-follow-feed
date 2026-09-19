import type { FeedItemKind } from '../types';

/** UP 主个人主页地址。卡片、侧边栏、分组菜单三处都要用，收口在这里。 */
export function upSpaceUrl(mid: number): string {
  return `https://space.bilibili.com/${mid}`;
}

/**
 * 内容在原站的地址。由 `id` + `kind` 推导，**不需要落盘**。
 *
 * 模式 2 的缓存靠它把 `url` 省下来（每张卡省约 50 字符）。
 * 视频是 `/video/<bvid>`，图文是 `/opus/<id_str>`。
 */
export function itemUrl(id: string, kind: FeedItemKind): string {
  return kind === 'image'
    ? `https://www.bilibili.com/opus/${id}`
    : `https://www.bilibili.com/video/${id}`;
}
