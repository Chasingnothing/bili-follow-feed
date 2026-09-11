import { describe, it, expect } from 'vitest';
import { formatPlay, formatRelativeTime } from './format';

describe('formatPlay', () => {
  it('小于 1 万原样输出', () => expect(formatPlay(9999)).toBe('9999'));
  it('大于等于 1 万用万', () => expect(formatPlay(12345)).toBe('1.2万'));
  it('大于等于 1 亿用亿', () => expect(formatPlay(123456789)).toBe('1.2亿'));
  it('0 也正常', () => expect(formatPlay(0)).toBe('0'));
});

describe('formatRelativeTime', () => {
  const now = 1_757_500_000_000;

  it('一小时内显示分钟', () => expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5分钟前'));
  it('一天内显示小时', () => expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3小时前'));
  it('三十天内显示天', () => expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe('2天前'));
  it('超过三十天显示日期', () =>
    expect(formatRelativeTime(now - 40 * 86_400_000, now)).toMatch(/^\d{4}-\d{2}-\d{2}$/));

  it('接真实探针的秒级时间戳 ×1000 后不产生 Invalid Date', () => {
    const pubTs = 1789126620; // 探针实测值
    const out = formatRelativeTime(pubTs * 1000, pubTs * 1000 + 3600_000);
    expect(out).toBe('1小时前');
  });
});
