import type { TrimmedFollowedUp, UpInfo } from '../types';

export const SPECIAL_ID = 'special';
export const UNCATEGORIZED_ID = 'uncategorized';
/**
 * 「隐藏」是本地系统分组，**与所有其他分组互斥**。
 *
 * 它不取关，只是把这个 UP 的视频从页面上过滤掉。互斥是必须的：若一个 UP
 * 同时在「隐藏」和「游戏」里，他的视频仍会出现在「游戏」板块，等于没隐藏。
 */
export const HIDDEN_ID = 'hidden';

/** B站 特别关注分组的恒定 tagid */
const BILI_SPECIAL_TAGID = -10;
/** B站 默认分组的恒定 tagid —— 语义是"尚未分类" */
const BILI_DEFAULT_TAGID = 0;

/**
 * B站 侧的分组归属 → 本地分组 id 列表（映射规则见设计文档 §5.1）。
 *
 * 关于 `tagid === 0`：文档未明说 UP 在自定义分组时 `tag` 数组里是否还会带上
 * 默认分组的 0。这里**无条件过滤掉 0** —— 因为 0 的语义就是"尚未分类"，
 * 与自定义分组并存时应当忽略。这样两种真实情况都能得到正确结果。
 */
export function biliGroupIdsOf(
  up: TrimmedFollowedUp,
  /**
   * 可选的 tagid → 本地分组 id 解析器。
   *
   * 必须支持它：本地分组 id 未必是 `bili-<tagid>` —— 补充导入时若本地已有
   * **同名**分组，会复用那个分组（id 形如 `local-N`）。此时继续用
   * `bili-<tagid>` 拼 id 会指向一个不存在的分组，产生脏引用，UP 静默掉进
   * 「未分类」—— 一个比原 bug 更难发现的失败。
   */
  resolve?: (tagid: number) => string | undefined,
): string[] {
  if (!Array.isArray(up.tag) || up.tag.length === 0) return [UNCATEGORIZED_ID];

  const mapped = up.tag
    .filter((tagid) => tagid !== BILI_DEFAULT_TAGID)
    .map((tagid) =>
      tagid === BILI_SPECIAL_TAGID ? SPECIAL_ID : (resolve?.(tagid) ?? `bili-${tagid}`),
    );

  return mapped.length > 0 ? mapped : [UNCATEGORIZED_ID];
}

export function buildUpIndex(list: TrimmedFollowedUp[]): Record<string, UpInfo> {
  const out: Record<string, UpInfo> = {};
  for (const u of list) {
    out[String(u.mid)] = {
      mid: u.mid,
      name: u.uname,
      face: u.face,
      isSpecial:
        u.special === 1 || (Array.isArray(u.tag) && u.tag.includes(BILI_SPECIAL_TAGID)),
    };
  }
  return out;
}
