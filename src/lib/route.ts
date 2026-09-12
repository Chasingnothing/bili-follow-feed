/**
 * 入口路径。
 *
 * 2026-09-11 已在真实浏览器验证：B站 对未知路径不会重定向也不会改写 URL，
 * 只是在原地址上渲染它自己的 404 页（title「出错啦!」）。因此 `@match`
 * 可以安全收窄到这一个路径，让其他 B站 页面完全不加载本脚本。
 */
export const FEED_PATH = '/agent-feed';

/** B站 首页，用作「返回 B站」出口 */
export const BILIBILI_HOME = 'https://www.bilibili.com/';

/**
 * 判断当前是否在我们的页面路径上。
 * 容忍结尾斜杠，但不容忍 `/agent-feed-extra` 这类前缀相同的其他路径。
 */
export function isFeedPath(pathname: string): boolean {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === FEED_PATH;
}
