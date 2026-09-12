import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadCollapsed,
  saveCollapsed,
  toggleCollapsed,
  SIDEBAR_COLLAPSED_KEY,
  SECTION_COLLAPSED_KEY,
} from './uiState';

beforeEach(() => localStorage.clear());

describe('collapse 状态', () => {
  it('初始为空集合', () => expect(loadCollapsed(SIDEBAR_COLLAPSED_KEY).size).toBe(0));

  it('往返一致', () => {
    saveCollapsed(SIDEBAR_COLLAPSED_KEY, new Set(['a', 'b']));
    expect(loadCollapsed(SIDEBAR_COLLAPSED_KEY).size).toBe(2);
  });

  it('toggle 加入不存在的项', () => {
    const s = toggleCollapsed(new Set<string>(), 'x');
    expect(s.has('x')).toBe(true);
  });

  it('toggle 移除已存在的项', () => {
    const s = toggleCollapsed(new Set(['x']), 'x');
    expect(s.has('x')).toBe(false);
  });

  it('toggle 不修改入参', () => {
    const original = new Set<string>();
    toggleCollapsed(original, 'x');
    expect(original.size).toBe(0);
  });

  it('两个键互相独立', () => {
    saveCollapsed(SIDEBAR_COLLAPSED_KEY, new Set(['sidebar-only']));
    saveCollapsed(SECTION_COLLAPSED_KEY, new Set(['section-only']));
    expect(loadCollapsed(SIDEBAR_COLLAPSED_KEY).has('sidebar-only')).toBe(true);
    expect(loadCollapsed(SIDEBAR_COLLAPSED_KEY).has('section-only')).toBe(false);
    expect(loadCollapsed(SECTION_COLLAPSED_KEY).has('section-only')).toBe(true);
  });

  it('损坏数据返回空集合', () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '{not json');
    expect(loadCollapsed(SIDEBAR_COLLAPSED_KEY).size).toBe(0);
  });

  it('混入非字符串被过滤', () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, JSON.stringify(['a', 1, null]));
    expect(loadCollapsed(SIDEBAR_COLLAPSED_KEY).size).toBe(1);
  });
});
