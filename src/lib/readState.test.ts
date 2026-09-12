import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  loadRead,
  saveRead,
  markRead,
  markAllRead,
  loadLastVisit,
  saveLastVisit,
  MAX_READ,
} from './readState';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

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

  it('数组中混入非字符串时被过滤', () => {
    localStorage.setItem('bff:readVideos', JSON.stringify(['BV1', 42, null, 'BV2']));
    const s = loadRead();
    expect(s.size).toBe(2);
    expect(s.has('BV1')).toBe(true);
    expect(s.has('BV2')).toBe(true);
  });
});

describe('readVideos 上限（设计文档 §15.2）', () => {
  it('导出上限常量', () => expect(MAX_READ).toBe(3000));

  it('超过上限时丢弃最早的，保留最新的', () => {
    const many = Array.from({ length: MAX_READ + 10 }, (_, i) => `BV${i}`);
    saveRead(new Set(many));
    const s = loadRead();
    expect(s.size).toBe(MAX_READ);
    expect(s.has('BV0')).toBe(false); // 最早的被丢
    expect(s.has('BV9')).toBe(false);
    expect(s.has('BV10')).toBe(true); // 边界：保留的第一条
    expect(s.has(`BV${MAX_READ + 9}`)).toBe(true); // 最新的一条
  });

  it('未达上限时全部保留', () => {
    const some = Array.from({ length: 10 }, (_, i) => `BV${i}`);
    saveRead(new Set(some));
    expect(loadRead().size).toBe(10);
    expect(loadRead().has('BV0')).toBe(true);
  });

  it('落盘保持插入顺序，丢弃的确实是最早的', () => {
    const s = new Set<string>();
    for (let i = 0; i < MAX_READ + 5; i++) s.add(`BV${i}`);
    saveRead(s);
    const stored = JSON.parse(localStorage.getItem('bff:readVideos')!) as string[];
    expect(stored).toHaveLength(MAX_READ);
    expect(stored[0]).toBe('BV5');
    expect(stored[stored.length - 1]).toBe(`BV${MAX_READ + 4}`);
  });
});

describe('写入失败要能被调用方感知（设计文档 §15.3）', () => {
  it('saveRead 成功返回 true', () => expect(saveRead(new Set(['BV1']))).toBe(true));

  it('saveRead 配额写满返回 false 而不抛异常', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(saveRead(new Set(['BV1']))).toBe(false);
  });

  it('saveLastVisit 成功返回 true', () => expect(saveLastVisit(1)).toBe(true));

  it('saveLastVisit 写失败返回 false', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(saveLastVisit(1)).toBe(false);
  });
});
