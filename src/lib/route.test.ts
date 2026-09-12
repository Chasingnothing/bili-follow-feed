import { describe, it, expect } from 'vitest';
import { isFeedPath, FEED_PATH } from './route';

describe('isFeedPath', () => {
  it('命中我们的路径', () => expect(isFeedPath('/agent-feed')).toBe(true));

  it('容忍结尾斜杠', () => expect(isFeedPath('/agent-feed/')).toBe(true));

  it('容忍多个结尾斜杠', () => expect(isFeedPath('/agent-feed///')).toBe(true));

  it('不把首页误判为我们的路径', () => expect(isFeedPath('/')).toBe(false));

  it('不把空字符串误判', () => expect(isFeedPath('')).toBe(false));

  it('不匹配前缀相同的其他路径', () => expect(isFeedPath('/agent-feed-extra')).toBe(false));

  it('不匹配 B站 的真实路径', () => {
    expect(isFeedPath('/video/BV1jkYT6YEwh')).toBe(false);
    expect(isFeedPath('/account/history')).toBe(false);
    expect(isFeedPath('/agent')).toBe(false);
  });

  it('路径常量本身自洽', () => {
    expect(isFeedPath(FEED_PATH)).toBe(true);
    expect(FEED_PATH.startsWith('/')).toBe(true);
  });
});
