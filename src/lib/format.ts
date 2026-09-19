/** 数字格式化（播放量 / 点赞数）：1.2万 / 1.2亿 */
export function formatPlay(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  return String(n);
}

/**
 * 相对时间。入参为**毫秒**时间戳。
 * 注意 FeedItem.pubdate 是秒级，调用处必须 ×1000。
 */
export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const diff = now - ts;
  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;

  if (diff < HOUR) return `${Math.max(1, Math.floor(diff / MIN))}分钟前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}小时前`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)}天前`;

  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
