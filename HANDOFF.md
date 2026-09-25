# B站「只看关注」— 项目交接文档

> **读这一份就能接手。** 最后更新：2026-09-25，对应 `main @ 44a499b`（v0.9.5）。
>
> 本文档是给**上下文被压缩后的 AI agent** 看的，所以写法偏向"事实 + 原因 + 坑"，而不是营销文案。

---

## 0. 三十秒速览

| | |
|---|---|
| **是什么** | 一个浏览器用户脚本，把 B站 的关注动态流渲染成一个**按分组组织的卡片墙**（视频 + 图文），绕开首页推荐流 |
| **在哪些浏览器上验证过** | **只有桌面 Chrome**。Firefox / Edge / 手机端的分析见 §9 末尾两节（**代码都未按它们改动过**） |
| **在哪** | `E:\ds\bili-follow-feed`（git 仓库，**无远程**） |
| **当前版本** | `main` = **v0.9.5**，**430 个测试**（24 个测试文件），构建通过 |
| **入口** | `https://www.bilibili.com/agent-feed`（用户脚本 `@match` 收窄到这一个路径） |
| **产物** | `dist/bili-follow-feed.user.js` —— **296,345 字节 / 21 行**（压缩后，gzip 约 92 KB），装进 Tampermonkey |
| **技术栈** | TypeScript · React 19 · Vite 8 · vite-plugin-monkey · Vitest 5（jsdom） |
| **两种模式** | **模式 1 = 动态流**（默认，全局动态流 + 时间窗翻页）；**模式 2 = UP 主拉取**（按 UP 逐个拉最新的 N 条） |
| **核心承诺** | **不碰 B站 账号**。只读接口 + 本地存储，零凭据落地 |

**两条命令**：

```powershell
Set-Location E:\ds\bili-follow-feed
npm run verify      # = npm run test && npm run build  ← 唯一的验证入口
```

---

## 1. 目标与作用

### 解决的痛点

B站 首页是**推荐流**（混杂未关注的人），用户看不到自己关注的人更新了什么。B站 的"动态页"虽然只显示关注的人，但混杂图文/转发/直播推荐，且不是视频卡片墙。

### 做出来的东西

一个**只显示已关注 UP 主投稿**的页面：
- 按**本地关注分组**分板块（分组与 B站 隔离，首次从 B站 导入）
- B站 风格卡片：封面 + 标题 + UP 主 + 播放量 + 时长
- **图文动态**（`MAJOR_TYPE_OPUS`）与视频并列显示，用同一套卡片；纯文字帖用占位封面
- 点击跳 B站 原视频/原动态页
- 已读标记、排序、筛选、各自独立的页码
- **两种模式**：
  - **模式 1（默认）**：全局动态流 + 时间窗深度翻页
  - **模式 2**：按 UP 逐个拉取（解决"关注的人太多、动态流翻不到底"）

### 明确不做

- ❌ **取消关注**（用户明确决定不做）→ 所以**全程不需要任何写接口，不需要 csrf**
- ❌ 不建后端
- ❌ 不落地任何 Cookie / 登录凭据

---

## 2. 当前状态

### 分支

```
* main             2073a50  docs: 模式 2 分页位移确认维持原样 (v0.9.4)      ← 当前主线
  feat/history-fill ff12788  feat: per-group history fill                ← 已完成但被退回，已被模式 2 取代
```

**`feat/history-fill` 的来龙去脉**：用户说"**接着讨论**"，我给了分析后丢了个设计选择题，用户选完我就**当成开工指令直接做完了**。用户指出越界，于是：

```
git branch feat/history-fill     # 保住成果
git reset --hard 11b2d7d         # main 退回（旧 hash 是 e77a018，2026-09-25 重写作者信息后变了）
npm run build                    # 重建 dist，避免误装
```

**这个分支已被模式 2 取代** —— 模式 2 用 `upFetch.ts` + `upVideoCache.ts` 重写了同一件事，且做得更对
（分支的 `upHistory.ts` 没有"空结果也算查过"的概念，正是 v0.9.1 那个无限重拉 bug 的来源）。
它**唯一还有参考价值**的一点：曾把版本号写成 `0.9.0`，**与主线 v0.9.0 撞号** ——
两边构建出的 `dist` 版本号一模一样，**光看版本号分辨不出是哪一个**（该删的理由之一）。是否删除待用户决定，见 §10。

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
| **v0.8.3** | **修页面卡死**：`memo(Sidebar)` + `useCallback` 修掉让 memo 失效的内联箭头 + 渲染节流 + 搜索渲染上限 |
| **v0.8.4** | **换时间窗不再重拉**：时间窗=显示范围、缓存=已拉深度；游标 checkpoint（截断后不再空转）；落盘时间窗选择 |
| **v0.8.5** | **关注列表 2000 上限** → 5000，且超出时**显示提示**（原先静默丢弃）；终止判据改用 `total` |
| **v0.8.6** | **播放量上万显示 0**：`stat.play` 是 `"3.4万"` 这种展示字符串，`Number()` → NaN → 兜底成 0。加 `parseStatCount` |
| **v0.8.7** | **时间窗覆盖后「加载更多」看着没反应**：新条目全被窗过滤掉。`visibleCutoff = min(window, manualFloor)` |
| **v0.8.8** | **暂停按钮**：后台补齐能中途停下（`shouldStop` 注入 `fillToCutoff`） |
| **v0.8.9** | **暂停只在全量补齐时可达**：把 `shouldStop` 延伸到 `fetchNewer` / `loadMore`；`paused` 与 `caughtUp:false` 分开 |
| **v0.8.10** | 补 `useFeed` 的**首批测试**（近期 bug 全住在这个 hook 里） |
| **v0.8.11** | **卡片模型泛化**：`VideoCard` → **`FeedItem`**（`types.ts`），为图文铺路 |
| **v0.8.12** | **类型筛选**（全部 / 视频 / 图文）+ 纯文字帖的对齐占位封面 |
| **v0.8.13** | **封面统一尺寸**：去掉内联 `aspect-ratio`，高图裁切，卡片不再高低不齐 |
| **v0.8.14** | **一个不可断的长字符串撑宽了一整列** → `minmax(0,1fr)` + `min-width:0` + `overflow-wrap:anywhere` |
| **v0.8.15** | **模式 2 地基**：`feed/space` 数据源、按 UP 缓存、拉取编排（纯逻辑，先可测） |
| **v0.9.0** | **模式 2 本体**：按 UP 逐个拉取 + 板块专属控件（拉取更多 / 多看一条 / 计数器）；拉取按钮兼作暂停 |
| **v0.9.1** | **一条内容都显示不出来的 UP 被无限重拉**：空结果也要记"查过了"（**出错不记**） |
| **v0.9.2** | 模式 2 隐藏悬浮加载条，并跳过动态流的加载 |
| **v0.9.3** | 拉取结果从页面顶部挪到**各自板块底部**（盯着下方板块的人原本看不到） |
| **v0.9.4** | 补「淘汰 → 重新拉取 → 立刻显示满 5 条」的测试；修 `saveUpItems` 的 **O(n×m)** 开销（每次保存都解析全部缓存条目） |
| **v0.9.5** | **模式 2 的层数不再落盘**：刷新后一律回到第一层，不再"点过「多看一条」的板块被跨会话永久记住"（详见 §5⑱） |

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
| **本会话的文件策略已是 `danger-full-access`，且审批提示被禁用** | 不要再传 `sandbox_permissions`（会被直接拒绝）；命令直接跑 |
| **`tsc` 的 `noUnusedLocals` 开着** | 测试文件里未使用的 import 会导致构建失败 |
| **`git add` 的行尾转换会改写工作区文件** | 已加 `.gitattributes`（`* -text`）止住 |
| 已持久化的用户环境变量 | `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` / `PYTHONUTF8=1` |

### ⚠️ 数行数/读文本别用 `Get-Content`

源文件是 **UTF-8 无 BOM + 纯 LF**。Windows PowerShell 5.1 的 `Get-Content` 默认按**系统 ANSI（中文 Windows = GBK）**解码，中文变乱码，而乱码解码会**吞掉换行把两行并成一行** —— 于是它**静默少数行**，不报错：

| 文件 | `Get-Content` | **真实行数** |
|---|---|---|
| `useFeed.ts` | 620 | **697** |
| `App.tsx` | 1038 | **1078** |
| `localGroups.ts` | 533 | **573** |
| `styles.css` | 1260 | **1275** |
| `dist/bili-follow-feed.user.js` | 20 | **21** |

**正确做法**（三选一）：

```powershell
[System.IO.File]::ReadAllLines($absPath).Count    # 注意必须绝对路径
Get-Content -Encoding UTF8 $path | Measure-Object -Line   # 注意：这会跳过空行
```

或直接用 harness 的 `read` 工具（它会报 "of N lines"，权威）。

**踩过两次**：① 拿 `Get-Content` 当尺子去"校正"凭记忆写的行号，**把本来正确的一整套数字改错了**；
② 用 `(Get-Content dist\....user.js).Count` 数构建产物，报 20 —— 真值 21。
凡是用于文档/交接的数字，都要用上面这几种方式之一复核。

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
| `inPage.ts` | 96 | 站内实现：`fetchPage()` = 全局动态流；**`fetchUpSpace(mid, offset)` = 单个 UP 的动态流**（模式 2 的基础，**不需要 WBI 签名**）；`parseFeedPage()` 两者共用 |
| `relation.ts` | 73 | 只读关系接口：`fetchSelf`（取自己 mid）、`fetchTags`（分组）、`fetchFollowings`（关注列表，**边界处裁剪字段**） |
| `__fixtures__/relation.ts` | 51 | 关注列表/分组的真实结构 fixture（含三个陷阱） |

### 纯逻辑 `src/lib/`（重点，测试都在这里）

| 文件 | 行 | 作用 | 为什么不明显 |
|---|---|---|---|
| `mapDynamic.ts` | 172 | **动态流 item → `FeedItem`** | 处理**三个实测陷阱**（`stat.play` 是带单位的字符串、`cover` 是 `http://`、时间在 `module_author.pub_ts` 而**不是** `archive.pubdate`）+ 按 `major.type` **分派视频/图文/转发** |
| `localGroups.ts` | 573 | **本地分组 + 归属 + 批量 + 分歧 + 导入** | 全项目最复杂的逻辑，见 §5 |
| `feedWindow.ts` | 264 | 翻页编排：`fillToCutoff`（补齐到时间窗）、`fetchNewer`（增量刷新） | **纯函数 + 依赖注入**，所以能测；`shouldStop` 让"暂停"可测 |
| **`upVideoCache.ts`** | 193 | **按 UP 存条目**：`bff:up:<mid>` 一个键一个 UP，`MAX_PER_UP=5` / `MAX_UPS=600`，`slimItem` 瘦身 | 模式 2 的存储层。**空数组是有效状态**（= 查过了但没内容），与"没有这个键"（= 没查过）语义不同 |
| **`upFetch.ts`** | 209 | `fetchUpToN`（拉单个 UP 最多 N 条）+ `fetchManyUps`（批量 + 限速 + 每 20 个停 2 秒 + 进度） | **纯依赖注入**（`fetchPage`/`sleep`/`shouldStop` 都是参数），所以整个请求编排能在测试里跑完 |
| **`upSections.ts`** | 102 | `buildUpSections`：**模式 2 的板块组装** | **数据流方向和模式 1 相反**（见 §5⑮）。排除「未分类」和「隐藏」 |
| `grouping.ts` | 44 | `buildSections`：条目按 UP 的本地分组切成分区 | 多归属的 UP 在每个板块都出现 |
| `groupMembership.ts` | 35 | `groupFollowings`：把关注列表按分组拆开 | 侧边栏和模式 2 **共用**，避免两处排序/归属不一致 |
| `storage.ts` | 64 | `readJson` / `writeJson`（**返回是否成功**）/ `bffUsage` | 损坏数据回落默认值，绝不白屏 |
| `readState.ts` | 60 | 已读集合 + 上次访问时间 | `readVideos` **封顶 3000 条**（唯一会无限增长的键） |
| `upIndex.ts` | 60 | B站 tagid → 本地分组 id 映射；`SPECIAL_ID` / `UNCATEGORIZED_ID` / `HIDDEN_ID` | `biliGroupIdsOf` 有可选的 **`resolve` 参数**，见 §5⑥ |
| `pagination.ts` | 60 | 每页 20 条；页码折叠（`1 2 … 23`）；`clampPage` | |
| `popover.ts` | 84 | 浮层定位：优先下方 → 上方 → 压缩高度 | 修的是"**拍一个固定数字**"的定位 |
| `parseStat.ts` | 38 | `parseStatCount`：`"3.4万"` / `"1.2亿"` / 结尾带 `+` → 数字 | ⚠️ **永远返回 0，绝不返回 NaN**。见 §5③ |
| `followingsPaging.ts` | 50 | `decidePaging`：翻页要不要继续 | **`total` 已知时它是权威判据，必须比"短页"先判**（踩过：顺序反了会让 ps 调大后停在第一页） |
| `searchLimit.ts` | 23 | `limitMatches`：搜索结果封顶 50 行 | **只在 `q` 非空时调用**（曾经无条件调用，把正常浏览也截断了） |
| `format.ts` | 25 | 播放量（1.2万）/ 相对时间 | `formatRelativeTime` 收**毫秒**，而 `FeedItem.pubdate` 是**秒**，调用处须 ×1000 |
| `uiState.ts` | 59 | 侧边栏分组 / 主视图板块的折叠状态 | **两个键互相独立** |
| `route.ts` | 20 | 入口路径判定 `isFeedPath` | |
| `links.ts` | 18 | `upSpaceUrl(mid)`、`itemUrl(id, kind)` | 视频和图文拼出的 URL 不同，三处共用 |

### React `src/hooks/` 与 `src/components/`

| 文件 | 行 | 作用 |
|---|---|---|
| `hooks/useFeed.ts` | **697** | 动态流：首屏秒出 → 后台补齐 → 增量刷新 → 手动续翻 → 暂停/继续。**近期几乎每个 bug 都住在这里** |
| `hooks/useFollowings.ts` | 162 | 关注列表 + B站 分组，带缓存与首次导入（`MAX_PAGES=100` → 5000 人，超出时 `truncated` 提示） |
| `hooks/usePopoverPosition.ts` | 48 | 用 `useLayoutEffect` 在**绘制前**算好浮层位置（无闪烁） |
| `hooks/useScrollToTopOnPage.ts` | 26 | 翻页后把板块滚回顶部（用 tick + effect，因为 React 会合并状态更新） |
| `components/Sidebar.tsx` | 254 | 侧边栏：分组树 + 搜索 + 批量模式 + 每 UP 的「⋯」 |
| `components/GroupSection.tsx` | 299 | 板块壳：折叠 + 拖动 + ↑↓ + 空占位 + **模式 2 的 `.bff-upbar`（两个按钮 + 计数器）与 `.bff-upstatus`（拉取结果）** |
| `components/FeedGrid.tsx` | 49 | 卡片网格 + 分页（每页 20）。**只有网格，不含页码** —— 页码归板块管 |
| `components/FeedCard.tsx` | 107 | 单卡：**两个并列的 `<a>`**（内容 / UP 主页）+ 「⋯」（见 §5④）。**视频和图文共用**，封面统一 16:10 |
| `components/BatchGroupPanel.tsx` | 83 | 批量模式顶部的分组图标（一次点击归类） |
| `components/BatchBar.tsx` | 88 | 底部批量条（移出/仅属于/移出全部/撤销/退出） |
| `components/GroupPicker.tsx` | 140 | 单个 UP 的分组勾选菜单 |
| `components/GroupMenu.tsx` | 177 | 「分组 ⋯」：建/改名/删/排序/存储占用/强制覆盖 |
| `components/LoadMoreBar.tsx` | 259 | 右下角**可拖动**的加载条 + 页数菜单。**模式 2 下整体隐藏** |
| `components/Pager.tsx` | 91 | 页码：范围 + 居中的页码 + 跳转框 |
| `App.tsx` | **1078** | ⚠️ 偏大，见 §10。模式状态、拉取编排、板块渲染都在这儿 |
| `main.tsx` | 54 | 挂载/卸载、`bff-active`、MutationObserver 重挂保护 |
| `types.ts` | 105 | **`FeedItem`**（`kind: 'video' \| 'image'`）/ `FeedPage` / `BiliTag` / `TrimmedFollowedUp` / `SelfInfo` / `UpInfo` |
| `styles.css` | 1275 | 深色主题，全部 `.bff-*` 类 |

> **测试与 fixture**：**24 个测试文件 / 430 个测试**。体量最大的是 `feedWindow.test.ts`（754）、
> `localGroups.test.ts`（705）、`useFeed.test.tsx`（602）、`upFetch.test.ts`（371）、
> `upVideoCache.test.ts`（226）、`upSections.test.ts`（218）—— 测试量集中在最难的两块（翻页编排、分组逻辑）
> 和模式 2 的存储/编排上，分布是对的。
> fixture 在 `lib/__fixtures__/items.ts`（232）和 `data/__fixtures__/relation.ts`（51），**都是从真实响应抄下来的**。

### 文档 `docs/`

- `superpowers/specs/2026-09-11-bili-follow-feed-design.md`（256）—— 第一期（热身版）设计
- `superpowers/specs/2026-09-11-grouped-view-design.md`（450）—— 第二期设计（**含实测结论与容量分析，价值高**）
- **`specs/2026-09-13-mode2-up-pull-design.md`（360）** —— 模式 2 设计定稿。§0 是决策记录表、
  §11/§12 是实测结论、**§13 是"拉取后当前页被挤走"的确认记录**（用户选了维持原样，两个备选方案也记在里面）
- `plans/2026-09-11-*.md`（1096 / 923）—— 两份实施计划

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
| `x/polymer/web-dynamic/v1/feed/space` | **不需要** | ⭐ **单个 UP 的动态流**（`fetchUpSpace(mid, offset)`，模式 2 的基础）。一页 12 条、实测覆盖**约 50 天** |
| `x/space/wbi/arc/search` | **需要 WBI** | 缺 `w_rid`/`wts` 直接 412。**但已经不需要它了** |

**`feed/space` 是本项目最重要的发现之一**：它让"逐个 UP 拉最新"**不需要实现 WBI + MD5**（浏览器 WebCrypto 故意不提供 MD5）。而且它的 item 结构与 `feed/all` **完全一致**，所以 `mapDynamicToItem` 原样复用。

### ⑫ 数据规模

> ⚠️ 这是**用户真实账号**在 2026-09-13 探针时的快照。账号会变（后来又多了 2 个关注、2 个分组，
> 约 283 / 10），**量级和比例不变，结论不受影响**。要重新量就再跑一次探针，别改这里的数字。

- **281 关注 / 8 分组**，其中 **262 / 281（93%）在 B站 默认分组** → 全部落入「未分类」
- 所以：**`uncategorized` 必须强制排最后**（不能沿用 API 顺序，API 里默认分组排第 2）；**搜索框与批量分类是必需品**
- **这条数据直接决定了模式 2 的设计**：93% 的人没被归类 → 模式 2 若包含「未分类」，
  一进页面就是几百个 UP 要逐个拉。所以模式 2 **只做已归类的分组**
- 存储估算：200 关注 ≈ 165 KB；关注/取关的 churn **不是风险**（只加 membership/snapshot 各约 63 字符）

### ⑬ 游标（offset）实测结论 —— 探针日期 2026-09-13

`feed/all` 的 `offset` **就是本页最后一条原始条目的 `id_str`** —— 是**键值游标**，不是位置序号：

| 项 | 实测值 |
|---|---|
| 形态 | `1247495679462342665` —— 19 位纯数字 |
| 与最后一条的关系 | **完全相等**（`offset === items[last].id_str`） |
| 一页条数 | 20 |
| 第二页与第一页重叠 | **0** |
| 同一个 offset 请求两次 | 结果**完全一致**（服务端锚定稳定） |

> ⚠️ **差点误判**：`纯数字=true` 很容易被当成"页码/序号"，但它是 snowflake 式的**条目 ID**。
> 只看"是不是数字"会得出**完全相反**的结论。决定性判据是 **`offset` 是否等于最后一条的 `id_str`**。
> （这个探针必须用已登录的浏览器跑 —— `feed/all` 匿名访问返回 `-101 账号未登录`。）

**由此解开三件事**：

1. **顶部插入新内容不会让游标错位。** 语义是"比这个 id 更旧的那些"，新增项的 id 更大、落在游标上方，
   由 `fetchNewer` 从顶部捞 —— **原先担心的"漏内容"不成立**。
2. **截断缓存后游标可以安全恢复**（见下）。
3. 增量刷新可以从 "bvid 集合" 升级为 "id 比较"。

#### 修法：按页记 checkpoint，截断时取可用的最后一个

`FeedItem` 里**没有 `id_str`**（只有 `id`，对视频是 `bvid`），所以不能从卡片反推游标 —— 但也**不需要加字段**：

```ts
// 翻页时（fullLoad / loadMore 里本来就有 page 对象）
checkpoints.push({ count: 已收集的视频卡片数, offset: page.nextOffset });

// persistCache 里
const cp = checkpoints.filter(c => c.count <= MAX_CACHED_CARDS).pop();
tailOffset: cp?.offset ?? null;   // ← 恒有效，不再置 null
```

**关键细节**：offset 对应本页最后一条**原始**条目，而原始条目含图文/转发/直播（会被 `mapDynamicToItem` 过滤），
所以**不能**用"最后一张视频卡的 id"来推，**必须按页记** —— 这与 `oldestPubTs` 那段注释（`inPage.ts:41-43`）
是同一个坑。

因为 resume 点之前的卡片全在缓存里，即使有少量重复也会被 bvid 去重挡掉，**不产生缺口**。
成本：每页一条 `{count, offset}`，50 页约 1,250 单元，可忽略。

**残余限制**：若 `MAX_CACHED_CARDS` 小于首页的视频卡片数（约 12），会找不到可用 checkpoint → 只能置 null。
600 远大于一页，所以实际不会发生。

#### 增量刷新的可选升级

既然 id 单调递增，`fetchNewer` 的停止判据可以从"这页有没有出现已知 bvid"改成
**纯数值比较** `item.id <= maxKnownId`：只需在缓存里存**一个** `maxKnownId` 字符串，
既省体积，又消掉"`known` 集合与屏幕上显示的内容不一致"这一整类隐患。

### ⑭ 动态内容类型实测 —— 探针日期 2026-09-13

**顶层 `type` 与 `major.type` 的组合**（feed/all 与 feed/space 一致）：

| 顶层 `type` | `major.type` | 内容在哪 | 现状 |
|---|---|---|---|
| `DYNAMIC_TYPE_AV` | `MAJOR_TYPE_ARCHIVE` | `major.archive` | ✅ 已支持 |
| `DYNAMIC_TYPE_DRAW` | **`MAJOR_TYPE_OPUS`** | `major.opus` | ✅ **已支持（v0.8.12）** |
| `DYNAMIC_TYPE_FORWARD` | `null` | **`orig`**（被转发的原帖） | 过滤 |
| `DYNAMIC_TYPE_LIVE_RCMD` | `MAJOR_TYPE_LIVE_RCMD` | — | 过滤（**B站 插的推广位**） |

> **图文走 opus，不是 `draw`** —— 因为请求里带了 `features: itemOpusStyle`。
> `major.draw` 是旧格式，**我们拿不到**；照它写就是白写。

**图文的字段路径**（`modules.module_dynamic.major.opus`）：

| 要的 | 取哪 | 坑 |
|---|---|---|
| id | `id_str` | 与 offset 同一 id 空间，**19 位字符串** |
| 链接 | `opus.jump_url` | ⚠️ **协议相对**（`//www.bilibili.com/opus/<id>`），要补 `https:` |
| 正文 | `opus.summary.text` | 用它就够 —— emoji 已是 `[名字]` 纯文本，**不必啃 `rich_text_nodes`** |
| 标题 | `opus.title` | ⚠️ **常为空串**，不能当正文 |
| 封面 | `opus.pics[0].url` | ⚠️ **是 `http://`**，与 `archive.cover` 同一个混合内容坑；`pics` 可能为**空**（纯文字） |
| 尺寸 | `pics[0].width/height` | 可用于算纵横比，**避免图片加载时卡片跳动** |
| 统计 | `module_stat.like/comment/forward.count` | 图文**没有播放量** |

`pics[]` 单项形状：`{ url, width, height, size, live_url, aigc, warning }`（`aigc` 标记 AI 生成图）。

**⚠️ `stat` 是带单位的展示字符串**：实测 `"play": "3.4万"`、`"danmaku": "112"`。
`Number("3.4万")` → `NaN` → 兜底成 0 → **所有播放量上万的视频显示 0 播放**，
「播放量最高」排序也失效。已由 `lib/parseStat.ts` 的 `parseStatCount` 修掉（v0.8.6）。
**fixture 里恰好是 `"99"`（不带单位），所以测试一直没碰到这个分支。**

**数据占比**（feed/all 单页 23 条）：AV 12 / DRAW 5 / FORWARD 3 / LIVE_RCMD 3。
即图文约占 **22%**（v0.8.12 已把它接上，卡片数约 +42%）。
类型筛选用 `FeedItem.kind`（`'video' | 'image'`），界面上的三段是【全部 / 视频 / 图文】。

**转发的两个事实**：① 转发自己的 `major` 是 `null`，内容全在 `orig`；
② `orig.modules.module_author.following` 实测为 **`false`** ——
**转发确实会把你没关注的人带进来**，这正是保持过滤的理由。
（样本：某 UP 的一页 12 条里 **11 条是转发**，过滤后只剩 1 条。）

### ⑮ 模式 2 的板块组装**方向相反**，不能复用 `buildSections`

| | 模式 1 | 模式 2 |
|---|---|---|
| 起点 | 一堆**条目**（全局动态流） | 每个板块的 **UP 列表** |
| 动作 | 按 UP 的归属把条目**分**到各板块 | 按 UP 列表去缓存里**取**条目 |
| 落点 | `grouping.buildSections` | `upSections.buildUpSections` |

**所以模式 2 的板块里可以出现"有 UP 但一条都没有"的情况**（刚进页面就是这样），
而模式 1 那种"空分组也产出 Section"的约定在模式 2 里含义不同 —— 文案都不一样
（模式 2 说"还没有拉取这个板块的内容"，模式 1 说"这个分组最近没有更新"）。

**模式 2 不产出「未分类」和「隐藏」板块**（用户确认过）：模式 2 的卖点是"按 UP 逐个看"，
而未分类里那几百个 UP 正是没被整理过的，逐个拉既慢又没意义。

### ⑯ 「层数」和「每个 UP 保留条数」**是同一个数字**

```ts
export const MAX_LAYER = MAX_PER_UP;   // upSections.ts  ← 都是 5
```

**这是刻意的对齐**，带来一个不明显的推论：**被淘汰的 UP 重新拉取后，会立刻显示满 5 条**
（只要该板块层数已是 5）。因为 `items.slice(0, layer)` 取满缓存里全部 5 条，
而且被淘汰的 UP **不会**被 `isFresh` 跳过 —— `fetchedAtMap` 是由**现存**缓存条目构建的，
被淘汰就查不到 → `at = 0` → 不新鲜 → 照常重拉。

层数只是**过滤条件**（每个 UP 最多贡献前 `layer` 条），然后整体统一排序 ——
所以**不存在"层与层之间怎么排"的问题**。v0.9.4 补了 3 条测试把这条锁住。

### ⑰ 「空结果」要记，"出错"**绝不能记**

模式 2 的 `fetchedAt` 决定一个 UP 要不要重拉。两种"没拿到东西"必须区别对待：

| 情况 | 记吗 | 为什么 |
|---|---|---|
| 拉到了条目 | 记 | 正常 |
| **拉成功但一条可显示的都没有**（全是转发 / 直播推广位） | **记**（存空数组） | 不记 → 永远"不新鲜" → **每次点拉取都重拉这 3 个请求，永远**（v0.9.1 的 bug） |
| **请求出错** | **不记** | 记了就把"网络抖动"永久固化成"这个 UP 没内容"，用户再也没机会拿到 |

配套：`upSections` 里 `checkedCount`（查过的）和 `cachedCount`（有内容的）**要分开报**，
否则用户永远看不懂计数器为什么到不了满分。界面用"（N 个无内容）"把这部分说出来。

### ⑱ 模式 2 的「层数」**刻意不落盘**

**判据：重置的代价是零，持久化的代价是困惑。**

「多看一条」是**只读缓存、不发任何请求**的。所以刷新后回到第一层，用户损失的只是"再点一下" ——
不重发请求、不丢数据（缓存里那 5 条还在）。而它一旦落盘，就会**跨会话悄悄累积**：
层数是按板块分别记的，你每次在某个板块点过「多看一条」，那个板块就被永久记住，
过一阵子回头看就成了"各个板块都停在第二层"，**而界面上没有任何提示**。

> **v0.9.5 之前它是落盘的**（`bff:upLayers`），用户报告了这个困惑。
> 一个有用的旁证：**它旁边那个 `pages`（每板块页码）从来就没落过盘** ——
> 同一个文件里两种状态处理方式不一致，说明层数持久化更像遗漏，不像设计。
> 老用户的 localStorage 里会留下一个 `bff:upLayers` **死键**，不再被读取，无害
> （`upVideoCache.test.ts` 有一条测试故意拿它当"别的键"的例子，正好证明残留键不会被误认成缓存）。

**排查时的一个坑**：用户最初以为是「拉取更多」造成的，但 `pullMore` 里**完全没有**
`setUpLayers`/`saveUpLayers` —— 全代码里唯一能改层数的是 `onMoreLayer`（「多看一条」）。
两个按钮紧挨着且样式相同，很容易点错。
**凡是"用户描述的因果"和"代码里的因果"对不上时，先确认再说** —— 否则会去修一个不存在的问题。

---

## 6. 数据与存储

**全部在 `localStorage`，属于 `www.bilibili.com` 这个域，不属于脚本。** 脚本每次刷新都是全新的，"记忆"完全靠读写 localStorage。

| 键 | 内容 | 增长特性 |
|---|---|---|
| `bff:feedCache` | 模式 1 的卡片 + 窗口 + 尾部游标 + checkpoints（`v: 2`） | 封顶 600 条 |
| **`bff:up:<mid>`** | **模式 2 的存储 —— 一个 UP 一个键**，`{at, lastUsedAt, cards[]}` | **每个 UP ≤ 5 条，最多 600 个 UP** |
| `bff:followingsCache` | 关注列表（**裁剪后的字段**）+ B站 分组 | 随当前关注数 |
| `bff:groups` | 本地分组 | 用户自建 |
| `bff:membership` | UP → 本地分组 id 列表 | 取关后**刻意保留** |
| `bff:biliSnapshot` | 分歧检测快照 | 同 membership |
| `bff:readVideos` | 已读 id | **封顶 3000** |
| `bff:lastVisitAt` | 上次离开时间（NEW 角标） | |
| `bff:collapsedGroups` / `bff:collapsedSections` | 折叠状态（**互相独立**） | |
| `bff:loadMorePos` | 悬浮加载条被拖到哪 | |
| `bff:feedHours` | 时间窗选择（小时） | |
| **`bff:mode`** | **当前是模式 1 还是模式 2** | 落盘（有意：回到上次的模式） |
| ~~`bff:upLayers`~~ | ~~每个板块的层数~~ | **v0.9.5 起不再落盘**（见 §5⑱）。老用户存储里留有死键，无害 |
| `bff:schemaVersion` | ⚠️ **写了但从未被调用** | 见 §5⑨ |

### 实测体积（2026-09-19 实测，真实 fixture 卡片）

> ⚠️ **单位陷阱**：`JSON.stringify(s).length` 数的是 **UTF-16 单元**，而 localStorage 按 **2 字节/单元** 计费。
> 把"单元数"当成"字节数"会让结果**正好差一倍** —— 我在这里错过一次，见 §8。

**卡片现在平均 423 UTF-16 单元 = 847 字节/张**（比早期文档写的 391 更大 —— 卡片多了
`kind` / `imageCount` / `coverW` / `coverH`，因为要同时表达视频和图文）。
其中图文帖比视频帖小（实测 376 / 406 vs 452 / 459 单元，图文没有时长和播放量）。

**Chrome 的配额是 10 MiB，不是 5 MiB**（`kPerStorageAreaQuota = 10 * 1024 * 1024`，见
[Chromium `dom_storage_types.h`](https://chromium.googlesource.com/chromium/src/+/31bbb8b1f07bcc51d64ff6c8913dc1ef48493c0f/content/common/dom_storage/dom_storage_types.h)）
= 10,485,760 字节 = **5,242,880 单元**。另有 100 KB 超额宽限。

| 键 | 最坏情况 | 单元 | 字节 | 占 Chrome 10 MiB |
|---|---|---|---|---|
| `bff:up:*` | 600 UP × 5 张 = **3000 张** | 1,192,200 | **2.27 MiB** | **22.7%** |
| `bff:feedCache` | 600 张 + 50 条 checkpoint | 274,108 | 0.52 MiB | 5.2% |
| `bff:followingsCache` | 283 UP | 42,245 | 0.08 MiB | 0.8% |
| `bff:readVideos` | 3000 条 | 45,000 | 0.09 MiB | 0.9% |
| **合计** | | 1,553,553 | **2.96 MiB** | **≈29.6%** |

**结论：Chrome 上余量充足**（不到三分之一；早期文档算出的 51% 是因为当时假定了"300 UP × 20 张"的旧方案）。
但两件事要记住：

1. **Firefox / Safari 的配额明显更小**（Firefox 的 `dom.storage.default_quota` 是 5 MiB 量级）。
   2.96 MiB 在 5 MiB 的浏览器上占 ~59% —— 能活但更紧。这个脚本是要开源的，所以**必须实测目标浏览器**，
   不能只按 Chrome 的 10 MiB 设计。
2. **"瘦身"只省了 17%，不是 44%**（423.3 → 350.8 单元）。因为 `slimItem` **只去掉 `upMid` 和 `url`**，
   故意**保留 `upName` / `upFace`** —— 用户取关过的 UP 不在 `upIndex` 里，去掉名字就再也显示不出来了
   （`upVideoCache.test.ts` 有测试锁住这条）。
   按 `mid` 作 key 去重 `upMid`、按 `id` 拼 `url`，这两条是安全的；名字和头像不是。

**写入失败会返回 `false`**，界面出提示 —— 不再静默吞掉（否则配额满时已读状态会悄悄停止保存）。

### 淘汰策略（`MAX_UPS = 600` 满了之后）

`upVideoCache` 满时按 **`lastUsedAt` 最旧的先淘汰**（`pickEvictions`），保证"正在看的板块不会被先淘汰"。
所以 `onMoreLayer`（「多看一条」）里会顺手 `touchUp` 一遍该板块的所有 UP。

**`saveUpItems` 只在"真的要新增一个 UP 且已达上限"时才算淘汰** —— `cachedUsage()` 要逐个
`JSON.parse` 全部条目，每次保存都调会让拉 N 个 UP 的开销变成 **O(N × 已缓存数)**
（600 已缓存 + 拉 500 个 = 30 万次解析）。`cachedMids()` 只扫 key 名，其余情况够用。（v0.9.4）

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

**只在 Chrome 上验证过。** 同一份 `dist` 可以装到 Firefox / Edge（都要各自装一次 Tampermonkey），
但**没有任何一处在 Firefox/Edge 上实测过** —— 已核实的部分和三个风险点在 §9「跨浏览器可用性」。

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
| **单位混淆** | 把 `JSON.stringify().length`（UTF-16 单元）当成字节写进文档，体积**差一倍**；又用了错的配额（5 MiB vs 实际的 10 MiB），两者叠加得出"会超配额"的错误结论 | 凡是体积/配额数字，**必须写明单位**并核对**权威出处**（这次是 Chromium 源码常量）。用户一眼就看出 2.56 < 5 的矛盾 —— **数字自相矛盾时先怀疑自己** |
| **只看表面特征就下结论** | `feed/all` 的 `offset` 是 `1247495679462342665`，"纯数字" 看起来就是页码/序号，差点据此判定"会漏内容" | 表面特征（纯数字）≠ 语义。决定性判据是**与已知量对照**：`offset` 恰好等于本页最后一条的 `id_str` → 其实是键值游标。**能对照就别猜** |
| **展示字符串被当数字** | `stat.play` 是 `"3.4万"` 这种**给人看**的字符串，`Number()` → `NaN` → 兜底成 0 → **所有播放量上万的视频显示 0**，排序也失效 | 接口字段有**两种数字**：机器读的和给人看的。判据是"有没有单位后缀"。修法是专用解析函数，且**保证永不返回 `NaN`**。⚠️ fixture 里恰好是 `"99"`（无单位），所以测试一直没覆盖这个分支 —— **fixture 太干净会掩盖真实数据的分支** |
| **"空结果"与"没查过"混为一谈** | 某 UP 动态流里全是转发/直播推广位 → 一条都存不下 → 永远是"不新鲜" → **每次拉取都重拉他，永远** | 存储层里**"空数组"和"没有这个键"必须是两种状态**。凡是有"要不要重新做"判断的地方，都要问清楚"上次做失败了"和"上次做完了但结果为空"是不是同一个意思 |
| **失败被误记成成功** | 与上一条成对：请求出错时**绝不能**记"查过了"，否则一次网络抖动会被永久固化成"这个 UP 没内容" | 记录"已完成"时要区分**成功且为空**（记）和**失败**（不记）。错误必须可重试 |
| **同一个按钮的两种模式抢 handler** | 模式 2 的「拉取更多」兼作「暂停」，但批量拉取里**没有任何地方去设那个暂停标志** → 有续跑路径、没有暂停入口 | **"有恢复路径"不等于"有暂停路径"** —— 两条路要分别验证。共用一个按钮时，两个分支都得能真正到达 |
| **提示放在"我"能看到的地方，不是"用户"在看的地方** | 拉取结果提示条固定在页面顶部，而用户正盯着页面下方的板块 → 完全看不到 | 反馈要**贴着触发它的对象**放（挪到各自板块底部）。"我测试时看到了"不等于"用户会看到" |
| **只在冷启动才走到的性能路径** | `saveUpItems` 每次保存都解析**全部**缓存条目（为了算淘汰），而其实只有"新增且已达上限"才需要 → 拉 N 个 UP 变成 O(N × 已缓存数)，600+500 = 30 万次解析 | **热路径里的"以防万一"要标价。** 判据是"这个昂贵分支真的会走到吗"。只有 600 个 key 时 `cachedMids()` 扫 key 名就够了，不必解析内容 |
| **`Get-Content` 静默少数行** | 数构建产物报 20 行，真值 21；数源码也少报（见 §3） | Windows PowerShell 5.1 按 GBK 解码 UTF-8，**乱码解码会吞换行**。数任何行数都用 `[System.IO.File]::ReadAllLines()`（绝对路径）或 `read` 工具 |
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
| `App.tsx` **1078** 行 | 偏大，该拆 hooks |
| **模式 2 的板块不能拖动排序** | 刻意的：模式 2 传的是 `NO_MOVE` 空实现 |
| **模式 2 每个 UP 只留 5 条** | `MAX_PER_UP = 5`。想看更早的要去 B站 主页 |
| **模式 2 不覆盖「未分类」** | 那 93% 的人要先去归类（设计使然，见 §5⑫） |
| **拉取后当前页内容会被挤走** | 板块按发布时间整体排序 + 每 20 条一页，插入必然位移。**用户已确认维持原样**，见 `docs/specs/...mode2...md` §13 |
| **只在 Chrome 上验证过** | Firefox / Edge **未实测**。已核实的部分与三个风险点见本节末「跨浏览器可用性」 |
| **手机上布局会崩** | `.bff-side` 固定 `260px` 且不收缩 + 网格没有手机断点 → 390px 宽的手机上侧边栏占 67%、内容只剩 130px。**手机端未适配**，见本节末「手机端可行性」 |

### 规模化到"开源后被大号关注数用户使用"的硬墙

当前设计是按 **281 关注** 实测账号调出来的。若有人关注 **5000** 人：

| 墙 | 现状 | 后果 |
|---|---|---|
| ~~关注列表只导入前 2000 人~~ | ✅ **v0.8.5 已修**：`ps=50` × `MAX_PAGES=100` = **5000** | 但 **>5000 仍会被截断** —— 现在至少会**显示提示**（`truncated`），不再静默丢弃 |
| **侧边栏无虚拟化** | `Sidebar.tsx` 直接 `map()`（搜索时 `limitMatches` 封顶 50 行） | 5000 个关注 → 5000 个 DOM 行。**折叠 + 搜索上限只是缓解**，真正解法是虚拟列表 |
| **模式 2 的请求数 = 该板块的 UP 数** | 按 UP 逐个拉，`MAX_PAGES_PER_UP=3` | 一个 UP 最多 3 个请求。几百 UP 的分组 = 上千请求。**已有护栏**：每 20 个停 2 秒、同一时刻只拉一个板块、随时可暂停 —— 但仍会触发风控，且要拉很久 |
| **缓存只覆盖最近用过的 600 个 UP** | `MAX_UPS = 600`（超出按 `lastUsedAt` 淘汰） | 5000 关注的人，缓存里没有 ≠ 没有更新。**UI 绝不能据此下"无更新"结论** |

> 第二条与模式 2 无关，**现在就已经存在**（只要用户关注数上千就会明显卡）。

### 跨浏览器可用性（Firefox / Edge）—— 2026-09-19 核实，**代码未改动**

用户问过"现在这个版本能不能在 Firefox 或 Edge 里用"。**结论：Edge 应该没问题；Firefox 大概率能，
但有三个点没验证过。** 当时选择"只记录、不改代码"，所以下面 ①②③ 至今仍然成立。

#### 已核实的（可复现，不是推测）

| 项 | 结论 | 怎么核实的 |
|---|---|---|
| **产物语法下限** | Firefox **114+** / Edge **111+** | 读本地 `node_modules/vite/dist/node/chunks/node.js` 的 `ESBUILD_BASELINE_WIDELY_AVAILABLE_TARGET` = `chrome111 / edge111 / firefox114 / safari16.4`（Vite 8.3.0 的 `baseline-widely-available` 默认值）。当前 Firefox 14x、Edge 13x、连 Firefox ESR 115 都在线上 |
| **有没有用专有 API** | 没有 | 全仓库搜 `unsafeWindow` / `chrome.` / `browser.` / 页面全局：只有两个测试文件用了 `globalThis` |
| **CSS 兼容性** | 全标准 | 只有一条 `::-webkit-inner-spin-button`（Firefox 直接忽略该规则，只影响数字输入框的上下小箭头）。`position: sticky` / `aspect-ratio` 两边都支持，无 `:has()` / `@container` |
| **GM API 依赖** | 只有 `GM_addStyle`，**且有 DOM 回退** | 它**不是源码调的** —— 是 vite-plugin-monkey 因为 `App.tsx` 里 `import './styles.css'` 自动加的 grant。插件源码 `defaultCssSideEffects` 是 `typeof GM_addStyle === "function" ? GM_addStyle(c) : (document.head \|\| document.documentElement).appendChild(...)` |
| **Tampermonkey 可得性** | 两边都有 | Edge 加载项商店 / Firefox AMO。三个浏览器各装一次，指向同一份 `dist` |

#### 三个没验证过的点（按危险程度排）

**① 沙箱（最致命）**

当前产物头是 `@grant GM_addStyle` → 沙箱**开着**。[Tampermonkey 文档](https://www.tampermonkey.net/documentation.php?ext=dhdg&q=grant)明确：

> In case `@grant` is followed by `none` the sandbox is disabled.
> If no `@grant` tag is given an empty list is assumed. **However this different from using `none`.**

Chrome 上沙箱里的 `fetch`（带 cookie）和 `localStorage` 都正常（用户一直在用）；
**Firefox 的沙箱是 Xray 实现，机制不同**。Tampermonkey 的设计目标就是跨浏览器一致，
所以大概率一样 —— 但若不一致，症状是接口返回 **`-101 账号未登录`、页面全空**，属于直接不可用。

**若要消除它**：给 `monkey()` 传 `grant: 'none'`（关沙箱 → 页面上下文 → 与 Chrome 行为完全一致）。
**已确认这个改动是安全的** —— 上表那条 DOM 回退保证样式照样注入。

**② localStorage 配额**

Chrome 是 10 MiB（已核对 Chromium 源码常量，见 §6）；Firefox 明显更小，
本文档记的"5 MiB 量级"**当时就没实测**。最坏情况 2.96 MiB 在 5 MiB 下占 **59%** —— 能活但更紧。
踩到上限**不会崩**（写失败返回 `false` 并出提示，不是静默吞掉），代价只是新一轮拉取存不下来。

**③ `document-start` 的时机**

`main.tsx` 里 `mount()` 直接 `document.documentElement.appendChild(host)`，
紧接着 `observer.observe(document.documentElement, ...)` —— 若某引擎在 `document-start` 时
`documentElement` 还是 `null`，这两处都会抛，整个脚本就死了。Chrome 上不会，**Firefox 未验证**。
兜底办法：拿不到就等一次 `DOMContentLoaded` 再挂。

> **排查入口**：用户在 Firefox / Edge 报"页面全空"或"没有数据"时，
> **先查 ①** —— 按 F12 看 `x/web-interface/nav` 的返回码是不是 `-101`，再去怀疑 ②。
> 三个浏览器的验证清单：装 Tampermonkey → 打开 `/agent-feed` → 看到卡片墙 + 侧边栏有分组
> → 模式 2 点「拉取更多」能出内容（这一步同时验证了沙箱里的 `fetch` 带 cookie 和 `localStorage` 可写）。

### 手机端可行性 —— 2026-09-19 核实，**代码未改动**

用户问过"这个脚本能不能做成手机 app"。当时选择只记录、不动代码。
**用户是 Android** —— 所以下面 iOS 相关的坑不适用于他，但仍然记下来，因为开源后可能有人用 iPhone。

**结论：能，但"做成 app"和"在手机上用"代价差几百倍。最省事的路可能根本不用做 app。**

#### ① 可能根本不需要做 app

Tampermonkey [官方 FAQ](https://www.tampermonkey.net/faq.php?locale=zh&q=Q406)（2026-09-19 现查）
明确支持手机端，同一份 `dist/bili-follow-feed.user.js` 可以直接装：

| 平台 | 怎么装 |
|---|---|
| **Android** | **Firefox Android 版** 或 **Microsoft Edge Android 版**（Kiwi 能装旧版 MV2，但官方原文注明 *unmaintained*，强烈建议换掉） |
| iOS | App Store 上的 Tampermonkey（Safari 扩展） |

**但有两个手机特有的坑：**

**A. 布局是桌面优先的，手机上会很难看（这条有据可查）**

- `.bff-side { width: 260px; flex: none }` —— 固定宽度且**不收缩**。390px 宽的手机上侧边栏占 **67%**，内容区只剩 130px
- 网格只有三个断点：4 列 / `≤1400px` 3 列 / `≤900px` 2 列 —— **没有手机断点**，所以手机上永远 2 列，每张卡约 180px
- 要能用，至少得加一个 ~600px 断点：侧边栏变成抽屉/浮层，网格降到 1–2 列

**B. iOS Safari 的「7 天清空脚本可写存储」（ITP）**

WebKit 有"7 天无交互就清空脚本可写存储"的策略（[WebKit bug 209501](https://wiki.webkit.org/show_bug.cgi?id=209501)、
[Didomi 的说明](https://docs.didomi.io/releases-and-announcements/announcements/apple-implements-7-day-cap-on-script-writable-storage)）。
**这正打在本应用的命门上** —— 它整个"记忆"就是 localStorage（§6 实测最坏 2.96 MiB）。

> ⚠️ **没有在真机上确认当前是否仍然如此**，按"需要实测"对待。**Android 没有这个问题。**

#### ② 真要做成 app 的墙：认证（这是整件事的关键）

本项目能**零凭据**运行（§0 核心承诺、§1「明确不做」），全靠它**寄生在 `www.bilibili.com` 这个源里** ——
`fetch` 到 `api.bilibili.com` 时 SESSDATA 是自动带上的。

**一旦离开这个源（app 的 WebView 有自己的 origin、PWA 有自己的域名），这条路就断了。而且不是配一下 CORS 能解决的：**

> 跨源**带凭据**的请求，要求服务端返回 `Access-Control-Allow-Origin: <你的确切源>`
> **且** `Access-Control-Allow-Credentials: true`。而 `ACAO: *` 与"带凭据"在规范上互斥。

B站 的接口是给站内页面用的，不会为第三方源这么做。
**而且本项目自己已经证明了"匿名跨源"没用** —— §5⑬ 记录着：`feed/all` 匿名访问返回 **`-101 账号未登录`**。

**这是浏览器规范层面的限制，不是 B站 小气。** 所以任何"自己的源"方案都绕不开：
要么走**原生 HTTP**（原生没有同源策略 —— CORS 是浏览器概念），要么加**后端代理**（违背"不建后端"）。

#### ③ 三条路线

| 路线 | 认证怎么解决 | 能复用多少 | 代价 |
|---|---|---|---|
| **A. 套壳 WebView，注入进 bilibili.com**<br>（Capacitor / Tauri Mobile / 原生 WebView） | **不用解决** —— WebView 本身就是 bilibili.com 源，cookie 天然带上 | **几乎全部**：直接把 `dist` 注进去。因为还在 bilibili.com 源里，**连 localStorage 数据层都不用动** | 改动最小。但要在 WebView 里让用户登录一次；上架苹果商店有被拒风险（4.2「最低功能性」）；本质还是"用网页" |
| **B. React Native 重写 UI + 原生 HTTP** | **需要登录流程，并且要把 SESSDATA 落到设备上** | **纯逻辑几乎原样搬**（§10 C 估约 70% 平台无关）；storage 从 localStorage 换成 MMKV/AsyncStorage，**配额焦虑彻底消失** | UI 要重写（1275 行 `styles.css` 在 RN 里没有对应物）；**破坏"零凭据落地"的承诺** |
| **C. PWA** | 同一堵墙，而且 **PWA 修不了 CORS** | UI 全部复用 | **最不划算** —— 既没有 A 的免认证，也没有 B 的原生能力 |

#### ④ 若将来真要做，必须先拍板的一件事

**B 路线绕不开：要不要把 SESSDATA 存到手机上。**
SESSDATA 等于账号的完整访问权，与 §1「明确不做」里的"不落地任何 Cookie / 登录凭据"**直接冲突**。
**这是账号安全边界，不是技术选型，必须用户自己决定，不能替他选。**

#### ⑤ 给 Android 用户的建议顺序

1. **先零代码试**：Firefox Android / Edge Android + Tampermonkey，装同一份 `dist`。
   唯一要补的是上面那个**手机断点**（否则侧边栏吃掉 2/3 屏幕）
2. 想要"真的是个 app"、且能接受它本质是网页 → **A**
3. 想要原生体验 → **B**，但必须先回答 ④

---

## 10. 待办与未来计划

### A. 模式 2 —— ✅ **已实现**（v0.9.0 – v0.9.4）

用户要的"按 UP 逐个拉取"已经落地。设计定稿在
`docs/specs/2026-09-13-mode2-up-pull-design.md`（含决策记录表、实测结论、以及 §13 那个"分页位移"的确认）。
**当前没有排队的用户需求。** 下面 B–D 是已知欠债，都需要用户点头才动。

### B. `feat/history-fill` 分支（**建议删除，待用户决定**）

已被模式 2 取代。它的 `upHistory.ts` 没有"空结果也算查过"的概念 —— 正是 v0.9.1 那个
无限重拉 bug 的来源。唯一还值得看一眼的是它曾经把版本号写成 `0.9.0`、**与主线撞号**（见 §2）。

### C. 长期方向（用户问过，未动手）

- **手机端**：用户问过"能不能做成手机 app"。完整分析（三条路线、认证那堵墙、为什么 PWA 最不划算）
  在 §9 末尾「手机端可行性」。**一句话**：Android 上可以先零代码用（Tampermonkey 官方支持
  Firefox/Edge Android），唯一要补的是**手机断点**；要真做成 app 则必须先在"SESSDATA 要不要落盘"上拍板
- **跨平台**（抖音等）：技术上可行，约 70% 代码平台无关。但障碍是**认证 + 签名**，不是跨域。
  - 抖音最硬（`X-Bogus`/`a_bogus` 签名），**性价比可能是负的**
  - 甜点区：RSS → B站 → YouTube
  - 最难的是**产品问题**：同一个人在 B站 和抖音是不同账号，"统一的我关注的人"做不到，实际会是"N 个并排的关注流共用一套分组"
  - ⚠️ 注意与手机端**不是同一堵墙**：跨平台卡在"签名"，手机端卡在"同源/cookie"
- **架构泛化**：把 `platform + videoId + creatorId(字符串)` 替换掉 `bvid + upMid(number) + url`。**不做的话将来加平台会更痛**（且需要一次存储迁移）
- **本地历史累积**：零请求成本，能覆盖大部分"无限制"的实际需求

### D. 可维护性欠债

- `App.tsx`（**1078 行**）拆 hooks —— 模式状态、拉取编排、两套板块渲染都挤在这里
- `bff:schemaVersion` 要么接上、要么删掉（现在是空转）
- `.bff-picker` / `.bff-gmenu` 的定位已抽成共用 hook，但 CSS 仍集中在一个 `styles.css`（**1275 行**，可拆）
- **`useFollowings` 没有测试** —— 它是 `decidePaging` 那个"`total` 优先"bug 的宿主，
  而 `followingsPaging.ts` 只有 8 个测试。这是当前测试覆盖最薄的一块
- **图文多图预览**没做（现在只显示第一张 + 图片数角标）
- **`MAX_UPS = 600` 没有界面提示** —— 超过之后计数器会永远到不了满分，用户无从得知原因
  （`checkedCount - cachedCount` 已经有"（N 个无内容）"的解释，但"被淘汰了"没有）

---

## 11. 模式 2 的五个确认点（**已全部确认并实现**）

> 保留这一节是因为**这五条是模式 2 最容易搞错的地方**，而且每条都有"看起来合理但其实不对"的备选。
> 完整决策记录在 `docs/specs/2026-09-13-mode2-up-pull-design.md` §0。

用户要的是一个**模式切换**：

```
工具条：  [动态流 | UP 主拉取]
```

**模式 1（默认）**：全局动态流 + 时间窗翻页。

**模式 2：UP 主逐个拉取**

```
┌─ 游戏 (19 个 UP) ──────────────────────  ⠿ ↑ ↓ ┐
│  [卡片][卡片][卡片][卡片] …                     │
│  [ ⟳ 拉取更多 ]  已保存 12 / 19 个 UP  [ ⤓ 多看一条 1/5 ] │
│    第 1-20 条 / 共 38 条   ‹ 1 2 ›             │
│  上次拉取：新增 7 个 UP 的内容                    │   ← .bff-upstatus
└────────────────────────────────────────────────┘
```

| # | 问题 | **确认结果** | 被否掉的备选 / 代价 |
|---|---|---|---|
| 1 | "每次一条"的语义 | **逐层展开**（点第 N 次 = 每个 UP 显示第 N 新的那条） | 另一种理解是"逐个 UP 展开"。**最终拆成了两个按钮**：「拉取更多」扩大 UP 覆盖、「多看一条」加深层数 |
| 2 | 请求预算 | **一次拉该板块全部 UP，每 ~20 个停 2 秒**，随时可暂停；**不设硬上限** | 早期设计是"每批 20 个 UP + 轮回 + 规则 B"，**整套作废**。代价：大板块要拉几分钟，靠暂停按钮兜住 |
| 3 | 页码 vs 拉取结果的交互 | **维持原样** | 另两个选项是"拉完跳到最后一页"和"显示每个 UP 已显示几条"。代价：**第 3 页时新内容不在这一页**（详见设计文档 §13） |
| 4 | 刚切到模式 2 显示什么 | **先显示缓存里已有的** | 备选是空板块 + 按钮。选缓存是因为它零请求、秒出 |
| 5 | 时间窗选择器 | **模式 2 下隐藏** | 时间窗是动态流概念，模式 2 没有"窗口"这个维度 |

**另外几个一并确认的**：模式 2 隐藏「未分类」和「隐藏」板块；「多看一条」到第 5 层禁用并显示"已全部显示"；
暂停是**真暂停（可续）**；其他板块计数下降时**给提示**。

### 工作约定（**用户明确要求过，必须遵守**）

| 用户说的话 | 我的动作 |
|---|---|
| 「讨论」「想想」「有没有别的方案」「分析一下」 | **只输出分析**，最后问"要不要我做"，**不动代码** |
| 回答我的设计问题 | **不等于**让我开工 |
| 明确说「做 / 开始 / 改吧 / 实施」 | 才动手 |

**边界不清时按"不动手"处理。** 宁可多问一句，也不再多做一件。

> **这条约定是有来历的**：用户说"接着讨论"，我给了分析、丢了个设计选择题，
> 用户**选完之后我就当成开工指令直接把整块做完了**。这正是 `feat/history-fill` 分支的由来（见 §2）。
> 用户明确表达了不满。**"回答一个问题"永远不等于"授权一件事"。**

---

## 12. 一句话给接手者

**这是一个"每加一个平台/功能都会先量再写、每个决定都留下原因"的项目。** 它的价值不只在代码，还在 `docs/` 里的实测结论和 §8 那份 bug 类别学 —— **改任何东西之前，先读 §5 和 §8，能省掉大部分返工。**
