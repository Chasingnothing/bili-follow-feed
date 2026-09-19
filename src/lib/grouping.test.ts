import { describe, it, expect } from 'vitest';
import { buildSections } from './grouping';
import type { Group } from './localGroups';
import type { FeedItem } from '../types';

function card(id: string, upMid: number, pubdate = 1000): FeedItem {
  return {
    id,
    kind: 'video',
    title: `t-${id}`,
    cover: 'https://x',
    coverW: 0,
    coverH: 0,
    imageCount: 0,
    durationText: '1:00',
    play: 1,
    danmaku: 0,
    like: 0,
    pubdate,
    upMid,
    upName: `up${upMid}`,
    upFace: 'https://x',
    url: `https://www.bilibili.com/video/${id}`,
  };
}

function group(id: string, order: number, kind: 'system' | 'normal' = 'normal'): Group {
  return { id, name: id, order, kind, source: 'local' };
}

const SPECIAL = group('special', 0, 'system');
const MOVIE = group('bili-1', 10);
const TECH = group('bili-2', 11);
const UNCAT = group('uncategorized', 9999, 'system');

describe('buildSections', () => {
  it('按 UP 的本地分组归入对应板块', () => {
    const sections = buildSections(
      [card('BV1', 101), card('BV2', 202)],
      [SPECIAL, MOVIE, TECH, UNCAT],
      { '101': ['bili-1'], '202': ['bili-2'] },
    );
    const byId = Object.fromEntries(sections.map((s) => [s.group.id, s.items.map((v) => v.id)]));
    expect(byId['bili-1']).toEqual(['BV1']);
    expect(byId['bili-2']).toEqual(['BV2']);
    expect(byId['uncategorized']).toEqual([]);
  });

  it('多归属的 UP 在多个板块都出现', () => {
    const sections = buildSections(
      [card('BV1', 101)],
      [SPECIAL, MOVIE, TECH, UNCAT],
      { '101': ['special', 'bili-1'] },
    );
    const byId = Object.fromEntries(sections.map((s) => [s.group.id, s.items.length]));
    expect(byId['special']).toBe(1);
    expect(byId['bili-1']).toBe(1);
    expect(byId['bili-2']).toBe(0);
  });

  it('membership 里没有的 UP 归入未分类', () => {
    const sections = buildSections([card('BV1', 999)], [SPECIAL, UNCAT], {});
    expect(sections.find((s) => s.group.id === 'uncategorized')?.items).toHaveLength(1);
  });

  it('membership 为空数组时归入未分类', () => {
    const sections = buildSections([card('BV1', 101)], [UNCAT], { '101': [] });
    expect(sections[0].items).toHaveLength(1);
  });

  it('指向已删除分组的脏引用归入未分类，视频不丢失', () => {
    const sections = buildSections([card('BV1', 101)], [SPECIAL, UNCAT], {
      '101': ['bili-deleted'],
    });
    expect(sections.find((s) => s.group.id === 'uncategorized')?.items[0].id).toBe('BV1');
  });

  it('没有视频的分组仍然产出 Section', () => {
    const sections = buildSections([], [SPECIAL, MOVIE, TECH, UNCAT], {});
    expect(sections).toHaveLength(4);
    expect(sections.every((s) => s.items.length === 0)).toBe(true);
  });

  it('按 order 排序：special 最前、uncategorized 最后', () => {
    const sections = buildSections([], [UNCAT, TECH, SPECIAL, MOVIE], {});
    expect(sections.map((s) => s.group.id)).toEqual(['special', 'bili-1', 'bili-2', 'uncategorized']);
  });

  it('传入乱序的 groups 也不影响结果', () => {
    const a = buildSections([], [SPECIAL, MOVIE, UNCAT], {});
    const b = buildSections([], [UNCAT, MOVIE, SPECIAL], {});
    expect(a.map((s) => s.group.id)).toEqual(b.map((s) => s.group.id));
  });

  it('不修改传入的 groups 数组', () => {
    const groups = [UNCAT, TECH, SPECIAL, MOVIE];
    const snapshot = groups.map((g) => g.id);
    buildSections([], groups, {});
    expect(groups.map((g) => g.id)).toEqual(snapshot);
  });

  it('传入 collator 时板块内排序生效', () => {
    const sections = buildSections(
      [card('BV1', 101, 100), card('BV2', 101, 300), card('BV3', 101, 200)],
      [UNCAT],
      { '101': ['uncategorized'] },
      (a, b) => b.pubdate - a.pubdate,
    );
    expect(sections[0].items.map((v) => v.id)).toEqual(['BV2', 'BV3', 'BV1']);
  });

  it('不传 collator 时保持输入顺序', () => {
    const sections = buildSections([card('BV1', 101, 100), card('BV2', 101, 300)], [UNCAT], {
      '101': ['uncategorized'],
    });
    expect(sections[0].items.map((v) => v.id)).toEqual(['BV1', 'BV2']);
  });

  it('空 groups 返回空数组', () => {
    expect(buildSections([card('BV1', 101)], [], {})).toEqual([]);
  });
});
