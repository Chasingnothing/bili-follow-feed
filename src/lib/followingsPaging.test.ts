import { describe, it, expect } from 'vitest';
import { decidePaging, type PagingState } from './followingsPaging';

const PAGE = 50;
const MAX = 100;

function st(over: Partial<PagingState>): PagingState {
  return { got: 50, total: 0, pageLen: 50, ...over };
}

describe('decidePaging', () => {
  it('收齐了 total → 完成', () => {
    expect(decidePaging(st({ got: 283, total: 283 }), PAGE, MAX, 6)).toBe('done');
  });

  it('还有剩 → 继续', () => {
    expect(decidePaging(st({ got: 50, total: 283 }), PAGE, MAX, 1)).toBe('continue');
  });

  it('满页但已到页数上限 → 截断（不是完成）', () => {
    expect(decidePaging(st({ got: 5000, total: 8234 }), PAGE, MAX, MAX)).toBe('truncated');
  });

  it('本页为空 → 完成', () => {
    expect(decidePaging(st({ got: 250, total: 0, pageLen: 0 }), PAGE, MAX, 6)).toBe('done');
  });

  it('短页且 total 未知 → 完成（兜底判据）', () => {
    expect(decidePaging(st({ got: 283, total: 0, pageLen: 33 }), PAGE, MAX, 6)).toBe('done');
  });

  it('total 为 0（未知）时不拿它做判断', () => {
    expect(decidePaging(st({ got: 800, total: 0 }), PAGE, MAX, 16)).toBe('continue');
  });

  it('⚠️ 回归：服务端把 ps 截到 50 而 PAGE_SIZE 写成 100 时，不能第一页就停', () => {
    // 这正是"静默截断"的场景：pageLen(50) < pageSize(100) 会让兜底判据误判为末页。
    // 用 total 优先判断就能挡住：还有 283-50 条没拿，必须继续。
    expect(decidePaging({ got: 50, total: 283, pageLen: 50 }, 100, MAX, 1)).toBe('continue');
  });

  it('got 超过 total（B站 数据抖动）也算完成，不无限翻', () => {
    expect(decidePaging(st({ got: 300, total: 283 }), PAGE, MAX, 6)).toBe('done');
  });
});
