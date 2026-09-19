import { describe, it, expect } from 'vitest';
import { MAX_LAYER, buildUpSections, clampLayer } from './upSections';
import type { Group } from './localGroups';
import type { FeedItem, TrimmedFollowedUp } from '../types';

function up(mid: number): TrimmedFollowedUp {
  return { mid, uname: `u${mid}`, face: '', tag: null, special: 0 };
}

function group(id: string, order: number): Group {
  return { id, name: id, order, kind: 'normal', source: 'local' };
}

function item(id: string, upMid: number, pubdate: number): FeedItem {
  return {
    id,
    kind: 'video',
    title: id,
    cover: '',
    coverW: 0,
    coverH: 0,
    imageCount: 0,
    durationText: null,
    play: 0,
    danmaku: 0,
    like: 0,
    pubdate,
    upMid,
    upName: `u${upMid}`,
    upFace: '',
    url: '',
  };
}

const GROUPS = [group('g1', 1), group('g2', 2)];
const FOLLOWINGS = [up(10), up(20), up(30)];
const MEMBERSHIP = { '10': ['g1'], '20': ['g1'], '30': ['g2'] };

/** mid=10 有 3 条，mid=20 有 1 条，mid=30 没有 */
function cacheFixture(): Map<number, FeedItem[]> {
  return new Map<number, FeedItem[]>([
    [10, [item('a1', 10, 300), item('a2', 10, 200), item('a3', 10, 100)]],
    [20, [item('b1', 20, 250)]],
  ]);
}

const base = { groups: GROUPS, membership: MEMBERSHIP, followings: FOLLOWINGS };

describe('clampLayer', () => {
  it('缺省 / 非法值当 1', () => {
    expect(clampLayer(undefined)).toBe(1);
    expect(clampLayer(null)).toBe(1);
    expect(clampLayer('abc')).toBe(1);
    expect(clampLayer(0)).toBe(1);
    expect(clampLayer(-3)).toBe(1);
  });

  it(`夹在 1..${MAX_LAYER}`, () => {
    expect(clampLayer(3)).toBe(3);
    expect(clampLayer(99)).toBe(MAX_LAYER);
    expect(clampLayer(2.7)).toBe(2);
  });
});

describe('buildUpSections', () => {
  it('按 order 排出板块', () => {
    const s = buildUpSections({ ...base, layers: {}, cache: new Map() });
    expect(s.map((x) => x.group.id)).toEqual(['g1', 'g2']);
  });

  it('未分类和隐藏不产出板块', () => {
    const s = buildUpSections({
      ...base,
      groups: [...GROUPS, group('uncategorized', 9980), group('hidden', 9990)],
      layers: {},
      cache: new Map(),
    });
    expect(s.map((x) => x.group.id)).toEqual(['g1', 'g2']);
  });

  it('默认层数是 1：每个 UP 只贡献最新那条', () => {
    const s = buildUpSections({ ...base, layers: {}, cache: cacheFixture() });
    expect(s[0].layer).toBe(1);
    // g1 里 mid=10 只出 a1、mid=20 只出 b1
    expect(s[0].items.map((i) => i.id).sort()).toEqual(['a1', 'b1']);
  });

  it('层数 2 时每个 UP 贡献两条（有多少给多少）', () => {
    const s = buildUpSections({ ...base, layers: { g1: 2 }, cache: cacheFixture() });
    expect(s[0].items.map((i) => i.id).sort()).toEqual(['a1', 'a2', 'b1']);
  });

  it('缓存里不够层数的 UP 就贡献它有的（不会报错或补空）', () => {
    const s = buildUpSections({ ...base, layers: { g1: 3 }, cache: cacheFixture() });
    // mid=10 有 3 条、mid=20 只有 1 条
    expect(s[0].items).toHaveLength(4);
  });

  it('计数器：分子是有缓存的 UP 数，分母是该板块全部 UP 数', () => {
    const s = buildUpSections({ ...base, layers: {}, cache: cacheFixture() });
    // g1 有 2 个 UP，两个都有缓存
    expect(s[0].ups).toHaveLength(2);
    expect(s[0].cachedCount).toBe(2);
    // g2 有 1 个 UP，没有缓存
    expect(s[1].ups).toHaveLength(1);
    expect(s[1].cachedCount).toBe(0);
    expect(s[1].items).toEqual([]);
  });

  it('整个板块没有缓存时也产出板块（否则用户以为分组丢了）', () => {
    const s = buildUpSections({ ...base, layers: {}, cache: new Map() });
    expect(s).toHaveLength(2);
    expect(s.every((x) => x.items.length === 0)).toBe(true);
    expect(s.every((x) => x.cachedCount === 0)).toBe(true);
  });

  it('传入 collator 时全局统一排序（层与层之间按时间穿插）', () => {
    const s = buildUpSections({
      ...base,
      layers: { g1: 2 },
      cache: cacheFixture(),
      collator: (a, b) => b.pubdate - a.pubdate,
    });
    // a1(300) b1(250) a2(200)
    expect(s[0].items.map((i) => i.id)).toEqual(['a1', 'b1', 'a2']);
  });

  it('层数只裁剪每个 UP 的贡献，不影响计数器的分母', () => {
    const one = buildUpSections({ ...base, layers: { g1: 1 }, cache: cacheFixture() });
    const three = buildUpSections({ ...base, layers: { g1: 3 }, cache: cacheFixture() });
    expect(one[0].ups).toHaveLength(three[0].ups.length);
    expect(one[0].cachedCount).toBe(three[0].cachedCount);
  });

  it('一个 UP 属于多个分组时，两个板块里都能看到他的内容', () => {
    const s = buildUpSections({
      groups: GROUPS,
      membership: { '10': ['g1', 'g2'] },
      followings: [up(10)],
      layers: {},
      cache: new Map([[10, [item('a1', 10, 1)]]]),
    });
    expect(s[0].items.map((i) => i.id)).toEqual(['a1']);
    expect(s[1].items.map((i) => i.id)).toEqual(['a1']);
  });
});
