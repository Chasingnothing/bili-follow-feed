# B站「只看关注」— 项目交接文档

> **读这一份就能接手。** 最后更新：2026-09-13，对应 `main @ e77a018`（v0.8.2）。
>
> 本文档是给**上下文被压缩后的 AI agent** 看的，所以写法偏向"事实 + 原因 + 坑"，而不是营销文案。

---

## 0. 三十秒速览

| | |
|---|---|
| **是什么** | 一个 Chrome 用户脚本，把 B站 的关注动态流渲染成一个**按分组组织的视频卡片墙**，绕开首页推荐流 |
| **在哪** | `E:\ds\bili-follow-feed`（git 仓库，**无远程**） |
| **当前版本** | `main` = **v0.8.2**，263 个测试，构建通过 |
| **入口** | `https://www.bilibili.com/agent-feed`（用户脚本 `@match` 收窄到这一个路径） |
| **产物** | `dist/bili-follow-feed.user.js` —— **279,852 字节 / 21 行**（压缩后，gzip 约 87 KB），装进 Tampermonkey |
| **技术栈** | TypeScript · React 19 · Vite 8 · vite-plugin-monkey · Vitest 5（jsdom） |
| **核心承诺** | **不碰 B站 账号**。只读接口 + 本地存储，零凭据落地 |

**三条命令**：

```powershell
Set-Location E:\ds\bili-follow-feed
npm run verify      # tsc --noEmit && vitest run && vite build  ← 唯一的验证入口
```

---

## 1. 目标与作用

### 解决的痛点

B站 首页是**推荐流**（混杂未关注的人），用户看不到自己关注的人更新了什么。B站 的"动态页"虽然只显示关注的人，但混杂图文/转发/直播推荐，且不是视频卡片墙。

### 做出来的东西

一个**只显示已关注 UP 主的视频投稿**的页面：
- 按**本地关注分组**分板块（分组与 B站 隔离，首次从 B站 导入）
- B站 风格卡片：封面 + 标题 + UP 主 + 播放量 + 时长
- 点击跳 B站 原视频页
- 已读标记、排序、筛选、各自独立的页码

### 明确不做

- ❌ **取消关注**（用户明确决定不做）→ 所以**全程不需要任何写接口，不需要 csrf**
- ❌ 不建后端
- ❌ 不落地任何 Cookie / 登录凭据

---

## 2. 当前状态

### 分支

```
* main              e77a018  fix: popovers ran off the bottom (v0.8.2)   ← 当前主线
  feat/history-fill 1f9d50d  feat: per-group history fill (v0.9.0)        ← 已完成但被退回
```

**`feat/history-fill` 的来龙去脉**：用户说"**接着讨论**"，我给了分析后丢了个设计选择题，用户选完我就**当成开工指令直接做完了**。用户指出越界，于是：

```
git branch feat/history-fill     # 保住成果
git reset --hard e77a018         # main 退回
npm run build                    # 重建 dist，避免误装 0.9.0
```

**这个分支的内容很重要** —— 它包含"逐个 UP 拉取"的完整地基（见 §10），而那正是用户当前想做的"模式 2"所需要的东西。

### 版本历史（都是独立提交，回滚是一条命令）

| 版本 | 内容 |
|---|---|
| v0.1.x | 骨架：动态流 → 卡片墙，路径入口迁移，开启压缩（588KB → 228KB） |
| v0.2.0 | 入口从 hash 迁到独立路径 `/agent-feed` |
| v0.3.0 | 分组视图、侧边栏、UP 链接、本地分组管理、批量分类 |
| v0.3.1 / v0.3.2 | 同名分组复用修复；分歧标记可点击 + 批量对齐 |
| v0.4.x | 时间窗深度翻页、分页、悬浮加载条（可拖动） |
| v0.5.0 | 增量刷新（刷新页面不再重拉全部） |
| v0.6.x | 板块拖拽/箭头排序、落点提示（修图层遮挡） |
| v0.7.x | 批量一次点击归类、应用后清空选择、卡片上的「⋯」 |
| v0.8.x | **隐藏分组**（不取关但过滤）、系统分组自愈、浮层定位修复 |
| v0.9.0 | *（分支上）* 按分组逐个 UP 补齐历史 |

---

## 3. 这台机器的环境事实（都是实测踩出来的）

| 事实 | 影响 |
|---|---|
| **harness 的 shell 是 Windows PowerShell 5.1**（尽管工具名叫 pwsh） | `curl` 是 `Invoke-WebRequest` 的**别名**，必须写 `curl.exe` |
| **harness 的 shell 用会话启动时的环境快照** | 新写入的用户环境变量在会话内**不可见**，每条命令要显式注入 PATH |
| **`workspace-write` 沙箱拒绝工作区外写入** | 涉及 `~/.agent-reach`、pipx、PATH、注册表的命令都要提权 |
| **schannel TLS 在沙箱下失败**（`SEC_E_NO_CREDENTIALS`） | curl / .NET 的 HTTPS 全废；**Python / Node 自带 OpenSSL，不受影响** |
| **系统代理 `127.0.0.1:7897`**（注册表里） | Python 自动读注册表代理；**curl 只认环境变量，所以空着就连不上外网** |
| **`npx vitest` / `npm run build` 必须全权限** | workspace-write 下 Vite 在**配置加载阶段**就崩（`windowsSafeRealPathSync`） |
| **`git add` 的行尾转换会改写工作区文件** | 已加 `.gitattributes`（`* -text`）止住 |
| 已持久化的用户环境变量 | `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` / `PYTHONUTF8=1` |

### ⚠️ 数行数/读文本别用 `Get-Content`

源文件是 **UTF-8 无 BOM + 纯 LF**。Windows PowerShell 5.1 的 `Get-Content` 默认按**系统 ANSI（中文 Windows = GBK）**解码，中文变乱码，而乱码解码会**吞掉换行把两行并成一行** —— 于是它**静默少数行**，不报错：

| 文件 | `Get-Content` | **真实行数** |
|---|---|---|
| `useFeed.ts` | 299 | **315** |
| `App.tsx` | 686 | **698** |
| `localGroups.ts` | 533 | **573** |

**正确做法**（三选一）：

```powershell
[System.IO.File]::ReadAllLines($absPath).Count    # 注意必须绝对路径
Get-Content -Encoding UTF8 $path | Measure-Object -Line   # 注意：这会跳过空行
```

或直接用 harness 的 `read` 工具（它会报 "of N lines"，权威）。

**踩过**：我拿 `Get-Content` 当尺子去"校正"凭记忆写的行号，结果**把本来正确的一整套数字改错了**。凡是用于文档/交接的数字，都要用上面这几种方式之一复核。
| `tsc` 的 `noUnusedLocals` 开着 | 测试文件里未使用的 import 会导致构建失败 |

### 每次跑命令的标准开场白

```powershell
$env:PATH = "$([Environment]::GetEnvironmentVariable('Path','Machine'));$([Environment]::GetEnvironmentVariable('Path','User'));$env:PATH"
Set-Location E:\ds\bili-follow-feed
```

### 一个反复踩的验证陷阱

**不要用 `... | Select-Object -First N` 之后读 `$LASTEXITCODE`** —— `2>&1` 把警告混进管道，`-First N` 取满就**掐断管道杀掉进程**，退出码变成 `-1`（假失败）。

正确写法：

```powershell
$out = npm run verify 2>&1 | Out-String
$code = $LASTEXITCODE
```

---

## 4. 代码地图

### 数据层 `src/data/`

| 文件 | 行 | 作用 |
|---|---|---|
| `source.ts` | 13 | **`FeedDataSource` 接口** —— UI 层唯一认识的数据契约，是"换数据源不动 UI"的关键接缝 |
| `inPage.ts` | 58 | 站内实现：`fetchPage()` = 全局动态流；`parseFeedPage()` 共用解析 |
| `relation.ts` | 76 | 只读关系接口：`fetchSelf`（取自己 mid）、`fetchTags`（分组）、`fetchFollowings`（关注列表，**边界处裁剪字段**） |
| `__fixtures__/relation.ts` | 51 | 关注列表/分组的真实结构 fixture（含三个陷阱） |

### 纯逻辑 `src/lib/`（重点，测试都在这里）

| 文件 | 行 | 作用 | 为什么不明显 |
|---|---|---|---|
| `mapDynamic.ts` | 64 | **动态流 item → VideoCard** | 处理**三个实测陷阱**：`stat.play` 是字符串、`cover` 是 `http://`、时间在 `module_author.pub_ts` 而**不是** `archive.pubdate` |
| `localGroups.ts` | 573 | **本地分组 + 归属 + 批量 + 分歧 + 导入** | 全项目最复杂的逻辑，见 §5 |
| `feedWindow.ts` | 133 | 翻页编排：`fillToCutoff`（补齐到时间窗）、`fetchNewer`（增量刷新） | **纯函数 + 依赖注入**，所以能测 |
| `grouping.ts` | 44 | `buildSections`：视频按 UP 的本地分组切成分区 | 多归属的 UP 在每个板块都出现 |
| `storage.ts` | 64 | `readJson` / `writeJson`（**返回是否成功**）/ `bffUsage` | 损坏数据回落默认值，绝不白屏 |
| `readState.ts` | 57 | 已读集合 + 上次访问时间 | `readVideos` **封顶 3000 条**（唯一会无限增长的键） |
| `upIndex.ts` | 60 | B站 tagid → 本地分组 id 映射；`SPECIAL_ID` / `UNCATEGORIZED_ID` / `HIDDEN_ID` | `biliGroupIdsOf` 有可选的 **`resolve` 参数**，见 §5 |
| `pagination.ts` | 60 | 每页 20 条；页码折叠（`1 2 … 23`） | |
| `popover.ts` | 84 | 浮层定位：优先下方 → 上方 → 压缩高度 | 修的是"**拍一个固定数字**"的定位 |
| `format.ts` | 25 | 播放量（1.2万）/ 相对时间 | `formatRelativeTime` 收**毫秒**，而 `VideoCard.pubdate` 是**秒**，调用处须 ×1000 |
| `route.ts` | 20 | 入口路径判定 `isFeedPath` | |
| `links.ts` | 4 | `upSpaceUrl(mid)` | 三处共用 |
| `uiState.ts` | 24 | 侧边栏分组 / 主视图板块的折叠状态 | **两个键互相独立** |

### React `src/hooks/` 与 `src/components/`

| 文件 | 行 | 作用 |
|---|---|---|
| `hooks/useFeed.ts` | 315 | 动态流：首屏秒出 → 后台补齐 → 增量刷新 → 手动续翻 |
| `hooks/useFollowings.ts` | 115 | 关注列表 + B站 分组，带缓存与首次导入 |
| `hooks/usePopoverPosition.ts` | 48 | 用 `useLayoutEffect` 在**绘制前**算好浮层位置（无闪烁） |
| `hooks/useScrollToTopOnPage.ts` | 26 | 翻页后把板块滚回顶部（用 tick + effect，因为 React 会合并状态更新） |
| `components/Sidebar.tsx` | 230 | 侧边栏：分组树 + 搜索 + 批量模式 + 每 UP 的「⋯」 |
| `components/GroupSection.tsx` | 172 | 板块壳：折叠 + 拖动 + ↑↓ + 空占位 |
| `components/VideoGrid.tsx` | 57 | 卡片网格 + 分页（每页 20） |
| `components/VideoCard.tsx` | 76 | 单卡：**两个并列的 `<a>`**（视频 / UP 主页）+ 「⋯」（见 §5） |
| `components/BatchGroupPanel.tsx` | 83 | 批量模式顶部的分组图标（一次点击归类） |
| `components/BatchBar.tsx` | 88 | 底部批量条（移出/仅属于/移出全部/撤销/退出） |
| `components/GroupPicker.tsx` | 140 | 单个 UP 的分组勾选菜单 |
| `components/GroupMenu.tsx` | 177 | 「分组 ⋯」：建/改名/删/排序/存储占用/强制覆盖 |
| `components/LoadMoreBar.tsx` | 214 | 右下角**可拖动**的加载条 + 页数菜单 |
| `components/Pager.tsx` | 91 | 页码：范围 + 居中的页码 + 跳转框 |
| `App.tsx` | **698** | ⚠️ 偏大，见 §10 |
| `main.tsx` | 54 | 挂载/卸载、`bff-active`、MutationObserver 重挂保护 |
| `types.ts` | 71 | `VideoCard` / `FeedPage` / `BiliTag` / `TrimmedFollowedUp` / `SelfInfo` / `UpInfo` |
| `styles.css` | 1159 | 深色主题，全部 `.bff-*` 类 |

> **测试与 fixture**（15 个 `*.test.ts`）：体量最大的是 `localGroups.test.ts`（705 行）、`feedWindow.test.ts`（408 行）—— 测试量集中在最难的两块纯逻辑上，分布是对的。
> fixture 在 `lib/__fixtures__/items.ts`（47）和 `data/__fixtures__/relation.ts`（51），**都是从真实响应抄下来的**。

### 文档 `docs/`

- `superpowers/specs/2026-09-11-bili-follow-feed-design.md` —— 第一期（热身版）设计
- `superpowers/specs/2026-09-11-grouped-view-design.md` —— 第二期设计（**含实测结论与容量分析，价值高**）
- `plans/*.md` —— 两份实施计划

---

## 5. 关键设计决策（**为什么是这样**）

### ① 入口是独立路径，不是 hash

`https://www.bilibili.com/agent-feed`，`@match` 收窄到这一个路径。

**原因**：B站 对未知路径**不重定向、不改写 URL**（2026-09 实测），只在原址渲染它的 404 页 —— 我们接管那个 404 页。收窄 `@match` 让**其他 B站 页面完全不加载脚本**。

**历史上踩过**：v0.1.x 用 hash（`#/my-feed`），`@match` 是全站，导致每个 B站 页面都要解析 228KB。而且旧版靠 `hashchange` 判断"用户是否离开"，**B站 有权改写 hash** → 会静默把页面还回去。迁到路径后该逻辑整个删掉。

### ② 接管页面：隐藏原生 body

`html.bff-active body { display: none }`，挂载点挂在 `document.documentElement` 下（因为 `@run-at document-start` 时 `document.body` 还不存在）。

**副作用**：B站 404 页上的导航也被隐藏了 → **工具栏必须自带「返回 B站」出口**。

### ③ 三个 B站 字段陷阱（`mapDynamic` 里）

2026-09 实测：

| 假设 | 真实 |
|---|---|
| `stat.play` 是 number | **是字符串** `'59'` |
| `cover` 是 https | **是 `http://`** → HTTPS 页面按**混合内容**拦截，表现为一屏碎图 |
| 时间在 `archive.pubdate` | **该字段不存在**，时间在 `module_author.pub_ts`，且**是字符串、秒级** |

**这三条全部是"先跑探针"抓出来的**，光看设计文档发现不了。

### ④ `<a>` 不能嵌 `<a>`，`<button>` 不能放进 `<a>`

卡片外层是 `<div>`，里面两个**并列**的 `<a>`（视频 / UP 主页）；「⋯」按钮也是**并列**的兄弟节点。

**原因**：`<a>` 嵌 `<a>` 是非法 HTML，浏览器会拆掉内层；带 `href` 的 `<a>` 也不允许包含交互内容（button）。**同一个坑踩了两遍**（卡片重构一次、加「⋯」一次）。

### ⑤ 板块标题是 `<div>` 不是 `<button>`

因为里面要放拖动柄和 ↑/↓ 按钮 —— **按钮套按钮**是同一类非法嵌套。

### ⑥ 分组隔离 + 按名字复用（`localGroups.ts`）

**隔离**：`membership` 是本地唯一事实来源，B站 的改动不会自动流入。

**`Group.biliTagId` 是显式映射**：不能靠 id 前缀（`bili-`）猜 —— 用户先在本地建的同名分组 id 是 `local-N`，永远匹配不上。

**实测踩过的 bug**：用户在本地建「娱乐」，之后在 B站 也建「娱乐」并加人，补充导入时因 id 前缀不同被判定成"本地没有" → **新建了同名分组，UP 全进了新组**。修法：`Group` 上记 `biliTagId`，导入时按 **① 已有 tagid → ② 同名 → ③ 新建** 的顺序匹配。

**配套约束（更隐蔽）**：翻译 B站 归属时**必须查映射表，不能拼 `bili-<tagid>`** —— 复用同名分组后它的 id 是 `local-N`，拼出来的 id 指向不存在的分组 → **脏引用 → UP 静默掉进未分类**。所以 `biliGroupIdsOf` 有可选的 `resolve` 参数。

### ⑦ 同步能力五级（不要只记住"补充导入"）

| 入口 | 范围 | 覆盖本地修改 |
|---|---|---|
| 补充导入分组 | 全部，但只碰**未分类**的 | 否 |
| **全部按 B站 对齐** | **只有检测到分歧的** | 是（仅限分歧项） |
| 按 B站 重置此项 | 单个 UP | 是 |
| **保持我的分类** | 只有分歧项 | **否**（只推进快照，停止提示） |
| 强制覆盖 | 全部 | 是（危险，藏在菜单里） |

**分歧检测必须用快照**（`bff:biliSnapshot`）：直接拿"B站 当前值"和本地 membership 比，会把**所有用户手动改过的 UP 都误标成"B站 变了"**。

### ⑧ 隐藏分组必须与其他分组**互斥**

`HIDDEN_ID = 'hidden'`。**不取关**，只把视频从页面滤掉。

**互斥不是风格选择**：若一个隐藏的 UP 同时留在某个真实分组里，他的视频**仍会在那个板块渲染** —— 功能看起来就是坏的。所以加入真实分组会清掉 hidden，加入 hidden 会替换整个 membership。

**主区不渲染「隐藏」板块**（它永远是空的），只在侧边栏和批量面板里作为管理入口。工具栏计数显示"（已隐藏 N 条）"，让消失的内容有可见解释。

### ⑨ 系统分组要"自愈"（`loadGroups`）

**踩过的 bug**：v0.8.0 加了「隐藏」，但**老用户三处都看不到**。

**原因**：`loadGroups()` 在存储非空时直接返回旧列表，而 `systemGroups()` 只在**存储为空**或 `seedFromBilibili` 时才生效 → **"新增一个系统分组"这种纯追加式升级传导不到已安装用户**。

**修法**：`loadGroups()` 里补齐缺失的系统分组并落盘。**放在读取路径上，任何调用方都不可能忘记它**（放在某个 init 函数里就还会被忘）。

> 这是"`bff:schemaVersion` 机制造好了但没接上"的直接后果。**该机制至今仍未接上**，因为追加式变更用自愈更稳；**但破坏性变更（改字段名等）会真的需要它**。

### ⑩ 增量刷新（`fetchNewer`）

用户抱怨"每次刷新都要重拉"。两个成因：
1. 缓存只有 10 分钟有效期（读完视频回来就过期了）
2. 命中缓存只是"跳过拉取"，而且**丢了尾部游标** → 第一次「加载更多」从第 1 页重来

**修法**：命中缓存**先渲染**，再**从顶部往下抓、撞见已知 bvid 就停**（动态流是倒序的，看到已知条目说明更深处的也已知）。

**关键安全边界**：追满页数上限仍未撞见已知条目 → `caughtUp: false` → **退回完整加载**，绝不把两段拼接（那样会静默丢一段）。

### ⑪ B站 接口实测结论（2026-09）

| 接口 | 签名 | 备注 |
|---|---|---|
| `x/web-interface/nav` | 不需要 | 取自己 mid |
| `x/relation/tags` / `x/relation/followings` | 不需要（需登录） | 关注列表**登录可看自己全部** |
| `x/polymer/web-dynamic/v1/feed/all` | **不需要** | 全局动态流。实测 30 页覆盖 **3 天**，一页 21 条中约 12 条视频 |
| `x/polymer/web-dynamic/v1/feed/space` | **不需要** | ⭐ **单个 UP 的动态流**。代码 0，一页 12 条、实测覆盖**约 50 天** |
| `x/space/wbi/arc/search` | **需要 WBI** | 缺 `w_rid`/`wts` 直接 412。**但已经不需要它了** |

**`feed/space` 是本项目最重要的发现之一**：它让"逐个 UP 拉最新"**不需要实现 WBI + MD5**（浏览器 WebCrypto 故意不提供 MD5）。而且它的 item 结构与 `feed/all` **完全一致**，所以 `mapDynamicToCard` 原样复用。

### ⑫ 数据规模（实测账号：281 关注 / 8 分组）

- **262 / 281（93%）在 B站 默认分组** → 全部落入「未分类」
- 所以：**`uncategorized` 必须强制排最后**（不能沿用 API 顺序，API 里默认分组排第 2）；**搜索框与批量分类是必需品**
- 存储估算：200 关注 ≈ 165 KB；关注/取关的 churn **不是风险**（只加 membership/snapshot 各约 63 字符）

---

## 6. 数据与存储

**全部在 `localStorage`，属于 `www.bilibili.com` 这个域，不属于脚本。** 脚本每次刷新都是全新的，"记忆"完全靠读写 localStorage。

| 键 | 内容 | 增长特性 |
|---|---|---|
| `bff:feedCache` | 动态流卡片 + 窗口 + 尾部游标 | 封顶 600 条 |
| `bff:followingsCache` | 关注列表（**裁剪后的字段**）+ B站 分组 | 随当前关注数 |
| `bff:groups` | 本地分组 | 用户自建 |
| `bff:membership` | UP → 本地分组 id 列表 | 取关后**刻意保留** |
| `bff:biliSnapshot` | 分歧检测快照 | 同 membership |
| `bff:readVideos` | 已读 bvid | **封顶 3000** |
| `bff:lastVisitAt` | 上次离开时间（NEW 角标） | |
| `bff:collapsedGroups` / `bff:collapsedSections` | 折叠状态（**互相独立**） | |
| `bff:loadMorePos` | 悬浮加载条被拖到哪 | |
| `bff:schemaVersion` | ⚠️ **写了但从未被调用** | 见 §5⑨ |

### 实测体积（真实 fixture 卡片 = **391 UTF-16 单元/张**）

| 键 | 最坏情况 | 体积 | 占预算 |
|---|---|---|---|
| `bff:feedCache` | 600 张 | 0.22 MiB | 9% |
| `bff:upVideoCache`（分支） | 300 UP × 20 张 = **6000 张** | **2.26 MiB** | **90%** |
| `bff:followingsCache` | 281 UP | 0.04 MiB | 2% |
| `bff:readVideos` | 3000 bvid | 0.04 MiB | 2% |
| **合计** | | **2.56 MiB** | **≈102%** ⚠️ |

预算按 Chrome 的 5 MiB、每字符 2 字节 = 2,621,440 单元计算。

> **结论：按分支现在的上限，最坏情况会超出配额。** 而 `upVideoCache` 里**有 44% 是冗余** ——
> 它本来就以 `mid` 为 key，却还在每张卡里重复存 `upMid` / `upName` / `upFace`，而 `url` 也能由 `bvid` 直接拼出。

| 方案 | 6000 张体积 | 占预算 |
|---|---|---|
| 现状（完整卡片，20 张/UP） | 2.26 MiB | 90% |
| 卡片瘦身（去掉那 4 个字段，单张 391→218 单元） | 1.26 MiB | 50% |
| 瘦身 + 每 UP 只留 12 张（正好一页） | 0.75 MiB | **30%** |

**写入失败会返回 `false`**，界面出提示 —— 不再静默吞掉（否则配额满时已读状态会悄悄停止保存）。

---

## 7. 开发流程

### 命令

```powershell
npm run verify     # tsc --noEmit && vitest run && vite build   ← 唯一验证入口
npm run test       # tsc --noEmit && vitest run
npm run test:watch # 只跑 vitest（不带类型检查）
npm run dev        # Vite 开发服务器
```

**`npm test` 里带 `tsc` 是刻意的**：这个项目有过**两个只有 tsc 能抓、vitest 完全抓不到**的 bug（类型说谎：`Snapshot` 复用错类型、effect cleanup 变成 `() => boolean`）。已经用"故意塞一个类型错误"验证过守卫确实生效。

### 交付给用户

```
file:///E:/ds/bili-follow-feed/dist/bili-follow-feed.user.js
```

Tampermonkey 显示 **Reinstall**（不是 Update）是正常的 —— 从本地文件安装没有更新源。**结果一样：覆盖**。

**改行为必须升版本号** —— 用户判断"新版装上没有"的唯一依据就是 Tampermonkey 面板里的版本号。（踩过：修了 bug 没升版本，用户看不出区别。）

**构建自检一行**：`dist` 应该只有 **21 行**左右。如果变成一万多行，说明**压缩配置失效了**（踩过：Vite 8 / Rolldown 默认不压缩，588 KB）。副作用是 Tampermonkey 的编辑器要去渲染一万多行 → **用户以为"电脑卡住了"**。

### 测试策略

- **纯函数全部 TDD**：映射、分组、分页、定位、格式、存储
- **UI 靠人工验收清单**（不强行测 DOM）
- 测试里的 **fixture 必须来自真实探针响应**，不能凭猜 —— 猜错的话"测试通过"是假的

---

## 8. Bug 类别学（这部分最值钱）

| 类别 | 实例 | 教训 |
|---|---|---|
| **图层遮挡** | 落点提示用 `inset box-shadow` 画在"背景层"，被不透明的标题子元素盖住 → 收起板块时提示完全不可见 | CSS 绘制顺序：**元素背景（含 inset 阴影）→ 子元素**。要盖住子元素得用伪元素或提高层级的实际元素 |
| **非法嵌套** | `<a>` 嵌 `<a>`、`<button>` 放进 `<a>`、按钮套按钮 | 浏览器会**静默拆掉内层**，表现为"点了没反应"，不是报错 |
| **硬编码偏移量** | 浮层定位 `innerHeight - 60`（实际菜单 390px）、`innerHeight - 420` | 别拍数字。**测量后再定位**（`useLayoutEffect` 在绘制前） |
| **只在全新安装生效的初始化** | 新增系统分组传导不到老用户 | **"只在存储为空时初始化"的代码没有升级路径。** 凡是新增默认项，都要想清楚已装用户怎么拿到 |
| **类型说谎** | `Snapshot` 复用 `Record<string,string[]>` 却存 `number[]`；cleanup 返回 `boolean` | 运行时测试**抓不到**，只有 `tsc` 能抓 → 测试命令必须带类型检查 |
| **静默失败** | 配额满时 `catch {}` 吞掉异常 → 已读状态停止保存而用户不知 | 写操作要**上报结果** |
| **无上限增长** | `readVideos` 每点一个视频加一条、永不清理 | 主动封顶。**churn 型的增长通常不是问题，单调递增的才是** |
| **脏引用被容错掩盖** | 拼错的分组 id 被当成"未分类"兜底 → UP 静默消失 | 容错是好的，但**要保证不产生脏引用**，不能靠兜底 |
| **我自己的测试算错** | 断言值算错三次（子串误判、字符数、popover 边界） | **断言必须实跑，不能凭推理念认定通过** |
| **没问就做** | 用户说"接着讨论"，我把他的设计选择当成开工指令 | 见 §11 的工作约定 |

### 一条反复奏效的流程

> **动手前先跑探针，量过再写代码。**

抓到了三个字段陷阱、省掉了整套 WBI/MD5、发现了 `feed/space` 这扇免费的门。**所有"我以为"最后都被实测修正过。**

---

## 9. 已知限制

| 限制 | 说明 |
|---|---|
| **没有历史库** | 页面只显示动态流窗口内的内容。你两周没打开，那两周的内容看不到（除非手动翻页） |
| **错过的补不回来** | 同上。彻底的解法是"本地历史累积"（每次打开并入本地库），**已提议但未实现** |
| **不能定时抓取** | 用户脚本只在页面打开时存在，架构上做不到 |
| **状态困在一个域** | 全部状态在 `bilibili.com` 的 localStorage 里 |
| **和 B站 红点是两套** | 在我们的页面点击**不会**消除 B站 首页的红点；反之亦然（我们从不写 B站） |
| **「NEW」是近似** | 用时间戳比（`pubdate > lastVisitAt`），不是真正的"未读" |
| **跨平台需要重构** | 见 §10。约 70% 代码平台无关，但 `bvid`/`upMid`/`url` 写死了 B站 概念 |
| `App.tsx` 698 行 | 偏大，该拆 hooks |

---

## 10. 待办与未来计划

### A. 用户当前想要的：「模式 2 — UP 主个人拉取」（**悬而未决，见 §11**）

### B. `feat/history-fill` 分支上的现成地基

| 文件 | 作用 |
|---|---|
`inPage.fetchUpSpace(mid, offset)` | 拉单个 UP 的动态流（**已实测不需签名**），复用 `parseFeedPage` |
`lib/upVideoCache.ts` | 按 UP 存视频，**按时间淘汰 + 封顶**（不会无上限增长） |
`lib/upHistory.ts` | `fetchHistoryForUps`：批量拉取 + 限速 + 进度 + **单个失败不中断** + **每拉完一个立刻落盘** |

**模式 2 基本就是在这套之上换一种组织方式。** 所以第一件事可能是 `git merge feat/history-fill`。

### C. 长期方向（用户问过，未动手）

- **跨平台**（抖音等）：技术上可行，约 70% 代码平台无关。但障碍是**认证 + 签名**，不是跨域。
  - 抖音最硬（`X-Bogus`/`a_bogus` 签名），**性价比可能是负的**
  - 甜点区：RSS → B站 → YouTube
  - 最难的是**产品问题**：同一个人在 B站 和抖音是不同账号，"统一的我关注的人"做不到，实际会是"N 个并排的关注流共用一套分组"
- **架构泛化**：把 `platform + videoId + creatorId(字符串)` 替换掉 `bvid + upMid(number) + url`。**不做的话将来加平台会更痛**（且需要一次存储迁移）
- **本地历史累积**：零请求成本，能覆盖大部分"无限制"的实际需求

### D. 可维护性欠债

- `App.tsx` 拆 hooks
- `bff:schemaVersion` 要么接上、要么删掉（现在是空转）
- `.bff-picker` / `.bff-gmenu` 的定位已抽成共用 hook，但 CSS 仍集中在一个 `styles.css`（1159 行，可拆）

---

## 11. 悬而未决：模式 2 的五个确认点

用户想要一个**模式切换**：

```
工具条：  [动态流 | UP 主拉取]   ← 新增
```

**模式 1（默认）**：现在的行为（全局动态流 + 时间窗翻页）

**模式 2：UP 主个人拉取**
- **不显示「未分类」板块**
- 其余每个板块底部：`[⟳ 加载更多]`，**下面是页码**
- 点一次 = **每个 UP 各多显示一条**

```
┌─ 游戏 (19 个 UP) ────────────────────── ⠿ ↑ ↓ ┐
│  [卡片][卡片][卡片][卡片]                      │
│            [ ⟳ 加载更多 ]                      │
│    第 1-20 条 / 共 38 条   ‹ 1 2 ›             │
└────────────────────────────────────────────────┘
```

### 已向用户提出、**尚未得到回答**的五点

1. **"每次一条"的语义**：我理解为**逐层展开**（点第 N 次 = 每个 UP 显示第 N 新的那条）。另一种可能是"逐个 UP 展开"。**需确认**
2. **请求预算**：若是逐层展开，第 1 次点击必须拿到所有 UP 的数据（19 个 UP = 19 次请求 ≈ 8 秒，后续点击免费直到用完一页）。**用户是否接受首点等待**
3. **页码与「加载更多」的交互**：每页 20 条，19 UP 的板块点一次从 19 → 38 条（2 页），**用户仍停在第 1 页，看不出变化**。选项：(a) 点完跳到最后一页 (b) 按钮旁显示"每个 UP 已显示 N 条" (c) 维持原样
4. **刚切到模式 2 时显示什么**：(a) 空板块 + 按钮 (b) 先显示缓存里已有的。**我倾向 (b)**
5. **时间窗选择器**：模式 2 下应隐藏（那是动态流概念）

### 工作约定（**用户明确要求过，必须遵守**）

| 用户说的话 | 我的动作 |
|---|---|
| 「讨论」「想想」「有没有别的方案」「分析一下」 | **只输出分析**，最后问"要不要我做"，**不动代码** |
| 回答我的设计问题 | **不等于**让我开工 |
| 明确说「做 / 开始 / 改吧 / 实施」 | 才动手 |

**边界不清时按"不动手"处理。** 宁可多问一句，也不再多做一件。

---

## 12. 一句话给接手者

**这是一个"每加一个平台/功能都会先量再写、每个决定都留下原因"的项目。** 它的价值不只在代码，还在 `docs/` 里的实测结论和 §8 那份 bug 类别学 —— **改任何东西之前，先读 §5 和 §8，能省掉大部分返工。**
