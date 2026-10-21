# First Principles · DSH 插件（M5）

让模型在非平凡任务前，先把「它到底依据什么」写成一份**机器可校验**的台账；校验不过，就别动手。

```
first_principles_check  →  骨架 / 校验
/fp                     →  用法 · status · stats · gate · reanchor · review
```

M4 之后它还能：给结论一个**保质期**（`review_after` / `confidence` / `kill`）、代码改动后**按引文重锚行号**、把每次校验记成**可统计的纠错数据**（`/fp stats`，也是以后可视化面板的数据源）。M5 加了**可选闸门**：打开后只在不可逆操作前问一句，默认关。

---

## 1. 它解决的问题

「第一性原理思考」的提示词几乎没有用处，因为**说它好，就等于让它骗你**：只要它写"因此，从第一性原理出发……"，你无法分辨它是真的推过，还是把结论重新排了一下版。

这个插件不去要求它"更深刻"，而是给它一件**必须交的、能被第三方验证的实物**：

| 它想跳过的那一步 | 校验器要求的东西 | 不满足时 |
| --- | --- | --- |
| 懒于读文件，直接凭先验回答 | 每条事实必须带 `路径:行` + 该行原文 | `E004`/`E005`/`E006` |
| 把猜测写成事实 | 引文逐字比对（只归一化空白） | `E006` |
| 提出无法检验的"假设" | 每条假设必须有 `falsify` 字段 | `E008` |
| 用"需要进一步研究"拖延 | 每个 Open 项必须有终态 `resolved(...)` / `deferred(原因)` | `E012` |
| 给出一个悬空的结论 | 结论 `depends` 必须接在推导链上，且不成环 | `E009`/`E010`/`E011` |
| 假装知道边界 | 结论能到达的每条假设，必须写进 `Revisit` | `E014` |
| 用自己的结论证明自己的结论 | 事实不能引用台账目录、决策文档或自己 | `E017` |

关键取舍：**只围栏化那些能自动判定的错误**。它不判断推导是否"正确"（那只能靠人），只判断这份推理是否**有出处、闭合、可复核**。

## 2. 装了什么

| 部件 | 作用 |
| --- | --- |
| 提示段 `first-principles` | 常驻系统提示，约 120 token：什么任务要建台账、六段怎么写、什么任务别建 |
| 工具 `first_principles_check` | 不传参返回骨架（F1/F2 直接引用真实文件行）；传参校验并给出错误码 |
| 跨会话锚点 | 新会话开始时，模型传 `context: true`（或你敲 `/fp context`）就能读到最近 3 份台账的**问题 / 结论 / 未决项 / 复查日期**；另加 `W008`：项目里还有另一份没过期、问法不同的台账时提醒一句。这是「工具 + 命令 + 提示」，没有自动改写系统提示 |
| 斜杠命令 `/fp` | `/fp` 用法 · `/fp status` 汇总所有台账（含过期标记）· `/fp stats` 纠错统计 · `/fp gate [on\|off]` 开关闸门 · `/fp reanchor` 按引文重锚行号 · `/fp review <日期>` 盖复查日期 · `/fp context` 看上次会话判了什么、还有什么没定 · `/fp doctor` 看面板/命令/数据面状态 · `/fp <文件>` 校验指定台账 |
| 可选闸门（默认关） | `gate: true` 或 `/fp gate on` 后，`rm -r`、`git push --force`、`git reset --hard`、`npm publish`、`gh * delete`、`docker rm`、`kubectl delete`、`drop table`、`dd` 写盘这类**不可逆**操作前问一句；有一份通过、未过期、**且 scope 覆盖这次要动的东西**的台账才放行；指不出路径的整仓操作（`git reset --hard` 等）、项目外路径、带通配符的目标不判断，读操作与可逆写零打扰 |
| 运行记录 `.fp/runs.jsonl` | 每次真实校验追加一行（verdict / 错误码 / 条数 / 耗时），只追加、坏行跳过，供统计与以后的可视化面板用 |
| 闸门记录 `.fp/gate.jsonl` | 每次闸门判断追加一行（规则 / 工具 / 询问或放行 / 放行依据的台账），用来观察误拦 |
| 面板（Web UI） | 输入框下方（`conversation.composer.dock`）一条「第一性原理」状态栏：**点一下切闸门**、看本会话已修掉几个错误码、台账是否过期、最近校验与闸门判定；展开看 **最近 14 天趋势**（绿=通过、红=拦下）与**最常被拦下的错误码**、最近校验与闸门判定（含「scope 未覆盖」这种原因）。数据面是 `/x-first-principles/state`；面板代码在**重启 DSH**、刷新页面后才挂上（工具/命令/面板都在启动时注册一次） |

## 3. 目录

```
plugin/
  package.json           dsh.bundle.patch 指向 cordis.patch.yml
  cordis.patch.yml       insert 一行 id: first-principles
  index.js               apply()：注册提示段 / 工具 / 命令 / 闸门 / 面板数据面
  client.js              Web UI 客户端模块（注册到 conversation.composer.dock）
  src/ledger.js          台账解析 + 21 个错误码 + 7 个警告 + 规模闸门
  src/evidence.js        引文校验、glob、目录越界、BOM/二进制/大小上限
  src/meta.js            review_after / confidence / kill 的解析与日期运算
  src/root.js            项目根定位（子目录、monorepo、任意技术栈）
  src/reanchor.js        按引文重新定位行号、改写复查日期
  src/runs.js            运行记录与纠错统计（以后的可视化数据源）
  src/anchor.js          跨会话锚点：抽取上次的问题/结论/未决/复查
  src/gate.js            可选闸门的不可逆规则表与判断日志
  src/panel.js           面板数据：台账状态 / 会话过滤 / 每轮修复差集
  src/panel-route.js     面板 HTTP 面（GET /state、POST /gate）
  src/template.js        骨架生成（任意项目结构都能探到可引用行）
  src/prompt.js          提示段与用法文案
  src/report.js          面向模型的结果渲染
tests/                   89 个测试（校验器/闸门/可移植性/装配/面板/锚点）
examples/trial-length.md 示例台账：业务决策（试用期从 14 天改 7 天）
docs/LEDGER-FORMAT.md    格式规范与判定边界
docs/DIRECTION.md        方向与路线（含 kill criteria）
docs/RESEARCH-first-principles.md  调研与方法论
docs/REVIEW-of-research.md         对调研的评审
docs/evidence/           外部证据摘录（事实只能引这里，不能引决策文档）
PLAN.md                  完整设计与里程碑
```

## 4. 开发与安装

```bash
node --test tests/*.test.js     # 89 passed（校验器 28 / M4 17 / 闸门 12 / 可移植性 7 / 装配 8 / 面板 10 / 锚点 7）
```

已发布到 npm（线上是 `0.3.1`；本地这版是 `0.4.0`，面板 v2 与闸门相关性，等你确认后我再发），别人这台机器上的装法二选一：

```bash
npm install dsh-first-principles          # 或在 DSH 里：plugin_manager install_bundle target=dsh-first-principles@0.3.1
```

安装（由 DSH 的插件管理器完成，不要手写 profile 的 package.json / patch）：

```
plugin_manager install_bundle  target=<plugin 绝对路径>
```

本机是 `link:` 方式装入的，所以 **改完代码重启 DSH 就生效，不用重装**；工具和斜杠命令在启动时注册一次，重启前跑的还是旧版。

给别人用，现在有两条路：

1. **今天就能用**：把 `plugin/` 整个目录打包发过去，对方在自己的 DSH 里 `install_bundle target=<解压后的绝对路径>`（零依赖，不需要 npm 账号）。
2. **发布与市场**：`0.3.1` 已发 npm；市场 PR [#8417](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/8417) 已开，正等仓库年龄检查自动转绿（约 2026-10-21 22:43 后）。流程与坑见 `docs/PUBLISH.md`。

### 已实测

- 包零依赖、`schema=0`，以 `link:` 方式装入 `~/.dsh/profiles/desktop`，`application: applied`
- profile 里落了三条：`dependencies["dsh-first-principles"] = link:<本目录>/plugin`、`dsh.profile.bundles` 追加一项（32 条）、`node_modules/dsh-first-principles` 软链
- 宿主侧 `cordis_inspect_query(host / Tool / listTools)` 能看到 `first_principles_check`，schema 与源码一致
- 提示段已实时注入当前会话的系统提示——本机这一轮对话顶部那段「第一性原理台账」就是它，装完立刻生效，无需重启
- 校验器行为实测：刚生成的骨架 `pass`（0 error / 0 warning）；同一份骨架改成"引一条不存在的行 + 编一句原文 + 假设不落 Revisit"后 `fail`，恰好报 `E005`（行号越界）、`E006`（引文不符）、`E012`（Open 无终态）、`E013`+`E014`（无失效条件）
- 宿主模拟 smoke（`fake ctx` → `apply()` → 真调 `tool.execute` / 命令 handler）：骨架 `pass` → 在引用文件顶部插两行 → `fail E006` → `/fp reanchor` 把 `:2` 改回 `:4` → 再跑 `pass`；`/fp status`、`/fp stats`、`/fp review` 的输出与 `.fp/runs.jsonl` 记录一致
- 闸门用例 8 个：关着零打扰、打开后 `rm -rf` 询问并落一行日志、有通过台账时放行、普通命令不碰、`/fp gate on|off` 切换、日志坏行跳过；工具返回值的 `ledgerPath` 恒为字符串（宿主按 schema 校验，`null` 会让整次调用报错——这条是重启后实跑才发现的）
- 用例 66 个（校验器 28、M4 17、闸门 8、可移植性 7、装配 6），`node --test` 全绿

### 安装时补过的 profile 配置（插件无关，是被 pnpm 12 的供应链策略拦下后必须补的）

`~/.dsh/profiles/desktop/pnpm-workspace.yaml` 现在多了三项：

```yaml
storeDir: /Users/typhoondemac/Documents/deepseek-harness/default-workspace/.dsh-work/pnpm-store/v11
minimumReleaseAgeExclude: [ ... 14 个既有依赖 ... ]   # pnpm 自动补
allowBuilds:                                          # 5 个既有包，显式不跑构建脚本
  cloudflared@0.7.3: false
  cpu-features@0.0.10: false
  dugite@3.2.3: false
  protobufjs@7.6.6: false
  ssh2@1.17.0: false
```

`storeDir` 对齐的是 profile 里 node_modules 原本链接的来源库（此前 pnpm 想改用 `~/Library/pnpm/store`，因此拒绝安装）；`allowBuilds` 我选了 `false`——不执行第三方 postinstall，本插件零依赖，不需要。

### 换个项目 / 换台电脑也要能用（M4 实测项）

| 场景 | 行为 |
| --- | --- |
| 会话开在子目录（`packages/x`、`src/app`） | 逐层向上找 `.fp/`，再找 `.git` / `package.json` / `Cargo.toml` 等标记；子包自带清单就近停，不把台账写进别人的项目 |
| 不是 JS 项目（Python / Go / Rust / PHP / Java / .NET） | 认 `pyproject.toml`、`go.mod`、`Cargo.toml`、`composer.json`、`pom.xml`、`build.gradle`、`Program.cs` 等清单；没有 `package.json` 也能从源码取事实 |
| 没有 `package.json` 的项目 | 浅扫 3 层源码（200 个文件上限），从真实行取 F1/F2；骨架仍然开箱 `pass` |
| 中文目录 / 文件名带空格 | 引用 `我的 模块/核心 逻辑.ts:1` 照样能核对；`scope` 用逗号分隔，带空格的单条不会被拆碎 |
| Windows | 引用写 `src\a.ts:2` 也认（比对前统一成 `/`）；CRLF 台账、BOM 证据文件都能校验 |
| 超大 / 超长 | 证据文件默认 2MB、台账 4MB / 5000 条封顶（`maxFileBytes` / `maxEntries` / `maxItems` 可配），超了给明确错误码而不是卡住 |
| 上万文件的项目 | `scope` 扫描默认 2 万文件；到上限时提示"可能只是没扫到" |
| 代码改过、行号漂了 | `/fp reanchor` 按引文唯一匹配改回行号；找不到或多处匹配只报告，不猜 |
| 斜杠命令没生效 | 症状：输入的 `/fp …` 被当成普通消息发给模型。原因：`commands` 服务在插件加载时可能未就绪，`ctx.get('commands')` 返回 `undefined` 被静默跳过。本版改用 `ctx.inject(['commands'], …)` 等它就绪，并在 `/fp doctor` 与面板状态里报「斜杠命令：已注册 / 未注册」 |

这些行为都有用例：`tests/portability.test.js`（7 例，现搭 Python / Go / Rust / monorepo / 中文空格路径 / 裸目录 / 自定义台账目录），连同其余几份共 66 例，`node --test` 全绿。

## 5. 设计约束（为什么这样做）

- **不监听 `system-prompt/assemble` 拼字符串**：提示文本走 `systemPrompt.section()`，按层排序、可被上层 shadow。
- **不新增 session 事件类型**：台账状态就是磁盘上的文件，工具每次现读。派生状态塞进事件流会让它变成第二个真相源。
- **闸门走 `tools/pre-execute`，且默认为关（M5）**：`guard` 只能同步 deny，而"问人"必须异步，所以用瀑布监听器返回 `ask`。只认不可逆操作；读操作与可逆写不拦——误拦一次，用户就会把整个插件关掉。
- **闸门放行条件是「有通过且未过期的台账」，不判断相关性**：判断"这份台账是否覆盖这次操作"需要语义理解，我们不做假精确；文档里写明这一点。
- **工具同时接 `document` 参数**：不落盘也能校验，便于测试和"只想检查一下"的场景。
- **返回值必须过 schema**：`ledgerPath` 恒为字符串（inline 时为空串）。宿主会校验，一个 `null` 就能让整次工具调用报错。
- **骨架开箱即过**：`buildTemplate` 从真实文件取行，F1/F2 天生满足 `E003/E006`——否则生成器本身就在教模型糊弄。
- **cwd 三级兜底**：`agent.session.header.cwd` → `workingDirectory` 服务 → 进程 cwd。工具和命令拿到的 agent 不保证带 cwd。
- **根目录就近停**：自带 `package.json` 的子目录不会被拉到外层 monorepo 的 `.fp`；想强制指定就配 `rootDir`。
- **统计只追加、不参与判定**：`runs.jsonl` / `gate.jsonl` 写失败也绝不影响校验与放行；它们只是给「纠了多少错」留证据。

## 6. 已知边界

- 没有 UI 面板（Web 端看不到台账列表，只能 `/fp status` / `/fp stats`）
- 闸门默认关；打开后也只"问一句"，不阻断——批准与否始终是人/模型当场决定
- 不校验语义正确性（见 `docs/LEDGER-FORMAT.md` §5）
- 一次性台账，不跨会话继承（`sessionProjections` 留给 M3.6）
- 英文提示段是简版，中英共用一套 error code
- `scope` 多条必须用逗号分隔；用空格分隔会被当成一个（带空格的）模式
- 引用只认「路径:行」形态；引用整个目录、或用函数名代替行号都不行

## 7. 下一步

| 里程碑 | 内容 |
| --- | --- |
| ~~M5~~（已完成） | **可选闸门**：`gate: true` 时 `tools/pre-execute` 只对不可逆操作返回 `ask`；默认关，可逆操作零打扰 |
| M6 | **分发**：npm 发布 + 插件市场条目 + 双语 README；示例台账 3 份 |
| ~~M7 v1~~（已完成）、M7 v2（已完成） | **纠错统计面板**：`conversation.composer.dock` 里的状态栏 + 详情面板，闸门一键开关、本会话每轮修掉的错误码、台账过期、闸门判定；数据读 `.fp/runs.jsonl` / `.fp/gate.jsonl`；v2 补了 14 天柱状趋势、最常拦下的错误码、闸门判定原因 |

## 8. 方向决策（2026-10-20）

定位调整为“决策的可核验台账 + 检查器”，路线改为“证据落地 → 复查字段 → 可选闸门 → 发布”，细节与 kill criteria 见 [`docs/DIRECTION.md`](docs/DIRECTION.md)；调研依据见 [`docs/RESEARCH-first-principles.md`](docs/RESEARCH-first-principles.md)。
