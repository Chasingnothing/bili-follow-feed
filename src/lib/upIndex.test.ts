import { describe, it, expect } from 'vitest';
import { buildUpIndex, biliGroupIdsOf, SPECIAL_ID, UNCATEGORIZED_ID } from './upIndex';
import { rawFollowings } from '../data/__fixtures__/relation';
import type { TrimmedFollowedUp } from '../types';

function up(partial: Partial<TrimmedFollowedUp>): TrimmedFollowedUp {
  return { mid: 1, uname: 'x', face: 'https://x', tag: null, special: 0, ...partial };
}

const list: TrimmedFollowedUp[] = rawFollowings.map((u) => ({
  mid: u.mid,
  uname: u.uname,
  face: u.face.replace('http://', 'https://'),
  tag: u.tag,
  special: u.special as 0 | 1,
}));

describe('biliGroupIdsOf', () => {
  it('tag 为 null → 只有未分类', () => {
    expect(biliGroupIdsOf(list[0])).toEqual([UNCATEGORIZED_ID]);
  });

  it('tag 为数组 → 映射为 bili-<tagid>', () => {
    expect(biliGroupIdsOf(list[1])).toEqual(['bili-207542']);
  });

  it('-10 映射为 special，与其他分组并存', () => {
    expect(biliGroupIdsOf(list[2])).toEqual([SPECIAL_ID, 'bili-194110']);
  });

  it('tag 为空数组 → 未分类', () => {
    expect(biliGroupIdsOf(up({ tag: [] }))).toEqual([UNCATEGORIZED_ID]);
  });

  // 设计文档 §14 的待确认项：用防御性写法覆盖两种真实情况
  it('tag 含 tagid=0 且含自定义分组时忽略 0', () => {
    expect(biliGroupIdsOf(up({ tag: [0, 207542] }))).toEqual(['bili-207542']);
  });

  it('tag 只有 tagid=0 时视为未分类', () => {
    expect(biliGroupIdsOf(up({ tag: [0] }))).toEqual([UNCATEGORIZED_ID]);
  });

  it('tag 含 0 与 -10 时只保留 special', () => {
    expect(biliGroupIdsOf(up({ tag: [0, -10] }))).toEqual([SPECIAL_ID]);
  });
});

describe('buildUpIndex', () => {
  it('建立 mid → UpInfo 的索引', () => {
    const idx = buildUpIndex(list);
    expect(idx['14082'].name).toBe('山新');
    expect(idx['420831218'].name).toBe('支付宝Alipay');
  });

  it('special 字段为 1 时 isSpecial 为 true', () => {
    expect(buildUpIndex(list)['53456'].isSpecial).toBe(true);
    expect(buildUpIndex(list)['14082'].isSpecial).toBe(false);
  });

  it('tag 含 -10 但 special 字段为 0 时仍视为特别关注', () => {
    const idx = buildUpIndex([up({ mid: 9, tag: [-10], special: 0 })]);
    expect(idx['9'].isSpecial).toBe(true);
  });

  it('保留 face 且已是 https', () => {
    expect(buildUpIndex(list)['14082'].face.startsWith('https://')).toBe(true);
  });

  it('空列表返回空索引而不抛异常', () => {
    expect(buildUpIndex([])).toEqual({});
  });
});
