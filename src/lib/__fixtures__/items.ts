/**
 * 测试 fixture —— 结构完全取自 2026-09-11 的真实探针响应。
 *
 * 三个必须保留的"陷阱"（它们都是实测发现，不是臆测）：
 *   1. stat.play / stat.danmaku 是字符串，不是数字
 *   2. cover 是 http:// 协议（HTTPS 页面会按混合内容拦截）
 *   3. 时间戳在 module_author.pub_ts，且是字符串；archive 内没有 pubdate
 */
export const avItem = {
  type: 'DYNAMIC_TYPE_AV',
  modules: {
    module_author: {
      mid: 442715778,
      name: '青の珊瑚礁',
      face: 'https://i0.hdslb.com/bfs/face/e4ccd3b935b55721da4d9eaf6f5f0b7a38c31168.jpg',
      pub_ts: '1789126620',
      pub_time: '9-11',
      is_top: false,
    },
    module_dynamic: {
      major: {
        archive: {
          type: 'AV',
          bvid: 'BV1jkYT6YEwh',
          aid: 123456789,
          title: '【二十世纪电气目录】全13话 4K超清（未删减版）周更',
          cover: 'http://i1.hdslb.com/bfs/archive/0b022cc355b3bd33a72e6bd9b58a3f2b2eebe75e.jpg',
          duration_text: '07:00:53',
          stat: { danmaku: '0', play: '99', vt: '' },
          jump_url: '//www.bilibili.com/video/BV1jkYT6YEwh',
        },
      },
    },
  },
};

/** 直播推荐位：B站 塞进关注流的推广内容，必须过滤 */
export const liveRcmdItem = { type: 'DYNAMIC_TYPE_LIVE_RCMD', modules: {} };

/** 图文动态：不是视频，过滤 */
export const drawItem = { type: 'DYNAMIC_TYPE_DRAW', modules: {} };

/** 转发动态：不是本人投稿，过滤 */
export const forwardItem = { type: 'DYNAMIC_TYPE_FORWARD', modules: {} };

/** 结构损坏：不能抛异常，应返回 null */
export const malformedItem = { type: 'DYNAMIC_TYPE_AV' };
