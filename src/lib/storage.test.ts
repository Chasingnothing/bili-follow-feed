import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readJson, writeJson, removeKey, bffUsage, needsMigration, markMigrated, SCHEMA_VERSION } from './storage';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('readJson', () => {
  it('键缺失时返回 fallback', () => expect(readJson('x', 42)).toBe(42));

  it('JSON 损坏时返回 fallback 而不抛异常', () => {
    localStorage.setItem('x', '{not json');
    expect(readJson('x', 42)).toBe(42);
  });

  it('正常往返', () => {
    localStorage.setItem('x', JSON.stringify({ a: 1 }));
    expect(readJson('x', null)).toEqual({ a: 1 });
  });

  it('存的是 null 时返回 null 而不是 fallback', () => {
    localStorage.setItem('x', 'null');
    expect(readJson('x', 42)).toBeNull();
  });
});

describe('writeJson', () => {
  it('成功返回 true', () => expect(writeJson('x', { a: 1 })).toBe(true));

  it('成功时真的写进去了', () => {
    writeJson('x', [1, 2]);
    expect(localStorage.getItem('x')).toBe('[1,2]');
  });

  it('配额写满返回 false 且不抛异常', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(writeJson('x', { a: 1 })).toBe(false);
  });
});

describe('removeKey', () => {
  it('删除键', () => {
    localStorage.setItem('x', '1');
    removeKey('x');
    expect(localStorage.getItem('x')).toBeNull();
  });

  it('删除不存在的键不抛异常', () => {
    expect(() => removeKey('nope')).not.toThrow();
  });
});

describe('bffUsage', () => {
  it('只统计 bff: 前缀的键', () => {
    localStorage.setItem('bff:a', '12345'); // 5 + 5 = 10
    localStorage.setItem('other', '1234567890');
    expect(bffUsage()).toBe(10);
  });

  it('累计多个 bff: 键', () => {
    localStorage.setItem('bff:a', '1'); // key 5 + value 1 = 6
    localStorage.setItem('bff:b', '22'); // key 5 + value 2 = 7
    expect(bffUsage()).toBe(13);
  });

  it('无数据时为 0', () => expect(bffUsage()).toBe(0));
});

describe('schema 版本', () => {
  it('导出当前版本号', () => expect(SCHEMA_VERSION).toBe(1));

  it('全新安装时 needsMigration 为 true', () => {
    expect(needsMigration()).toBe(true);
  });

  it('标记后 needsMigration 为 false', () => {
    expect(markMigrated()).toBe(true);
    expect(needsMigration()).toBe(false);
  });

  it('版本号不匹配时为 true', () => {
    localStorage.setItem('bff:schemaVersion', JSON.stringify(999));
    expect(needsMigration()).toBe(true);
  });
});
