/** 结构取自 bilibili-API-collect 的 x/relation/followings 与 x/relation/tags 示例。
 *  刻意保留了三个真实陷阱：
 *    1. face 是 http:// （HTTPS 页面会按混合内容拦截）
 *    2. tag 可以是 null（只在默认分组）或数组（含 -10 表示特别关注）
 *    3. 原始对象还带 sign / vip / official_verify 等大字段，落盘时必须裁掉
 */
export const rawFollowings = [
  {
    mid: 14082,
    attribute: 2,
    mtime: 1584271945,
    tag: null,
    special: 0,
    uname: '山新',
    face: 'http://i0.hdslb.com/bfs/face/74c82caee6d9eb623e56161ea8ed6d68afabfeae.jpg',
    sign: '这条签名字段很长，但不该被落盘',
    official_verify: { type: 0, desc: '配音演员、声优。' },
    vip: { vipType: 2, vipStatus: 1 },
  },
  {
    mid: 420831218,
    attribute: 2,
    mtime: 1584208169,
    tag: [207542],
    special: 0,
    uname: '支付宝Alipay',
    face: 'http://i2.hdslb.com/bfs/face/aaf18aeb2d9822e28a590bd8d878572ca8c59e04.jpg',
    sign: '',
    official_verify: { type: 1, desc: '支付宝官方账号' },
    vip: { vipType: 1, vipStatus: 1 },
  },
  {
    mid: 53456,
    attribute: 2,
    mtime: 1586415053,
    tag: [-10, 194110],
    special: 1,
    uname: 'Warma',
    face: 'http://i2.hdslb.com/bfs/face/c1bbee6d255f1e7fc434e9930f0f288c8b24293a.jpg',
    sign: '',
    official_verify: { type: 0, desc: 'bilibili 知名UP主' },
    vip: { vipType: 2, vipStatus: 1 },
  },
];

export const rawTags = [
  { tagid: -10, name: '特别关注', count: 16 },
  { tagid: 0, name: '默认分组', count: 536 },
  { tagid: 194110, name: '我的同学', count: 16 },
  { tagid: 207542, name: '电影分组', count: 8 },
];
