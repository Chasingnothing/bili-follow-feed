import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadRead,
  saveRead,
  markRead,
  markAllRead,
  loadLastVisit,
  saveLastVisit,
} from './readState';

beforeEach(() => localStorage.clear());

describe('readState', () => {
  it('初始为空集合', () => expect(loadRead().size).toBe(0));

  it('markRead 后持久化', () => {
    saveRead(markRead(loadRead(), 'BV1'));
    expect(loadRead().has('BV1')).toBe(true);
  });

  it('markRead 不修改传入的集合', () => {
    const original = new Set(['BV1']);
    const next = markRead(original, 'BV2');
    expect(original.has('BV2')).toBe(false);
    expect(next.has('BV2')).toBe(true);
  });

  it('markAllRead 批量写入', () => {
    saveRead(markAllRead(['BV1', 'BV2']));
    expect(loadRead().size).toBe(2);
  });

  it('lastVisit 往返一致', () => {
    saveLastVisit(123);
    expect(loadLastVisit()).toBe(123);
  });

  it('未写入时 lastVisit 为 0', () => expect(loadLastVisit()).toBe(0));

  it('JSON 损坏时不抛异常并返回空集合', () => {
    localStorage.setItem('bff:readVideos', '{not json');
    expect(loadRead().size).toBe(0);
  });

  it('存的是非数组时不抛异常', () => {
    localStorage.setItem('bff:readVideos', '{"a":1}');
    expect(loadRead().size).toBe(0);
  });

  it('lastVisit 是脏数据时返回 0', () => {
    localStorage.setItem('bff:lastVisitAt', 'abc');
    expect(loadLastVisit()).toBe(0);
  });
});
