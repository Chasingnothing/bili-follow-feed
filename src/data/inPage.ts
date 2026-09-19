import type { FeedDataSource } from './source';
import type { FeedPage, FeedItem } from '../types';
import { mapDynamicToItem } from '../lib/mapDynamic';

const ALL_ENDPOINT = 'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all';
/**
 * 单个 UP 的动态流。
 *
 * **2026-09 实测：不需要 WBI 签名**（`code = 0`）。这很关键 —— 同族的
 * `x/space/wbi/arc/search` 强制要 `w_rid`/`wts`，缺了直接 412，本来以为
 * "逐个 UP 拉最新"必须实现 WBI + MD5（浏览器 WebCrypto 故意不提供 MD5），
 * 实测发现这扇门是免费的。
 *
 * 实测（2026-09-13 探针）：一页 **12 条**（`feed/all` 是 20，两个接口不同），
 * item 结构与 `feed/all` **完全一致**，所以 `mapDynamicToItem` 原样复用。
 * 未关注的 UP **也能拉**，所以"已取关但留在本地分组里"的人不受影响。
 */
const SPACE_ENDPOINT = 'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space';

interface RawFeedResponse {
  code: number;
  message?: string;
  data?: { items?: unknown[]; offset?: string; has_more?: boolean };
}

/** `feed/all` 与 `feed/space` 的响应结构相同，解析只写一份 */
export function parseFeedPage(json: RawFeedResponse): FeedPage {
  if (json.code !== 0) {
    throw new Error(`B站接口返回 ${json.code}：${json.message ?? '未知错误'}`);
  }

  const raw = (json.data?.items ?? []) as Array<{
    modules?: { module_author?: { pub_ts?: unknown } };
  }>;

  const items = raw.map(mapDynamicToItem).filter((c): c is FeedItem => c !== null);

  // 覆盖范围的判据取自**全部**条目（含被过滤掉的转发/直播推广位），不能只看卡片：
  // 一页可能一条可显示的内容都没有，那时无从判断翻到了哪个时间点，
  // 「翻到覆盖 N 天」的停止条件会失效。
  let oldest = Number.POSITIVE_INFINITY;
  for (const it of raw) {
    const ts = Number(it.modules?.module_author?.pub_ts ?? 0);
    if (ts > 0 && ts < oldest) oldest = ts;
  }

  return {
    items,
    // 空字符串归一化为 null，避免前端把 "" 当成有效游标
    nextOffset: json.data?.offset ? json.data.offset : null,
    hasMore: Boolean(json.data?.has_more),
    oldestPubTs: Number.isFinite(oldest) ? oldest : 0,
  };
}

/**
 * 站内数据源：脚本运行在 bilibili.com 域下，请求 api.bilibili.com 时会
 * 自动携带登录态 Cookie，且 CORS 放行（B站 自家前端即如此调用）。
 * 因此不需要后端、不需要导出 Cookie、不需要 WBI 签名。
 */
export class InPageDataSource implements FeedDataSource {
  /** 全局关注动态流（所有关注的人混在一起，是"最近窗口"） */
  async fetchPage(offset: string | null): Promise<FeedPage> {
    const params = new URLSearchParams({
      type: 'all',
      page: '1',
      timezone_offset: '-480',
      platform: 'web',
      web_location: '333.1387',
      features: 'itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote',
    });
    if (offset) params.set('offset', offset);

    const res = await fetch(`${ALL_ENDPOINT}?${params.toString()}`, { credentials: 'include' });
    return parseFeedPage((await res.json()) as RawFeedResponse);
  }

  /**
   * 单个 UP 的动态流（模式 2 用）。
   *
   * ⚠️ `offset` 是**键值游标**（本页最后一条的 `id_str`），19 位、超过 JS 安全整数，
   * **必须全程当字符串**，绝不能 `Number()` 它。
   */
  async fetchUpSpace(mid: number, offset: string | null): Promise<FeedPage> {
    const params = new URLSearchParams({
      host_mid: String(mid),
      timezone_offset: '-480',
      platform: 'web',
      features: 'itemOpusStyle',
    });
    if (offset) params.set('offset', offset);

    const res = await fetch(`${SPACE_ENDPOINT}?${params.toString()}`, { credentials: 'include' });
    return parseFeedPage((await res.json()) as RawFeedResponse);
  }
}
