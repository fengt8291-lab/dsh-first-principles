# 发布清单（M6）

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

## 4. 发布后验证（必须做，别信"发布成功"这四个字）

新开一个临时 profile 装回来，证明"别人的电脑上也能用"：

```bash
dsh --profile <temp-profile> plugin add dsh-first-principles@0.3.1
# 启动后 /fp status 应能跑；first_principles_check 应返回骨架
```

在装回来之前，先确认这台机器上的旧版本已卸载，否则你验证的是 `link:` 而不是 npm 包。

## 5. 进市场

市场索引 `Awesome DSH Plugin`（`https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`）里的条目是**包名 + 简介 + 分类**。当前 3112 条里 `first principles` 命中 0 条、`ledger` 22 条（全是记忆/成本类，无校验类），见 `docs/evidence/market-scan-2026-10-20.md`。

提交方式：走索引仓库的 PR（具体仓库地址在发布当天以索引页脚为准，此处不写死，避免又一条会烂的链接）。条目建议：

```yaml
name: dsh-first-principles
description: 可核验的第一性原理台账：事实必须落回真实 file:line，假设必须可证伪，结论必须挂到期日
category: 推理与决策
```

## 6. 版本策略

| 改动 | 版本 |
| --- | --- |
| 修 bug、改文案、补测试 | patch（0.2.x） |
| 新错误码、新命令、新配置项 | minor（0.x.0） |
| 台账格式破坏性变更 | minor 且在 `docs/LEDGER-FORMAT.md` 写迁移说明（0.x 阶段不升 major） |

## 7. 发布前的已知缺口（不阻塞，但要诚实）

- 示例台账只有 1 份（`examples/trial-length.md`），计划补到 3 份。
- README 主文档是中文，`plugin/README.md` 有英文段；市场条目两种语言都写了。
- 跨会话台账继承（M3.6）、纠错可视化面板（M7）均未做，README §7 已如实标注。
