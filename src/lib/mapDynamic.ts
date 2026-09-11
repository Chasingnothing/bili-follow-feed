import type { VideoCard } from '../types';

const AV_TYPE = 'DYNAMIC_TYPE_AV';

/**
 * B站 返回的封面是 `http://i1.hdslb.com/...`。页面跑在 HTTPS 下，
 * http 图片会被浏览器按混合内容直接拦掉（表现为一屏碎图），必须提升到 https。
 */
function toHttps(url: string): string {
  return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url;
}

/**
 * B站 把数字字段序列化成了字符串（`stat.play`、`stat.danmaku`、`pub_ts` 都是），
 * 这里统一安全转换，避免 NaN 渗进排序和格式化逻辑。
 */
function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 把动态流条目映射为视频卡片。非视频动态（图文 / 转发 / 直播推荐位）一律返回 null。
 * 结构异常时返回 null 而不是抛异常 —— 一次映射失败不应该让整页白屏。
 */
export function mapDynamicToCard(item: unknown): VideoCard | null {
  try {
    const it = item as {
      type?: string;
      modules?: {
        module_author?: { mid?: unknown; name?: unknown; face?: unknown; pub_ts?: unknown };
        module_dynamic?: {
          major?: { archive?: { bvid?: unknown; title?: unknown; cover?: unknown; duration_text?: unknown; stat?: { play?: unknown; danmaku?: unknown } } };
        };
      };
    };

    if (it?.type !== AV_TYPE) return null;

    const archive = it.modules?.module_dynamic?.major?.archive;
    const author = it.modules?.module_author;

    const bvid = typeof archive?.bvid === 'string' ? archive.bvid : null;
    const upMid = toNumber(author?.mid);
    if (!bvid || !upMid) return null;

    return {
      bvid,
      title: String(archive?.title ?? ''),
      cover: toHttps(String(archive?.cover ?? '')),
      durationText: String(archive?.duration_text ?? ''),
      play: toNumber(archive?.stat?.play),
      danmaku: toNumber(archive?.stat?.danmaku),
      // 时间戳在 author.pub_ts，不在 archive 里
      pubdate: toNumber(author?.pub_ts),
      upMid,
      upName: String(author?.name ?? ''),
      upFace: toHttps(String(author?.face ?? '')),
      url: `https://www.bilibili.com/video/${bvid}`,
    };
  } catch {
    return null;
  }
}
