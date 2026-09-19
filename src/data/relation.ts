import type { BiliTag, TrimmedFollowedUp, SelfInfo } from '../types';

const API = 'https://api.bilibili.com';
const PAGE_SIZE = 50; // B站 未公开 ps 上限，50 是官方文档默认值

/** 复用热身版的 http→https 提升（否则 HTTPS 页面按混合内容拦掉头像） */
function toHttps(url: string): string {
  return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url;
}

function ensureOk(json: { code: number; message?: string }): void {
  if (json.code !== 0) {
    throw new Error(`B站接口返回 ${json.code}：${json.message ?? '未知错误'}`);
  }
}

/** 当前登录用户。nav 接口不需要 WBI 签名（它是取 wbi 密钥的那个接口）。 */
export async function fetchSelf(): Promise<SelfInfo> {
  const res = await fetch(`${API}/x/web-interface/nav`, { credentials: 'include' });
  const json = await res.json();
  ensureOk(json);
  return { mid: Number(json.data.mid), uname: String(json.data.uname ?? '') };
}

/** B站 关注分组列表。tagid -10=特别关注、0=默认分组，两者恒定。 */
export async function fetchTags(): Promise<BiliTag[]> {
  const res = await fetch(`${API}/x/relation/tags`, { credentials: 'include' });
  const json = await res.json();
  ensureOk(json);
  return (json.data ?? []) as BiliTag[];
}

export interface FollowingsPage {
  items: TrimmedFollowedUp[];
  /**
   * 关注总数。**B站 每一页都会返回它**，所以拿它不需要额外请求 ——
   * 用它比"某页不足一页即终止"可靠：服务端对 `ps` 有上限（实测传 100 只给 50），
   * 靠"短页"判断会在服务端截断时提前收工。
   */
  total: number;
}

/**
 * 关注列表单页。**只保留落盘需要的字段** —— B站 原始项还带 sign / vip /
 * official_verify 等，体积是裁剪后的 4-5 倍（设计文档 §15.1）。
 */
export async function fetchFollowings(vmid: number, pn: number): Promise<FollowingsPage> {
  const params = new URLSearchParams({
    vmid: String(vmid),
    pn: String(pn),
    ps: String(PAGE_SIZE),
    order_type: '',
  });
  const res = await fetch(`${API}/x/relation/followings?${params.toString()}`, {
    credentials: 'include',
  });
  const json = await res.json();
  ensureOk(json);

  const raw = (json.data?.list ?? []) as Array<Record<string, unknown>>;
  return {
    items: raw.map((u) => ({
      mid: Number(u.mid),
      uname: String(u.uname ?? ''),
      face: toHttps(String(u.face ?? '')),
      tag: Array.isArray(u.tag) ? (u.tag as number[]) : null,
      special: (u.special === 1 ? 1 : 0) as 0 | 1,
    })),
    total: Number(json.data?.total ?? 0),
  };
}

export const RELATION_PAGE_SIZE = PAGE_SIZE;
