import { describe, it, expect, beforeEach } from 'vitest';
import {
  MAX_PER_UP,
  MAX_UPS,
  cachedMids,
  cachedUsage,
  clearUpItems,
  expandItem,
  fetchedAt,
  loadUpItems,
  pickEvictions,
  saveUpItems,
  slimItem,
  touchUp,
} from './upVideoCache';
import type { FeedItem } from '../types';

function item(id: string, over: Partial<FeedItem> = {}): FeedItem {
  return {
    id,
    kind: 'video',
    title: `t-${id}`,
    cover: 'https://x',
    coverW: 0,
    coverH: 0,
    imageCount: 0,
    durationText: '1:00',
    play: 10,
    danmaku: 1,
    like: 2,
    pubdate: 1000,
    upMid: 42,
    upName: '某个UP',
    upFace: 'https://f',
    url: `https://www.bilibili.com/video/${id}`,
    ...over,
  };
}

beforeEach(() => localStorage.clear());

describe('瘦身与展开', () => {
  it('slimItem 去掉 upMid 和 url（可由 key / id 推导）', () => {
    const s = slimItem(item('BV1'));
    expect(s).not.toHaveProperty('upMid');
    expect(s).not.toHaveProperty('url');
  });

  it('slimItem 保留名字和头像 —— 已取关的 UP 不在 upIndex 里，去掉就没名字了', () => {
    const s = slimItem(item('BV1'));
    expect(s.upName).toBe('某个UP');
    expect(s.upFace).toBe('https://f');
  });

  it('expandItem 把 mid 从 key 补回、url 从 id+kind 推回', () => {
    const back = expandItem(42, slimItem(item('BV1')));
    expect(back.upMid).toBe(42);
    expect(back.url).toBe('https://www.bilibili.com/video/BV1');
  });

  it('图文的 url 推导成 opus 地址', () => {
    const img = item('123456', { kind: 'image' });
    expect(expandItem(7, slimItem(img)).url).toBe('https://www.bilibili.com/opus/123456');
  });

  it('存→读一轮后字段完整', () => {
    saveUpItems(42, [item('BV1')], 1000);
    const [back] = loadUpItems(42);
    expect(back.id).toBe('BV1');
    expect(back.upMid).toBe(42);
    expect(back.url).toBe('https://www.bilibili.com/video/BV1');
    expect(back.title).toBe('t-BV1');
    expect(back.play).toBe(10);
    expect(back.like).toBe(2);
  });
});

describe('saveUpItems', () => {
  it(`每个 UP 只留最新 ${MAX_PER_UP} 条`, () => {
    const many = Array.from({ length: 8 }, (_, i) => item(`BV${i}`));
    saveUpItems(42, many, 1000);
    const got = loadUpItems(42);
    expect(got).toHaveLength(MAX_PER_UP);
    expect(got.map((c) => c.id)).toEqual(['BV0', 'BV1', 'BV2', 'BV3', 'BV4']);
  });

  it('重复保存同一个 UP 是覆盖，不是追加', () => {
    saveUpItems(42, [item('BV1')], 1000);
    saveUpItems(42, [item('BV2')], 2000);
    expect(loadUpItems(42).map((c) => c.id)).toEqual(['BV2']);
    expect(cachedMids()).toEqual([42]);
  });

  it('写入失败时返回 false（配额满）', () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota');
    };
    try {
      expect(saveUpItems(42, [item('BV1')], 1000)).toBe(false);
    } finally {
      Storage.prototype.setItem = orig;
    }
  });
});

describe('cachedMids / fetchedAt', () => {
  it('只读 key 名就能列出已缓存的 UP', () => {
    saveUpItems(11, [item('A')], 1000);
    saveUpItems(22, [item('B')], 1000);
    expect(cachedMids().sort((a, b) => a - b)).toEqual([11, 22]);
  });

  it('其它键不会被误认成 UP 缓存', () => {
    localStorage.setItem('bff:feedCache', '{}');
    localStorage.setItem('bff:upLayers', '{}');
    saveUpItems(33, [item('C')], 1000);
    expect(cachedMids()).toEqual([33]);
  });

  it('fetchedAt 反映上次发请求的时间；没拉过是 0', () => {
    expect(fetchedAt(42)).toBe(0);
    saveUpItems(42, [item('BV1')], 1234);
    expect(fetchedAt(42)).toBe(1234);
  });

  it('数据损坏时当作没有，不抛异常', () => {
    localStorage.setItem('bff:up:42', '{ 坏掉的 json');
    expect(loadUpItems(42)).toEqual([]);
    expect(fetchedAt(42)).toBe(0);
  });

  it('形状不对（不是对象 / 没有 cards）也当作没有', () => {
    localStorage.setItem('bff:up:42', JSON.stringify([1, 2, 3]));
    expect(loadUpItems(42)).toEqual([]);
    localStorage.setItem('bff:up:43', JSON.stringify({ at: 1 }));
    expect(loadUpItems(43)).toEqual([]);
  });
});

describe('pickEvictions（纯函数）', () => {
  it('没超上限就不淘汰', () => {
    expect(pickEvictions([{ mid: 1, lastUsedAt: 10 }], 5)).toEqual([]);
  });

  it('按 lastUsedAt 从旧到新淘汰', () => {
    const entries = [
      { mid: 1, lastUsedAt: 300 },
      { mid: 2, lastUsedAt: 100 },
      { mid: 3, lastUsedAt: 200 },
    ];
    expect(pickEvictions(entries, 2)).toEqual([2]);
    expect(pickEvictions(entries, 1)).toEqual([2, 3]);
  });

  it('时间相同时按 mid 排，结果稳定（否则同一输入可能给不同答案）', () => {
    const entries = [
      { mid: 9, lastUsedAt: 100 },
      { mid: 3, lastUsedAt: 100 },
      { mid: 7, lastUsedAt: 100 },
    ];
    expect(pickEvictions(entries, 1)).toEqual([3, 7]);
    expect(pickEvictions(entries, 1)).toEqual(pickEvictions([...entries].reverse(), 1));
  });

  it('不修改入参', () => {
    const entries = [
      { mid: 1, lastUsedAt: 300 },
      { mid: 2, lastUsedAt: 100 },
    ];
    pickEvictions(entries, 1);
    expect(entries[0].mid).toBe(1);
  });
});

describe('容量上限（超了要淘汰最久没用过的）', () => {
  it(`超过 ${MAX_UPS} 个 UP 时淘汰最旧的，且总数不增长`, () => {
    // 造满上限，lastUsedAt 递增，所以 0 号是最久没用过的
    for (let i = 0; i < MAX_UPS; i++) saveUpItems(1000 + i, [item(`BV${i}`)], 1000 + i);
    expect(cachedMids()).toHaveLength(MAX_UPS);

    saveUpItems(99999, [item('BVnew')], 999_999);

    const mids = cachedMids();
    expect(mids).toHaveLength(MAX_UPS);
    expect(mids).toContain(99999);
    // 最旧的那个 1000 被挤掉
    expect(mids).not.toContain(1000);
  });
});

describe('touchUp（揭示缓存时更新使用时间）', () => {
  it('更新 lastUsedAt，但不动 at（at 代表"上次发请求"，语义不同）', () => {
    saveUpItems(42, [item('BV1')], 1000);
    touchUp(42, 5000);
    const e = cachedUsage().find((x) => x.mid === 42)!;
    expect(e.lastUsedAt).toBe(5000);
    expect(fetchedAt(42)).toBe(1000);
  });

  it('对没缓存过的 UP 调用是空操作，不创建条目', () => {
    touchUp(42, 5000);
    expect(cachedMids()).toEqual([]);
  });

  it('被 touch 过的 UP 在淘汰时更安全', () => {
    saveUpItems(1, [item('A')], 1000);
    saveUpItems(2, [item('B')], 2000);
    // 1 号虽然"发请求"更早，但刚被用过
    touchUp(1, 9000);
    const usage = cachedUsage();
    expect(pickEvictions(usage, 1)).toEqual([2]);
  });
});

describe('clearUpItems', () => {
  it('清掉所有 UP 缓存并返回数量，不影响其它键', () => {
    saveUpItems(1, [item('A')], 1000);
    saveUpItems(2, [item('B')], 1000);
    localStorage.setItem('bff:feedCache', '{}');

    expect(clearUpItems()).toBe(2);
    expect(cachedMids()).toEqual([]);
    expect(localStorage.getItem('bff:feedCache')).toBe('{}');
  });
});
