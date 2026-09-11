# B站「只看关注」视频墙 — 设计文档

- **日期**：2026-09-11
- **状态**：已通过设计评审，待用户审阅本文档
- **项目目录**：`E:\ds\bili-follow-feed\`
- **阶段**：路线 2（热身版）

---

## 1. 背景与痛点

B站首页推荐流会推送大量未关注 UP 主的内容，导致用户反而看不到自己已关注 UP 主的更新。用户需要一个**只显示关注的人的视频投稿**的页面，以 B站 原生风格的卡片呈现（封面 + 标题 + UP 主 + 播放量 + 时长），点击可跳转到 B站 原视频页播放。

## 2. 目标与非目标

### 目标

1. 一个**独立 URL**，打开后只显示用户所关注 UP 主的视频投稿
2. 卡片式布局，信息维度对齐 B站 原生视频卡片
3. 点击卡片跳转 `https://www.bilibili.com/video/{bvid}` 播放
4. 已读 / 未读标记，便于识别"哪些更新还没看"
5. 排序与筛选（最新发布 / 最近出现；全部 / 未读 / 按 UP 主）

### 非目标（明确排除，留给路线 1）

- ❌ 不建后端服务
- ❌ 不导出、不落地、不上传任何 Cookie 或登录凭据
- ❌ 不拉取关注 UP 主的全量历史投稿（**只要更新流**）
- ❌ 不做全站视频搜索
- ❌ 不做多端同步（已读状态仅本机）

## 3. 技术路线决策

调研后确定三条候选路线：

| | 路线 1：自建全栈 | 路线 2：增强动态页 | 路线 3：现成管道 + 自建前端 |
|---|---|---|---|
| 登录态 | 需本地存 Cookie | **不需要** | 需 Cookie 或 OpenCLI |
| 抓取代码 | 自己写（WBI + 风控） | **不写** | 交给第三方 |
| 风控风险 | 中 | **最低** | 低～中 |
| UI 自由度 | 完全自由 | 低（受 DOM 限制） | 完全自由 |
| 抗改版 | **强** | 弱（DOM 改版即坏） | 中 |
| 工作量 | 大 | 小 | 中 |

**决策：先做路线 2 热身，路线 1 为终局形态。**

理由：路线 2 能以极低成本验证"数据能否拿到、长什么样"这一最大不确定性，并快速缓解痛点；路线 1 的数据层风险（WBI 签名、风控、Cookie 维护）应在数据可用性确认后再投入。

**关键机会**：脚本运行在 `bilibili.com` 域下时，请求 `api.bilibili.com` 天然携带登录态且 CORS 放行（B站 自家前端即如此调用）。因此**不需要后端、不需要处理 Cookie**，仍可获得完整数据并渲染完全自定义的页面。此外动态流接口**预期不要求 WBI 签名**（这正是选择「只要更新流」这一范围的主要收益）—— 该假设须按 §9 风险 1 实测确认，未确认前不得当作既成事实。

## 4. 技术形态

- **单文件 userscript**（Tampermonkey / Violentmonkey 均可安装）
- **构建链**：Vite + React + TypeScript + `vite-plugin-monkey`，输出单个 `.user.js`
- **选型理由**：用户选择路线 2 的形态 A 的理由之一是「组件可复用到路线 1」。只有 React 组件 + TS 类型才能真正复用；纯 vanilla 实现到路线 1 需重写。

### 数据源抽象（复用的关键）

```ts
interface FeedDataSource {
  fetchPage(offset: string | null): Promise<{ items: VideoCard[]; nextOffset: string | null; hasMore: boolean }>;
}
```

- `InPageDataSource` —— 热身版实现，站内 `fetch`，依赖浏览器会话
- `HttpDataSource` —— 路线 1 实现，调用本地后端 REST API
- **UI 层只依赖 `FeedDataSource` 接口，不感知实现差异**

## 5. 页面入口

- **主方案**：`https://www.bilibili.com/#/my-feed`
  - hash 不会发送到服务器，不产生额外请求，最干净
- 脚本 `@match https://www.bilibili.com/*`，检测到 `location.hash === '#/my-feed'` 时清空页面并挂载自有根节点
- **已知风险**：B站 是 SPA，hash 路由可能被其前端抢先处理
- **退路方案**：使用独立路径（如 `/agent-feed`）+ 接管 404 页面
- **此项必须在实现前实测**（见 §8 风险 2）

## 6. 数据层

### 接口

```
GET https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all
  ?type=all
  &offset=<分页游标>
  &page=1
  &timezone_offset=-480
  &platform=web
  &web_location=333.1387
  &features=itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote
credentials: 'include'
```

### 字段映射

从响应 `data.items[]` 中筛选 `type === 'DYNAMIC_TYPE_AV'`：

| 卡片字段 | 响应路径 | 实测状态（2026-09-11） |
|---|---|---|
| 封面 | `modules.module_dynamic.major.archive.cover` | ✅ 存在，但返回 **`http://`**，须改写为 `https://`，否则 HTTPS 页面按混合内容拦截，封面全碎 |
| 时长 | `modules.module_dynamic.major.archive.duration_text` | ✅ 字符串，如 `07:00:53` |
| 标题 | `modules.module_dynamic.major.archive.title` | ✅ |
| 播放量 | `modules.module_dynamic.major.archive.stat.play` | ⚠️ **字符串**（如 `'59'`），必须 `Number()` 转换 |
| 弹幕数 | `modules.module_dynamic.major.archive.stat.danmaku` | 待确认类型（预期同为字符串） |
| BVID | `modules.module_dynamic.major.archive.bvid` | ✅ |
| UP 主昵称 | `modules.module_author.name` | ✅ |
| UP 主头像 | `modules.module_author.face` | ✅ 已是 `https://` |
| UP 主 mid | `modules.module_author.mid` | ✅ number |
| 发布时间 | `modules.module_author.pub_ts` | ✅ **已确认**。⚠️ 是**字符串**、**秒级**时间戳（如 `'1789126620'`），须 `Number()` 后 ×1000 使用。`archive` 内**没有**任何时间字段 |
| 跳转链接 | `https://www.bilibili.com/video/{bvid}` | 拼接得出 |

### 实测发现（2026-09-11 探针）

- `code = 0`，**不需要 WBI 签名、不需要 `bili_ticket`**
- 单页 21 条，`has_more: true`，`offset` 为非空字符串（如 `"1246757288675377154"`）
- 单页出现的动态类型：`DYNAMIC_TYPE_AV`、`DYNAMIC_TYPE_DRAW`、`DYNAMIC_TYPE_LIVE_RCMD`、`DYNAMIC_TYPE_FORWARD`
- **`DYNAMIC_TYPE_LIVE_RCMD` 是直播推荐位（推广内容），必须过滤**
- 封面域名为 `i0.hdslb.com` / `i1.hdslb.com`，返回 `http://` 协议

### 分页

使用响应 `data.offset` 作为下一页游标，`data.has_more` 判断是否继续。前端以无限滚动触发。

### 待实测确认

- ~~该接口是否需要额外签名~~ → **已确认不需要**
- ~~发布时间的真实字段路径~~ → **已确认：`modules.module_author.pub_ts`，字符串、秒级**
- ~~`stat.danmaku` 的类型~~ → **已确认：字符串**（`stat.vt` 同为字符串）
- 视频动态是否还有 `DYNAMIC_TYPE_AV` 以外的新版形态（未发现）
- 单页 21 条中 12 条为视频投稿（约 57%）

## 7. 状态层

`localStorage`：

| Key | 内容 | 用途 |
|---|---|---|
| `bff:readVideos` | `string[]`（bvid 集合） | 已读标记 |
| `bff:lastVisitAt` | 时间戳 | 高亮"上次访问后新增" |

内存缓存：已加载的 items 数组，避免重复请求；刷新按钮强制重新拉取。

## 8. UI 设计

### 布局

响应式卡片网格：宽屏 4 列 → 中屏 3 列 → 窄屏 2 列。

### 卡片

- 封面 16:10，`<img referrerpolicy="no-referrer">`（绕开 `i0.hdslb.com` 防盗链）
- 封面右下角时长角标
- 标题最多 2 行截断
- UP 主头像 + 昵称
- 播放量（格式化为 `1.2万`）
- 相对时间（`3小时前` / `2天前`）
- 已读卡片整体降低不透明度
- 发布时间晚于 `bff:lastVisitAt` 的卡片显示「NEW」角标（消费 §7 的 `lastVisitAt`）

### 顶部工具条

- 排序：最新发布（按视频 `pubdate` 倒序，默认）/ 播放量最高（仅在已加载条目内排序）
- 筛选：全部 / 未读 / 按 UP 主（下拉）
- 操作：全部标记已读 / 刷新

### 交互

点击卡片 → 新标签打开 `https://www.bilibili.com/video/{bvid}`，同时写入已读集合。

## 9. 风险与验证顺序

**核心原则：先验证数据可用性，再搭脚手架。** 避免写完整套前端后才发现接口调不通。

| # | 风险 | 若不成立的后果 | 验证方式 |
|---|---|---|---|
| 1 | 接口是否需额外签名（WBI / `bili_ticket`） | 数据层需重做 | 浏览器控制台探针 |
| 2 | 独立 URL 在 SPA 下能否稳定接管 | 入口方案退回"独立路径 + 404 接管" | 手动访问实测 |
| 3 | 封面防盗链是否 `referrerpolicy` 即足够 | 需增加图片处理逻辑 | 实际渲染一张卡片测试 |

### 探针（第 1 步实施动作）

在已登录 B站 的浏览器控制台执行，确认返回结构与字段：

```js
const r = await fetch(
  'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all' +
  '?type=all&page=1&timezone_offset=-480&platform=web&web_location=333.1387',
  { credentials: 'include' }
).then(r => r.json());
console.log('code:', r.code, 'msg:', r.message);
console.log('items:', r.data?.items?.length, 'has_more:', r.data?.has_more);
console.table(r.data?.items?.map(i => ({ type: i.type, author: i.modules?.module_author?.name })));
```

- `code === 0` 且有 `items` → 数据层设计成立，继续搭脚手架
- `code !== 0` → 按 `message` 判断缺什么（签名 / ticket / 登录态），据实调整

## 10. 环境事实（实现时的约束）

| 项 | 值 |
|---|---|
| 平台 | Windows |
| Shell | Windows PowerShell 5.1（**`curl` 是 `Invoke-WebRequest` 别名，需写 `curl.exe`**） |
| Node | v22.22.0 |
| npm | 10.9.4 |
| Python | 3.14.3 |
| 工作区 | `E:\ds`（唯一可写目录；沙箱策略 `workspace-write`） |
| 系统代理 | `127.0.0.1:7897`（npm 装包需代理；已持久化 `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` 用户环境变量） |
| `PYTHONUTF8` | 已设为 `1`（避免 GBK 控制台 UnicodeEncodeError） |
| git | **未安装** |

> **注意**：本会话的 shell 使用会话启动时的环境快照，新写入的用户环境变量在当前会话内不可见，每条命令需显式注入。

## 11. 交付物

- 项目目录 `E:\ds\bili-follow-feed\`
- 构建产物 `dist/bili-follow-feed.user.js`，拖入 Tampermonkey 安装
- 本文档

## 12. 与路线 1 的衔接

热身版产出的以下资产可直接复用：

- 全部 React 卡片 / 工具条组件
- TypeScript 类型定义（`VideoCard` 等）
- `FeedDataSource` 接口抽象
- 已读状态管理与 UI

路线 1 仅需新增：后端服务、`HttpDataSource` 实现、Socket/轮询刷新。

## 13. 未决问题

| # | 问题 | 影响 |
|---|---|---|
| 1 | **用户的浏览器类型**（Chrome / Edge / Firefox） | 决定 userscript 管理器推荐与安装步骤 |
| 2 | 已读状态是否需要跨设备同步 | 当前设计为仅本机；若需要则须走路线 1 |
| 3 | 是否需要"隐藏已读"以外的批量操作（如按 UP 主屏蔽） | 影响工具条复杂度 |

---

## 附：调研依据

- [RSSHub issue #9605](https://github.com/DIYgod/RSSHub/issues/9605) —— 确认关注列表类接口强制要求登录 Cookie
- [B站 UP 主全量视频抓取：wbi 签名与系列筛选实战](https://www.cnblogs.com/ljn233/p/22489799)（2026-08）—— WBI 签名实现、`nav` 密钥轮换、`curl_cffi` 指纹伪装、请求限速
- [SocialSisterYi/bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect) —— B站 API 权威文档
- [Chivier/bili-investigate](https://github.com/Chivier/bili-investigate) —— 同类项目（Streamlit，关注列表需手动录入）
- [chengdidiididi/bilibili-timeline-filter-tab](https://github.com/chengdidididi/bilibili-timeline-filter-tab) —— 动态页按分组过滤的既有脚本
- [跨站点访问图片资源 403 的解决方案](https://cloud.tencent.cn/developer/article/2522845) —— 图片防盗链处理
