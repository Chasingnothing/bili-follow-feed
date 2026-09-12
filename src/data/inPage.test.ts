import { describe, it, expect, vi, afterEach } from 'vitest';
import { InPageDataSource } from './inPage';
import { avItem, liveRcmdItem } from '../lib/__fixtures__/items';

/** 只 stub 出被测代码用到的 .json()，避免依赖 jsdom 里不存在的 Response */
function stubFetch(payload: unknown) {
  const fn = vi.fn().mockResolvedValue({ json: async () => payload });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('InPageDataSource', () => {
  it('请求正确端点且带 credentials: include', async () => {
    const fn = stubFetch({ code: 0, data: { items: [avItem], has_more: false, offset: '' } });
    const page = await new InPageDataSource().fetchPage(null);

    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/x/polymer/web-dynamic/v1/feed/all');
    expect(init.credentials).toBe('include');
    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(false);
  });

  it('首页请求不带 offset 参数', async () => {
    const fn = stubFetch({ code: 0, data: { items: [], has_more: false } });
    await new InPageDataSource().fetchPage(null);
    // 注意：不能用 not.toContain('offset=') —— timezone_offset=-480 里包含该子串，
    // 那是子串误判，必须解析出真正的查询参数来判断。
    const url = new URL(String(fn.mock.calls[0][0]));
    expect(url.searchParams.has('offset')).toBe(false);
    expect(url.searchParams.get('timezone_offset')).toBe('-480');
  });

  it('把游标透传为查询参数', async () => {
    const fn = stubFetch({ code: 0, data: { items: [], has_more: true, offset: 'next' } });
    await new InPageDataSource().fetchPage('abc123');
    expect(String(fn.mock.calls[0][0])).toContain('offset=abc123');
  });

  it('非 0 code 时抛出带 message 的错误', async () => {
    stubFetch({ code: -352, message: '风控校验失败' });
    await expect(new InPageDataSource().fetchPage(null)).rejects.toThrow(/风控/);
  });

  it('过滤掉直播推荐位', async () => {
    stubFetch({ code: 0, data: { items: [liveRcmdItem], has_more: false } });
    const page = await new InPageDataSource().fetchPage(null);
    expect(page.items).toHaveLength(0);
  });

  it('空字符串 offset 归一化为 null', async () => {
    stubFetch({ code: 0, data: { items: [], has_more: false, offset: '' } });
    const page = await new InPageDataSource().fetchPage(null);
    expect(page.nextOffset).toBeNull();
  });

  it('缺 data 字段时不抛异常', async () => {
    stubFetch({ code: 0 });
    const page = await new InPageDataSource().fetchPage(null);
    expect(page.items).toHaveLength(0);
    expect(page.hasMore).toBe(false);
  });

  it('oldestPubTs 取自全部条目，含非视频的图文', async () => {
    const draw = {
      type: 'DYNAMIC_TYPE_DRAW',
      modules: { module_author: { pub_ts: '1789100000' } },
    };
    stubFetch({ code: 0, data: { items: [avItem, draw], has_more: true, offset: 'o' } });
    const page = await new InPageDataSource().fetchPage(null);
    expect(page.oldestPubTs).toBe(1789100000);
  });

  it('一页全是非视频条目时仍能报出最早时间（否则覆盖判据会失效）', async () => {
    const draw = {
      type: 'DYNAMIC_TYPE_DRAW',
      modules: { module_author: { pub_ts: '1789000000' } },
    };
    stubFetch({ code: 0, data: { items: [draw], has_more: true, offset: 'o' } });
    const page = await new InPageDataSource().fetchPage(null);
    expect(page.items).toHaveLength(0);
    expect(page.oldestPubTs).toBe(1789000000);
  });

  it('无任何条目时 oldestPubTs 为 0（调用方据此判定到头了）', async () => {
    stubFetch({ code: 0, data: { items: [], has_more: true, offset: 'o' } });
    expect((await new InPageDataSource().fetchPage(null)).oldestPubTs).toBe(0);
  });
});
