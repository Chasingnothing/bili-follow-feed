/**
 * 测试 fixture —— 结构取自 2026-09-13 的真实探针响应（浏览器 Console 实测）。
 *
 * 这些"陷阱"都是实测发现，不是臆测：
 *   1. `stat.play` / `stat.danmaku` 是**带单位的展示字符串**（`"3.4万"`），不是数字
 *   2. `cover` 与 `opus.pics[].url` 是 `http://`（HTTPS 页面会按混合内容拦截）
 *   3. 时间戳在 `module_author.pub_ts`，且是字符串；`archive` 内没有 `pubdate`
 *   4. 图文走的是 **`major.opus`**（因为请求带了 `itemOpusStyle`），不是旧的 `major.draw`
 *   5. **转发**的 `major` 是 `null`，真正的内容在 `orig` 里
 */

/** 视频投稿。结构逐字取自真实响应。 */
export const avItem = {
  id_str: '1247495679462342665',
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
      desc: null,
      major: {
        type: 'MAJOR_TYPE_ARCHIVE',
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
    module_stat: {
      forward: { count: 12 },
      comment: { count: 34 },
      like: { count: 567 },
    },
  },
};

/**
 * 播放量上万时的真实形态：`"3.4万"`。
 *
 * 旧实现用 `Number("3.4万")` → NaN → 兜底 0，于是所有热门视频显示 0 播放。
 * 之所以一直没发现，是因为上面那个 fixture 恰好是 `"99"`（不带单位）。
 */
export const hotAvItem = {
  ...avItem,
  modules: {
    ...avItem.modules,
    module_dynamic: {
      ...avItem.modules.module_dynamic,
      major: {
        type: 'MAJOR_TYPE_ARCHIVE',
        archive: {
          ...avItem.modules.module_dynamic.major.archive,
          stat: { danmaku: '1.2万', play: '3.4万', vt: '' },
        },
      },
    },
  },
};

/**
 * 图文动态（纯文字、没有配图）。逐字取自真实响应。
 *
 * 注意三个点：`major.type` 是 `MAJOR_TYPE_OPUS`、`opus.title` 是**空串**、
 * `pics` 是**空数组** —— 正文只在 `summary.text` 里。
 */
export const opusTextItem = {
  id_str: '1249728821950677009',
  type: 'DYNAMIC_TYPE_DRAW',
  modules: {
    module_author: {
      mid: 34646754,
      name: '沉默寡言白河愁',
      face: 'https://i0.hdslb.com/bfs/face/aaaa.jpg',
      pub_ts: '1789813566',
      following: true,
    },
    module_dynamic: {
      desc: null,
      major: {
        type: 'MAJOR_TYPE_OPUS',
        opus: {
          jump_url: '//www.bilibili.com/opus/1249728821950677009',
          title: '',
          summary: {
            text: '洛克从直播12连胜后，下播10连败没手感了，洛克休息一段时间再播。提前预告国庆有洛克比赛，名字叫不朽杯！下周发视频',
            has_more: false,
          },
          style: 0,
          pics: [],
          fold_action: ['展开', '收起'],
          paywall: null,
        },
      },
    },
    module_stat: {
      forward: { count: 0 },
      comment: { count: 39 },
      like: { count: 290 },
    },
  },
};

/**
 * 带一张配图的图文。
 *
 * `opus` 子树与 `module_stat` 逐字取自真实响应；作者信息当时的探针没打印，
 * 这里沿用上面那条的形状（对本测试无关紧要）。
 */
export const opusPicsItem = {
  id_str: '1249722456824872963',
  type: 'DYNAMIC_TYPE_DRAW',
  modules: {
    module_author: {
      mid: 34646754,
      name: '沉默寡言白河愁',
      face: 'https://i0.hdslb.com/bfs/face/aaaa.jpg',
      pub_ts: '1789810000',
    },
    module_dynamic: {
      desc: null,
      major: {
        type: 'MAJOR_TYPE_OPUS',
        opus: {
          jump_url: '//www.bilibili.com/opus/1249722456824872963',
          title: '',
          summary: { text: '今天的图', has_more: false },
          style: 0,
          pics: [
            {
              url: 'http://i0.hdslb.com/bfs/new_dyn/3f7d27be65d30b90a2d7d4f58e97dd1f27534330.png',
              width: 750,
              height: 1000,
              size: 546.0009765625,
              live_url: '',
              aigc: 0,
              warning: null,
            },
          ],
          fold_action: ['展开', '收起'],
          paywall: null,
        },
      },
    },
    module_stat: {
      forward: { count: 42 },
      comment: { count: 374 },
      like: { count: 3127 },
    },
  },
};

/**
 * 转发动态。取自真实响应（做了裁剪）。
 *
 * 两个关键事实：
 *  - 转发自己的 `major` 是 **null**，内容全在被转发的 `orig` 里
 *  - `orig` 的作者 `following: false` —— **转发会把没关注的人带进来**，
 *    这正是保持过滤它的理由
 */
export const forwardItem = {
  id_str: '1233396749236699159',
  type: 'DYNAMIC_TYPE_FORWARD',
  modules: {
    module_author: {
      mid: 2,
      name: '碧诗',
      face: 'https://i2.hdslb.com/bfs/face/ef04.jpg',
      pub_ts: '1786010959',
    },
    module_dynamic: {
      desc: { text: '翻得好！' },
      major: null,
    },
    module_stat: {
      forward: { count: 3 },
      comment: { count: 150 },
      like: { count: 1779 },
    },
  },
  orig: {
    id_str: '1232914140981362707',
    type: 'DYNAMIC_TYPE_AV',
    modules: {
      module_author: {
        mid: 1526435,
        name: '横川是川崽耶',
        following: false,
      },
      module_dynamic: {
        major: {
          type: 'MAJOR_TYPE_ARCHIVE',
          archive: { bvid: 'BV19PMr6FEfw', title: '请 汤 上 身' },
        },
      },
    },
  },
};

/** 直播推荐位：B站 塞进关注流的推广内容，必须过滤 */
export const liveRcmdItem = {
  id_str: '1',
  type: 'DYNAMIC_TYPE_LIVE_RCMD',
  modules: {
    module_author: { mid: 999, name: '推广', pub_ts: '1789000000' },
    module_dynamic: { major: { type: 'MAJOR_TYPE_LIVE_RCMD' } },
  },
};

/** 有 `major.type` 但缺对应子树 —— 应返回 null 而不抛异常 */
export const brokenItem = {
  id_str: '2',
  type: 'DYNAMIC_TYPE_AV',
  modules: {
    module_author: { mid: 999, name: 'x', pub_ts: '1789000000' },
    module_dynamic: { major: { type: 'MAJOR_TYPE_ARCHIVE' } },
  },
};

/** 顶层结构就缺 —— 应返回 null 而不抛异常 */
export const malformedItem = { type: 'DYNAMIC_TYPE_AV' };
