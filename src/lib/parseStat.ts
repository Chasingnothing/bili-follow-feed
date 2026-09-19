/**
 * B站 的统计字段是**带单位的展示字符串**，不是数字。
 *
 * 实测（2026-09-13 探针）：`archive.stat.play` 是 `"3.4万"`，而小数值是 `"99"`。
 * 直接 `Number("3.4万")` 得到 `NaN`，被兜底成 `0` —— 于是**所有播放量上万的视频
 * 卡片上都显示 0 播放**，而且「播放量最高」排序会把热门视频全排到最后。
 *
 * 之前没发现，是因为 fixture 里恰好抓的是 `"99"`（不带单位），测试绕过了这个分支。
 */

const UNIT_FACTOR: Record<string, number> = {
  万: 10_000,
  亿: 100_000_000,
};

/**
 * 把 `"3.4万"` / `"1.2亿"` / `"9999"` / `"10万+"` 解析成数字。
 *
 * 认不出来的一律返回 0（而不是 NaN）—— 避免 NaN 渗进排序和格式化。
 * 注意它**只**处理这两种中文单位；B站 别的字段没有更多单位。
 */
export function parseStatCount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;

  const s = value.trim();
  if (!s) return 0;

  // 允许尾随 "+"（例如 "10万+"）；"──" 之类的占位符会走到这里返回 0
  const m = /^(\d+(?:\.\d+)?)\s*(万|亿)?\+?$/.exec(s);
  if (!m) return 0;

  const n = Number(m[1]);
  if (!Number.isFinite(n)) return 0;

  const factor = m[2] ? UNIT_FACTOR[m[2]] : 1;
  return Math.round(n * factor);
}
