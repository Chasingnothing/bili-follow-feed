import { describe, it, expect } from 'vitest';
import { upSpaceUrl } from './links';

describe('upSpaceUrl', () => {
  it('拼出 UP 主页地址', () => {
    expect(upSpaceUrl(268014495)).toBe('https://space.bilibili.com/268014495');
  });

  it('是 https', () => {
    expect(upSpaceUrl(1).startsWith('https://')).toBe(true);
  });
});
