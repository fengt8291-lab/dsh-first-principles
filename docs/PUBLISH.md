# 发布清单（dsh-first-principles）

> 状态：**包已备好，只差你的 npm 账号。** 本机 `npm whoami` = `ENEEDAUTH`，我没有你的 token，也不该有。
> 本文件是"谁做什么"的分界线：凡需要你账号或身份的动作，只由你执行。

## 1. 现在就能确认的事实

| 项 | 结果 | 怎么确认的 |
| --- | --- | --- |
| 包名占用 | `dsh-first-principles` 未被占用 | `npm view dsh-first-principles version` → `E404` |
| 打包内容 | 21 files / 39.2 kB tarball / 112.0 kB unpacked（含 `client.js` 与 `src/panel*.js`） | `npm pack --dry-run` |
| 关键文件齐全 | `cordis.patch.yml`、`icon.svg`、`README.md`、`LICENSE`、`src/*` 全在内 | 同上输出 |
| 依赖 | 零依赖、`schema=0` | `package.json` 无 `dependencies` |
| 许可证 | MIT | `plugin/LICENSE` |
| 版本 | `0.3.1` | `plugin/package.json` |

## 2. 需要你做的（三步）

```bash
# ① 登录（一次性，token 存本机，不要发给我）
npm login            # 若开了 2FA，按提示输一次性码
npm whoami           # 应该打印你的用户名，而不是 ENEEDAUTH

# ② 告诉我"可以发了"
# ③ 发布由我执行（下一节），或者你自己跑那两条命令
```

发布前**必须**再重启一次 DSH——M5 的闸门和 `/fp gate` 是启动时注册的，当前进程还是 M4。

## 3. 发布动作（我执行，或你照着跑）

```bash
cd plugin
npm publish --access public
npm view dsh-first-principles version     # 应打印 0.3.1
```

发布后**不要**立刻改版本重发。若发错了：72 小时内 `npm unpublish dsh-first-principles@0.3.1`，超时只能 `npm deprecate`。

## 4. 仓库（已完成）

代码已推上 GitHub（本机 github.com:443 被网络挡住，走的 api.github.com 建 blob/tree/commit）：

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/fengt8291-lab/dsh-first-principles |
| 可见性 | public，45 个文件、2 个 commit |
| topic | `dsh-plugin`、`dsh`、`deepseek`、`reasoning`、`decision-ledger` |
| 插件包位置 | 仓库子目录 `plugin/`（monorepo 子包形态） |

推代码用的脚本：`/tmp/push-via-api2.py`（blob → tree → commit → ref；空仓库先 PUT 一个 `.gitignore` 建首 commit）。

## 5. 发布后验证（必须做，别信"发布成功"这四个字）

新开一个临时 profile 装回来，证明"别人的电脑上也能用"：

```bash
dsh --profile <temp-profile> plugin add dsh-first-principles@0.3.1
# 启动后 /fp status 应能跑；first_principles_check 应返回骨架
```

在装回来之前，先确认这台机器上的旧版本已卸载，否则你验证的是 `link:` 而不是 npm 包。

## 6. 进市场（PR 已备好，等仓库满 24 小时）

收录规则来自 `https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md`：

- 一个 PR 只加**一个文件**：`data/plugins/<owner>__<repo>.yml`（monorepo 子包用 `--<子目录>` 后缀）。
- 仓库 `package.json` 必须声明 `dsh.bundle`（我们是 monorepo 子包，`plugin/package.json` 满足）。
- 仓库必须**创建满 1 天**（CI 自动查），并带 `dsh-plugin` topic。
- 描述必须与代码一致，不吹；只有 `description.en` 是必填。

本地已备好的条目：`docs/market/fengt8291-lab__dsh-first-principles--plugin.yml`

```yaml
url: https://github.com/fengt8291-lab/dsh-first-principles/tree/main/plugin
name: fengt8291-lab/dsh-first-principles#plugin
category: workflow
description:
  en: '...'   # 全文见上面那个文件
  zh: '...'
```

提交时机：仓库建于 2026-10-20 22:46，**2026-10-21 22:46 之后**再开 PR；提前开 CI 会因仓库年龄挡下（指南说这不影响重新提交）。

## 7. 版本策略

| 改动 | 版本 |
| --- | --- |
| 修 bug、改文案、补测试 | patch（0.2.x） |
| 新错误码、新命令、新配置项 | minor（0.x.0） |
| 台账格式破坏性变更 | minor 且在 `docs/LEDGER-FORMAT.md` 写迁移说明（0.x 阶段不升 major） |

## 8. 发布前的已知缺口（不阻塞，但要诚实）

- 示例台账只有 1 份（`examples/trial-length.md`），计划补到 3 份。
- README 主文档是中文，`plugin/README.md` 有英文段；市场条目两种语言都写了。
- 跨会话台账继承（M3.6）、纠错可视化面板（M7）均未做，README §7 已如实标注。
