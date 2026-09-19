import { describe, it, expect } from 'vitest';
import { limitMatches, SEARCH_ROW_LIMIT } from './searchLimit';

describe('limitMatches', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => i);

  it('不超过上限时原样返回，hidden 为 0', () => {
    const r = limitMatches(many(10), 50);
    expect(r.shown).toHaveLength(10);
    expect(r.hidden).toBe(0);
  });

  it('正好等于上限时也算全部显示', () => {
    const r = limitMatches(many(50), 50);
    expect(r.shown).toHaveLength(50);
    expect(r.hidden).toBe(0);
  });

  it('超出上限时截断，并报出剩余数量', () => {
    const r = limitMatches(many(120), 50);
    expect(r.shown).toHaveLength(50);
    expect(r.hidden).toBe(70);
  });

  it('保留的是前 N 项（顺序不变）', () => {
    const r = limitMatches(['a', 'b', 'c', 'd'], 2);
    expect(r.shown).toEqual(['a', 'b']);
    expect(r.hidden).toBe(2);
  });

  it('空数组不炸', () => {
    const r = limitMatches([], 50);
    expect(r.shown).toEqual([]);
    expect(r.hidden).toBe(0);
  });

  it('limit <= 0 视为不限制，而不是清空列表', () => {
    const r = limitMatches(many(120), 0);
    expect(r.shown).toHaveLength(120);
    expect(r.hidden).toBe(0);
  });

  it('默认上限就是 SEARCH_ROW_LIMIT', () => {
    const r = limitMatches(many(SEARCH_ROW_LIMIT + 5));
    expect(r.shown).toHaveLength(SEARCH_ROW_LIMIT);
    expect(r.hidden).toBe(5);
  });
});
