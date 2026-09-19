import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchTags, fetchFollowings, fetchSelf } from './relation';
import { rawFollowings, rawTags } from './__fixtures__/relation';

function stubFetch(payload: unknown) {
  const fn = vi.fn().mockResolvedValue({ json: async () => payload });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchSelf', () => {
  it('返回当前登录用户的 mid 与昵称', async () => {
    stubFetch({ code: 0, data: { mid: 293793435, uname: '测试用户' } });
    const self = await fetchSelf();
    expect(self.mid).toBe(293793435);
    expect(self.uname).toBe('测试用户');
  });

  it('未登录时抛出带 message 的错误', async () => {
    stubFetch({ code: -101, message: '账号未登录' });
    await expect(fetchSelf()).rejects.toThrow(/未登录/);
  });
});

describe('fetchTags', () => {
  it('返回分组列表', async () => {
    stubFetch({ code: 0, data: rawTags });
    const tags = await fetchTags();
    expect(tags).toHaveLength(4);
    expect(tags[0]).toEqual({ tagid: -10, name: '特别关注', count: 16 });
  });

  it('data 缺失时返回空数组而不抛异常', async () => {
    stubFetch({ code: 0 });
    expect(await fetchTags()).toEqual([]);
  });

  it('非 0 code 抛错', async () => {
    stubFetch({ code: -101, message: '账号未登录' });
    await expect(fetchTags()).rejects.toThrow(/未登录/);
  });
});

describe('fetchFollowings', () => {
  it('裁剪掉不需要落盘的字段', async () => {
    stubFetch({ code: 0, data: { list: rawFollowings, total: 3 } });
    const { items } = await fetchFollowings(293793435, 1);
    expect(items).toHaveLength(3);
    expect(Object.keys(items[0]).sort()).toEqual(['face', 'mid', 'special', 'tag', 'uname']);
    expect(items[0]).not.toHaveProperty('sign');
    expect(items[0]).not.toHaveProperty('vip');
    expect(items[0]).not.toHaveProperty('official_verify');
  });

  it('带出 total —— 用它判断是否拉全，比"短页即末页"可靠', async () => {
    stubFetch({ code: 0, data: { list: rawFollowings, total: 283 } });
    expect((await fetchFollowings(293793435, 1)).total).toBe(283);
  });

  it('data 缺失时 total 为 0 而不是 NaN', async () => {
    stubFetch({ code: 0 });
    const page = await fetchFollowings(293793435, 1);
    expect(page.total).toBe(0);
    expect(page.items).toEqual([]);
  });

  it('把 http 头像提升为 https', async () => {
    stubFetch({ code: 0, data: { list: rawFollowings, total: 3 } });
    const { items } = await fetchFollowings(293793435, 1);
    expect(items.every((u) => u.face.startsWith('https://'))).toBe(true);
  });

  it('保留 tag 为 null 的语义', async () => {
    stubFetch({ code: 0, data: { list: rawFollowings, total: 3 } });
    const { items } = await fetchFollowings(293793435, 1);
    expect(items[0].tag).toBeNull();
    expect(items[1].tag).toEqual([207542]);
    expect(items[2].tag).toEqual([-10, 194110]);
  });

  it('请求带 vmid/pn/ps 且 credentials 为 include', async () => {
    const fn = stubFetch({ code: 0, data: { list: [], total: 0 } });
    await fetchFollowings(293793435, 2);
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/x/relation/followings');
    expect(url).toContain('vmid=293793435');
    expect(url).toContain('pn=2');
    // ⚠️ ps 必须保持 50：服务端上限就是 50，改成 100 只会拿到 50 条
    expect(url).toContain('ps=50');
    expect(init.credentials).toBe('include');
  });

  it('列表缺失时 items 为空数组', async () => {
    stubFetch({ code: 0 });
    expect((await fetchFollowings(293793435, 1)).items).toEqual([]);
  });
});
