import { describe, it, expect } from 'vitest';
import { mapDynamicToItem } from './mapDynamic';
import {
  avItem,
  hotAvItem,
  opusTextItem,
  opusPicsItem,
  forwardItem,
  liveRcmdItem,
  brokenItem,
  malformedItem,
} from './__fixtures__/items';

describe('mapDynamicToItem —— 视频', () => {
  it('从 MAJOR_TYPE_ARCHIVE 提取字段', () => {
    const item = mapDynamicToItem(avItem);
    expect(item).not.toBeNull();
    expect(item!.kind).toBe('video');
    expect(item!.id).toBe('BV1jkYT6YEwh');
    expect(item!.title).toBe('【二十世纪电气目录】全13话 4K超清（未删减版）周更');
    expect(item!.upName).toBe('青の珊瑚礁');
    expect(item!.upMid).toBe(442715778);
    expect(item!.durationText).toBe('07:00:53');
    expect(item!.url).toBe('https://www.bilibili.com/video/BV1jkYT6YEwh');
    expect(item!.imageCount).toBe(0);
  });

  it('字符串类型的 play / danmaku 转成数字', () => {
    const item = mapDynamicToItem(avItem);
    expect(item!.play).toBe(99);
    expect(item!.danmaku).toBe(0);
  });

  it('⚠️ 回归：带单位的播放量（"3.4万"）不能变成 0', () => {
    // 线上真实数据里 stat.play 是 "3.4万" 这样的展示字符串。
    // 旧实现用 Number() 解析 → NaN → 兜底 0，于是**所有热门视频都显示 0 播放**。
    const item = mapDynamicToItem(hotAvItem);
    expect(item!.play).toBe(34000);
    expect(item!.danmaku).toBe(12000);
  });

  it('发布时间取自 module_author.pub_ts，而非 archive.pubdate', () => {
    const item = mapDynamicToItem(avItem);
    expect(item!.pubdate).toBe(1789126620);
    expect(new Date(item!.pubdate * 1000).toISOString().slice(0, 10)).toBe('2026-09-11');
  });

  it('把 http:// 封面提升到 https://，避免混合内容被拦截', () => {
    const item = mapDynamicToItem(avItem);
    expect(item!.cover).toBe(
      'https://i1.hdslb.com/bfs/archive/0b022cc355b3bd33a72e6bd9b58a3f2b2eebe75e.jpg',
    );
  });

  it('UP 主头像已是 https，保持不变', () => {
    expect(mapDynamicToItem(avItem)!.upFace.startsWith('https://')).toBe(true);
  });

  it('点赞数取自 module_stat', () => {
    expect(mapDynamicToItem(avItem)!.like).toBe(567);
  });
});

describe('mapDynamicToItem —— 图文', () => {
  it('解析 MAJOR_TYPE_OPUS（纯文字、无配图）', () => {
    const item = mapDynamicToItem(opusTextItem);
    expect(item).not.toBeNull();
    expect(item!.kind).toBe('image');
    // 图文的唯一 id 是动态的 id_str，不是 bvid
    expect(item!.id).toBe('1249728821950677009');
    expect(item!.cover).toBe('');
    expect(item!.imageCount).toBe(0);
    expect(item!.durationText).toBeNull();
    // 没有播放量这个概念
    expect(item!.play).toBe(0);
    expect(item!.danmaku).toBe(0);
    expect(item!.like).toBe(290);
  });

  it('opus.title 为空串时退回正文（短图文的常态）', () => {
    const item = mapDynamicToItem(opusTextItem);
    expect(item!.title).toContain('洛克从直播12连胜后');
  });

  it('跳转链接用 opus.jump_url 并补上 https（它是协议相对的 //www...）', () => {
    const item = mapDynamicToItem(opusTextItem);
    expect(item!.url).toBe('https://www.bilibili.com/opus/1249728821950677009');
  });

  it('有配图时取首图当封面，并带出原始尺寸', () => {
    const item = mapDynamicToItem(opusPicsItem);
    expect(item!.imageCount).toBe(1);
    // ⚠️ pics[].url 是 http://，和视频封面是同一个混合内容坑
    expect(item!.cover).toBe(
      'https://i0.hdslb.com/bfs/new_dyn/3f7d27be65d30b90a2d7d4f58e97dd1f27534330.png',
    );
    expect(item!.coverW).toBe(750);
    expect(item!.coverH).toBe(1000);
  });

  it('多张图时 imageCount 反映张数', () => {
    const two = structuredClone(opusPicsItem);
    // 往已有的 pics 里再塞一张（用 unknown[] 视图避开字面量推断出的严格元素类型）
    const pics = two.modules.module_dynamic.major.opus.pics as unknown[];
    pics.push({ url: 'http://i0.hdslb.com/bfs/new_dyn/second.png', width: 100, height: 100 });
    expect(mapDynamicToItem(two)!.imageCount).toBe(2);
  });

  it('有标题时优先用标题，而不是正文', () => {
    const withTitle = structuredClone(opusTextItem);
    withTitle.modules.module_dynamic.major.opus.title = '一篇长文的标题';
    expect(mapDynamicToItem(withTitle)!.title).toBe('一篇长文的标题');
  });

  it('缺 jump_url 时按 id 拼出 opus 链接兜底', () => {
    const noJump = structuredClone(opusTextItem);
    noJump.modules.module_dynamic.major.opus.jump_url = '';
    expect(mapDynamicToItem(noJump)!.url).toBe(
      'https://www.bilibili.com/opus/1249728821950677009',
    );
  });

  it('缺 id_str 时返回 null（没有 id 就没法去重和打开）', () => {
    const noId = structuredClone(opusTextItem);
    noId.id_str = '';
    expect(mapDynamicToItem(noId)).toBeNull();
  });
});

describe('mapDynamicToItem —— 过滤', () => {
  it('过滤直播推荐位（B站 插进关注流的推广内容）', () => {
    expect(mapDynamicToItem(liveRcmdItem)).toBeNull();
  });

  it('过滤转发 —— 它会把没关注的人带进来', () => {
    // 转发自己的 major 是 null，内容全在被转发的 orig 里，
    // 而 orig 的作者 following 为 false（实测）。
    expect(mapDynamicToItem(forwardItem)).toBeNull();
  });

  it('有 major.type 但缺对应子树时返回 null 而不抛异常', () => {
    expect(mapDynamicToItem(brokenItem)).toBeNull();
  });

  it('结构损坏时返回 null 而不抛异常', () => {
    expect(mapDynamicToItem(malformedItem)).toBeNull();
    expect(mapDynamicToItem(null)).toBeNull();
    expect(mapDynamicToItem(undefined)).toBeNull();
    expect(mapDynamicToItem('nonsense')).toBeNull();
  });

  it('缺 upMid 时返回 null（没有作者就没法归类）', () => {
    const noAuthor = structuredClone(avItem);
    noAuthor.modules.module_author.mid = 0;
    expect(mapDynamicToItem(noAuthor)).toBeNull();
  });
});
