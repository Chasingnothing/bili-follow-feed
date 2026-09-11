import type { FeedDataSource } from './source';
import type { FeedPage, VideoCard } from '../types';
import { mapDynamicToCard } from '../lib/mapDynamic';

const ENDPOINT = 'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all';

/**
 * 站内数据源：脚本运行在 bilibili.com 域下，请求 api.bilibili.com 时会
 * 自动携带登录态 Cookie，且 CORS 放行（B站 自家前端即如此调用）。
 * 因此不需要后端、不需要导出 Cookie、不需要 WBI 签名。
 */
export class InPageDataSource implements FeedDataSource {
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

    const res = await fetch(`${ENDPOINT}?${params.toString()}`, { credentials: 'include' });
    const json = (await res.json()) as {
      code: number;
      message?: string;
      data?: { items?: unknown[]; offset?: string; has_more?: boolean };
    };

    if (json.code !== 0) {
      throw new Error(`B站接口返回 ${json.code}：${json.message ?? '未知错误'}`);
    }

    const items = (json.data?.items ?? [])
      .map(mapDynamicToCard)
      .filter((c): c is VideoCard => c !== null);

    return {
      items,
      // 空字符串归一化为 null，避免前端把 "" 当成有效游标
      nextOffset: json.data?.offset ? json.data.offset : null,
      hasMore: Boolean(json.data?.has_more),
    };
  }
}
