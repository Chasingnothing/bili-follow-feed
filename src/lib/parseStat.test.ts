import { describe, it, expect } from 'vitest';
import { parseStatCount } from './parseStat';

describe('parseStatCount', () => {
  it('纯数字字符串照常解析', () => {
    expect(parseStatCount('99')).toBe(99);
    expect(parseStatCount('0')).toBe(0);
    expect(parseStatCount('9999')).toBe(9999);
  });

  it('⚠️ 回归：带「万」的字符串不能再变成 0', () => {
    // 这正是线上 bug：Number('3.4万') === NaN → 兜底成 0 → 热门视频全显示 0 播放
    expect(parseStatCount('3.4万')).toBe(34000);
    expect(parseStatCount('1万')).toBe(10000);
    expect(parseStatCount('10万')).toBe(100000);
    expect(parseStatCount('999.9万')).toBe(9999000);
  });

  it('带「亿」的字符串', () => {
    expect(parseStatCount('1亿')).toBe(100000000);
    expect(parseStatCount('1.2亿')).toBe(120000000);
  });

  it('接受数字类型（有的接口直接给数字）', () => {
    expect(parseStatCount(123)).toBe(123);
    expect(parseStatCount(0)).toBe(0);
  });

  it('容忍空格与尾随加号', () => {
    expect(parseStatCount(' 3.4万 ')).toBe(34000);
    expect(parseStatCount('10万+')).toBe(100000);
    expect(parseStatCount('3.4 万')).toBe(34000);
  });

  it('认不出来的一律返回 0，绝不返回 NaN', () => {
    for (const bad of ['', '  ', '--', 'None', '万', '3.4万5', 'abc', null, undefined, {}, []]) {
      expect(parseStatCount(bad)).toBe(0);
    }
  });

  it('NaN / Infinity 输入返回 0', () => {
    expect(parseStatCount(NaN)).toBe(0);
    expect(parseStatCount(Infinity)).toBe(0);
  });

  it('结果永远是整数（卡片上不显示小数）', () => {
    expect(Number.isInteger(parseStatCount('3.45万'))).toBe(true);
    expect(Number.isInteger(parseStatCount('1.234亿'))).toBe(true);
  });
});
