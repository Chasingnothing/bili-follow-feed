import { describe, it, expect } from 'vitest';
import { mapDynamicToCard } from './mapDynamic';
import { avItem, liveRcmdItem, drawItem, forwardItem, malformedItem } from './__fixtures__/items';

describe('mapDynamicToCard', () => {
  it('从 DYNAMIC_TYPE_AV 条目提取卡片字段', () => {
    const card = mapDynamicToCard(avItem);
    expect(card).not.toBeNull();
    expect(card!.bvid).toBe('BV1jkYT6YEwh');
    expect(card!.title).toBe('【二十世纪电气目录】全13话 4K超清（未删减版）周更');
    expect(card!.upName).toBe('青の珊瑚礁');
    expect(card!.upMid).toBe(442715778);
    expect(card!.durationText).toBe('07:00:53');
    expect(card!.url).toBe('https://www.bilibili.com/video/BV1jkYT6YEwh');
  });

  it('把字符串类型的 play 转成 number', () => {
    const card = mapDynamicToCard(avItem);
    expect(typeof card!.play).toBe('number');
    expect(card!.play).toBe(99);
  });

  it('把字符串类型的 danmaku 转成 number', () => {
    const card = mapDynamicToCard(avItem);
    expect(typeof card!.danmaku).toBe('number');
    expect(card!.danmaku).toBe(0);
  });

  it('⚠️ 回归：带单位的播放量（"3.4万"）不能变成 0', () => {
    // 线上真实数据里 stat.play 是 "3.4万" 这样的展示字符串。
    // 旧实现用 Number() 解析 → NaN → 兜底 0，于是**所有热门视频都显示 0 播放**，
    // 而且「播放量最高」排序会把它们全排到最后。
    const hot = structuredClone(avItem) as typeof avItem;
    hot.modules.module_dynamic.major.archive.stat = { danmaku: '1.2万', play: '3.4万', vt: '' };
    const card = mapDynamicToCard(hot);
    expect(card!.play).toBe(34000);
    expect(card!.danmaku).toBe(12000);
  });

  it('发布时间取自 module_author.pub_ts，而非 archive.pubdate', () => {
    const card = mapDynamicToCard(avItem);
    expect(typeof card!.pubdate).toBe('number');
    expect(card!.pubdate).toBe(1789126620);
    // 秒级时间戳 ×1000 应得到 2026-09-11 这一天
    expect(new Date(card!.pubdate * 1000).toISOString().slice(0, 10)).toBe('2026-09-11');
  });

  it('把 http:// 封面提升到 https://，避免混合内容被拦截', () => {
    const card = mapDynamicToCard(avItem);
    expect(card!.cover.startsWith('https://')).toBe(true);
    expect(card!.cover).toBe(
      'https://i1.hdslb.com/bfs/archive/0b022cc355b3bd33a72e6bd9b58a3f2b2eebe75e.jpg',
    );
  });

  it('UP 主头像已是 https，保持不变', () => {
    const card = mapDynamicToCard(avItem);
    expect(card!.upFace.startsWith('https://')).toBe(true);
  });

  it('过滤直播推荐位', () => {
    expect(mapDynamicToCard(liveRcmdItem)).toBeNull();
  });

  it('过滤图文动态', () => {
    expect(mapDynamicToCard(drawItem)).toBeNull();
  });

  it('过滤转发动态', () => {
    expect(mapDynamicToCard(forwardItem)).toBeNull();
  });

  it('结构损坏时返回 null 而不抛异常', () => {
    expect(mapDynamicToCard(malformedItem)).toBeNull();
    expect(mapDynamicToCard(null)).toBeNull();
    expect(mapDynamicToCard(undefined)).toBeNull();
  });
});
