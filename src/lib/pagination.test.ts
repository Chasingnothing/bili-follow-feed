import { describe, it, expect } from 'vitest';
import {
  PAGE_SIZE,
  pageCount,
  clampPage,
  pageSlice,
  pageRange,
  pageNumbers,
} from './pagination';

describe('pageCount', () => {
  it('每页 20 条', () => expect(PAGE_SIZE).toBe(20));
  it('0 条也算 1 页（避免页码条消失）', () => expect(pageCount(0)).toBe(1));
  it('20 条 1 页', () => expect(pageCount(20)).toBe(1));
  it('21 条 2 页', () => expect(pageCount(21)).toBe(2));
  it('451 条 23 页', () => expect(pageCount(451)).toBe(23));
});

describe('clampPage', () => {
  it('低于 1 夹到 1', () => expect(clampPage(0, 100)).toBe(1));
  it('超过末页夹到末页', () => expect(clampPage(99, 100)).toBe(5));
  it('合法页码原样返回', () => expect(clampPage(3, 100)).toBe(3));
  it('空列表夹到 1', () => expect(clampPage(5, 0)).toBe(1));
});

describe('pageSlice', () => {
  const items = Array.from({ length: 45 }, (_, i) => i + 1);

  it('第一页取 1-20', () => expect(pageSlice(items, 1)).toEqual(items.slice(0, 20)));
  it('第二页取 21-40', () => expect(pageSlice(items, 2)).toEqual(items.slice(20, 40)));
  it('第三页取 41-45', () => expect(pageSlice(items, 3)).toEqual([41, 42, 43, 44, 45]));
  it('页码越界时夹到末页而不是返回空', () => {
    expect(pageSlice(items, 99)).toEqual(items.slice(40));
  });
  it('空数组返回空', () => expect(pageSlice([], 1)).toEqual([]));
});

describe('pageRange', () => {
  it('第一页 1-20', () => expect(pageRange(1, 451)).toEqual({ from: 1, to: 20 }));
  it('末页取到总数', () => expect(pageRange(23, 451)).toEqual({ from: 441, to: 451 }));
  it('空列表为 0-0', () => expect(pageRange(1, 0)).toEqual({ from: 0, to: 0 }));
  it('越界页码自动夹住', () => expect(pageRange(99, 45)).toEqual({ from: 41, to: 45 }));
});

describe('pageNumbers', () => {
  it('页数少时全部列出', () => {
    expect(pageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('7 页也全部列出（边界：span*2+5）', () => {
    expect(pageNumbers(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('23 页在第 1 页时折叠成 1 2 … 23', () => {
    expect(pageNumbers(1, 23)).toEqual([1, 2, '…', 23]);
  });

  it('23 页在中间时两侧都有省略号', () => {
    expect(pageNumbers(11, 23)).toEqual([1, '…', 10, 11, 12, '…', 23]);
  });

  it('23 页在末页时折叠成 1 … 22 23', () => {
    expect(pageNumbers(23, 23)).toEqual([1, '…', 22, 23]);
  });

  it('445 条那种极端页数也不炸', () => {
    const out = pageNumbers(12, 445);
    expect(out[0]).toBe(1);
    expect(out[out.length - 1]).toBe(445);
    expect(out.length).toBeLessThanOrEqual(9);
  });

  it('0 页返回空数组', () => expect(pageNumbers(1, 0)).toEqual([]));

  it('页码越界时也能生成合理结果', () => {
    expect(pageNumbers(999, 23)).toEqual([1, '…', 22, 23]);
  });

  it('省略号不会重复出现', () => {
    for (const cur of [1, 2, 3, 11, 21, 22, 23]) {
      const out = pageNumbers(cur, 23);
      for (let i = 1; i < out.length; i++) {
        expect(out[i] === '…' && out[i - 1] === '…').toBe(false);
      }
    }
  });
});
