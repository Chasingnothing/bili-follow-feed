import { describe, it, expect } from 'vitest';
import { groupFollowings } from './groupMembership';
import type { Group } from './localGroups';
import type { TrimmedFollowedUp } from '../types';

function up(mid: number): TrimmedFollowedUp {
  return { mid, uname: `u${mid}`, face: '', tag: null, special: 0 };
}

function group(id: string, order = 0): Group {
  return { id, name: id, order, kind: 'normal', source: 'local' };
}

const GROUPS = [group('g1', 1), group('g2', 2)];
const FOLLOWINGS = [up(1), up(2), up(3), up(4)];

describe('groupFollowings', () => {
  it('没有 membership 的 UP 进未分类', () => {
    const m = groupFollowings(GROUPS, {}, FOLLOWINGS);
    expect(m.get('uncategorized')!.map((u) => u.mid)).toEqual([1, 2, 3, 4]);
  });

  it('一个 UP 属于多个分组时在每个分组里都出现', () => {
    const m = groupFollowings(GROUPS, { '1': ['g1', 'g2'] }, FOLLOWINGS);
    expect(m.get('g1')!.map((u) => u.mid)).toEqual([1]);
    expect(m.get('g2')!.map((u) => u.mid)).toEqual([1]);
    expect(m.get('uncategorized')!.map((u) => u.mid)).toEqual([2, 3, 4]);
  });

  it('membership 为空数组时按未分类处理', () => {
    const m = groupFollowings(GROUPS, { '1': [] }, FOLLOWINGS);
    expect(m.get('uncategorized')!.map((u) => u.mid)).toEqual([1, 2, 3, 4]);
  });

  it('⚠️ 脏引用（指向已删除的分组）归未分类，而不是让 UP 消失', () => {
    const m = groupFollowings(GROUPS, { '1': ['已经删掉的分组'] }, FOLLOWINGS);
    expect(m.get('uncategorized')!.map((u) => u.mid)).toEqual([1, 2, 3, 4]);
    const total = [...m.values()].reduce((n, l) => n + l.length, 0);
    expect(total).toBe(ANSWER_TOTAL);
  });

  it('空分组也会有一个空数组（UI 要显示占位）', () => {
    const m = groupFollowings(GROUPS, { '1': ['g1'] }, [up(1)]);
    expect(m.get('g2')).toEqual([]);
  });

  it('未分类桶一定存在，即使不在 groups 里', () => {
    const m = groupFollowings([group('g1')], {}, []);
    expect(m.has('uncategorized')).toBe(true);
    expect(m.get('uncategorized')).toEqual([]);
  });

  it('UP 总数不因归类而丢失（每个 UP 至少出现在一个分组）', () => {
    const m = groupFollowings(GROUPS, { '1': ['g1'], '2': ['g2'] }, FOLLOWINGS);
    const total = [...m.values()].reduce((n, l) => n + l.length, 0);
    expect(total).toBe(FOLLOWINGS.length);
  });
});

/** 4 个 UP、无重复归属时的总数 */
const ANSWER_TOTAL = 4;
