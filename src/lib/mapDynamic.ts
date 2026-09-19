import type { FeedItem } from '../types';
import { parseStatCount } from './parseStat';

/**
 * 按 `major.type` 分派，而不是顶层 `DYNAMIC_TYPE_*`。
 *
 * 2026-09-13 实测的组合：
 * | 顶层 type | major.type | 是什么 |
 * |---|---|---|
 * | DYNAMIC_TYPE_AV | MAJOR_TYPE_ARCHIVE | 视频投稿 |
 * | DYNAMIC_TYPE_DRAW | **MAJOR_TYPE_OPUS** | 图文 / 长文 |
 * | DYNAMIC_TYPE_FORWARD | `null`（内容在 `orig`） | 转发 |
 * | DYNAMIC_TYPE_LIVE_RCMD | MAJOR_TYPE_LIVE_RCMD | B站 插的直播推广位 |
 *
 * 注意图文来的是 **`opus`**，不是 `major.draw` —— 因为请求里带了
 * `features: itemOpusStyle`，B站 直接返回新格式，`draw` 是拿不到的旧格式。
 */
const MAJOR_ARCHIVE = 'MAJOR_TYPE_ARCHIVE';
const MAJOR_OPUS = 'MAJOR_TYPE_OPUS';

/**
 * B站 的图片地址有两种坑：`http://i1.hdslb.com/...` 和协议相对的 `//www...`。
 * 页面跑在 HTTPS 下，两种都会被当成混合内容拦掉（表现为一屏碎图）。
 */
function toHttps(url: string): string {
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http://')) return `https://${url.slice('http://'.length)}`;
  return url;
}

/**
 * 把**纯数字字符串**转成数字。
 *
 * ⚠️ 只用于 `pub_ts` / `mid` / 图片宽高这类普通数值字段。
 * **统计字段（play / danmaku / like…）不能用它** —— 那些是带单位的展示字符串
 * （`"3.4万"`），要用 `parseStatCount`，否则会静默变成 0。
 */
function toPlainNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

interface Author {
  mid?: unknown;
  name?: unknown;
  face?: unknown;
  pub_ts?: unknown;
}

interface Common {
  pubdate: number;
  upMid: number;
  upName: string;
  upFace: string;
  like: number;
}

/** 视频投稿：内容全部在 `major.archive` 里 */
function mapArchive(archive: Record<string, unknown> | undefined, common: Common): FeedItem | null {
  const bvid = str(archive?.bvid);
  if (!bvid) return null;

  const stat = archive?.stat as { play?: unknown; danmaku?: unknown } | undefined;
  const duration = str(archive?.duration_text);

  return {
    // 视频的唯一 id 就是 bvid
    id: bvid,
    kind: 'video',
    title: str(archive?.title),
    cover: toHttps(str(archive?.cover)),
    // 视频封面没有宽高信息（`archive` 里没有），占位交给 CSS 的固定比例
    coverW: 0,
    coverH: 0,
    imageCount: 0,
    durationText: duration || null,
    play: parseStatCount(stat?.play),
    danmaku: parseStatCount(stat?.danmaku),
    ...common,
    url: `https://www.bilibili.com/video/${bvid}`,
  };
}

/**
 * 图文 / 长文：内容在 `major.opus` 里。
 *
 * 实测要点（2026-09-13）：
 *  - `opus.title` **常常是空串**（短图文没有标题），正文在 `summary.text`
 *  - `summary.text` 已经把 emoji 渲染成 `[表情名]` 纯文本，
 *    所以**不需要**去处理 `rich_text_nodes`
 *  - `pics` 可能是空数组（纯文字动态），此时没有封面
 *  - `jump_url` 是协议相对的 `//www.bilibili.com/opus/<id_str>`
 */
function mapOpus(
  opus: Record<string, unknown> | undefined,
  idStr: string,
  common: Common,
): FeedItem | null {
  if (!idStr) return null;

  const pics = Array.isArray(opus?.pics) ? (opus?.pics as Array<Record<string, unknown>>) : [];
  const first = pics[0];

  const title = str(opus?.title).trim();
  const body = str((opus?.summary as { text?: unknown } | undefined)?.text).trim();
  const jump = str(opus?.jump_url);

  return {
    id: idStr,
    kind: 'image',
    // 有标题用标题，没有就用正文（短图文是常态）
    title: title || body,
    cover: toHttps(str(first?.url)),
    coverW: toPlainNumber(first?.width),
    coverH: toPlainNumber(first?.height),
    imageCount: pics.length,
    durationText: null,
    // 图文没有播放量/弹幕这两个概念
    play: 0,
    danmaku: 0,
    ...common,
    url: jump ? toHttps(jump) : `https://www.bilibili.com/opus/${idStr}`,
  };
}

/**
 * 把动态流条目映射成展示用的内容卡片。
 *
 * 不显示的一律返回 `null`：
 *  - **转发**（`major` 为 null，内容在 `orig`）—— 被转发的人往往你并没关注，
 *    这正是本插件想避开的东西；实测某 UP 一页 12 条里 11 条是转发。
 *  - **直播推广位**（`MAJOR_TYPE_LIVE_RCMD`）—— B站 插进关注流的广告。
 *  - 结构损坏的条目 —— 一次映射失败不该让整页白屏，所以返回 null 而不是抛异常。
 */
export function mapDynamicToItem(item: unknown): FeedItem | null {
  try {
    const it = item as {
      id_str?: unknown;
      modules?: {
        module_author?: Author;
        module_dynamic?: {
          major?: { type?: unknown; archive?: Record<string, unknown>; opus?: Record<string, unknown> };
        };
        module_stat?: { like?: { count?: unknown } };
      };
    };

    const author = it?.modules?.module_author;
    const upMid = toPlainNumber(author?.mid);
    if (!upMid) return null;

    const major = it?.modules?.module_dynamic?.major;

    const common: Common = {
      pubdate: toPlainNumber(author?.pub_ts),
      upMid,
      upName: str(author?.name),
      upFace: toHttps(str(author?.face)),
      like: parseStatCount(it?.modules?.module_stat?.like?.count),
    };

    if (major?.type === MAJOR_ARCHIVE) return mapArchive(major.archive, common);
    if (major?.type === MAJOR_OPUS) return mapOpus(major.opus, str(it?.id_str), common);
    return null;
  } catch {
    return null;
  }
}
