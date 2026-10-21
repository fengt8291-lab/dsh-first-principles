# dsh-first-principles

可核验的第一性原理台账，给 [DeepSeek Harness](https://github.com/deepseek-ai) 用。

**一句话**：让模型在动代码之前，把「它到底依据什么」写成一份机器能查的台账——每条事实必须落回真实的 `文件:行` 并附该行原文，每条假设必须写得出证伪条件，结论依赖的假设必须挂进 Revisit。查不过，就别动手。

> Not a "think harder" prompt. A machine-checked reasoning artifact: every fact must resolve to a real `file:line` with a verbatim excerpt; every assumption needs a falsifier; conclusions must hang on the chain and carry an expiry date.

## 60 秒上手

```bash
# 1. 在 DSH 里装（从解压后的目录）
plugin_manager install_bundle  target=/绝对路径/plugin
# 2. 重启 DSH，然后刷新网页
# 3. 让模型拿一份骨架
first_principles_check
```

装好之后，对话输入框下方会多出一条「第一性原理」状态栏：点一下切开关闸门，展开看 14 天趋势、最常被拦下的错误码、本会话已经修掉哪几个错误码、哪份台账该复查。数据来自项目里的 `.fp/runs.jsonl`，只读本地文件，不发任何网络请求。

骨架里 F1/F2 直接引用你项目里的真实文件行，开箱就能 `pass`。把它填完，再调一次校验：

```
first_principles_check path=.fp/ledgers/我的判断.md
```

## 它到底查什么

| 它想跳过的那一步 | 查什么 | 错误码 |
| --- | --- | --- |
| 懒于读文件，凭先验回答 | 每条事实带 `路径:行` + 该行原文 | `E004` `E005` `E006` |
| 把猜测写成事实 | 引文逐字比对（只归一化空白） | `E006` |
| 提无法检验的假设 | 必须有 `falsify:` | `E008` |
| 用「需要进一步研究」拖 | 每个 Open 项要有 `resolved(...)` / `deferred(原因)` | `E012` |
| 悬空的结论 | `depends:` 必须接在推导链上且不成环 | `E009` `E010` `E011` |
| 假装知道边界 | 结论能到达的假设必须进 `Revisit` | `E014` |
| 用自己的结论证明自己 | 事实不能引用台账目录 / 决策文档 / 自己 | `E017` |

再加三个给结论「保质期」的头部字段：`review_after`（到期提醒）、`confidence`（0–1）、`kill`（什么情况下承认判断失败）。

## Web 面板

| 看到什么 | 含义 |
| --- | --- |
| 闸门：开 / 关 | 点一下切换（本次运行内生效，重启回到 `gate` 配置值） |
| N 次校验 · 拦下 M | 本会话的记录条数、`fail` 条数 |
| 已修 X 个错误码 | 同一份台账相邻两次校验里**消失**的错误码——这一轮真的修掉了什么 |
| K 份台账 · 过期 n | 台账通过/失败、`review_after` 到期提醒 |

面板只是展示层：它不改判定、不写台账，读的是检查器早就落盘的数据。

## 命令

面板没出现时先跑 `/fp doctor`：它会打印插件版本、项目根、面板路由是否注册、闸门状态与记录条数。

| 命令 | 作用 |
| --- | --- |
| `first_principles_check` | 不给参数：打印带真实引用的骨架；给参数：校验 |
| `/fp status` | 校验项目里所有台账，标出到期与缺止损的 |
| `/fp stats` | 它到现在帮你拦下了多少错（读 `.fp/runs.jsonl`） |
| `/fp gate [on\|off]` | 可选闸门：不可逆操作前问一句（默认关），并检查台账 `scope` 是否覆盖要动的东西 |
| `/fp reanchor` | 代码改过、行号漂了？按引文重新锚定 |
| `/fp review 2026-11-20` | 盖下次复查日期 |

## 诚实说边界

- 它**不判断推导对不对**，只判断有没有出处、闭没闭合、复不复核得了——语义正确性只能靠人。
- 闸门默认关；打开也只「问一句」，不阻断。
- 台账是一次性的，不跨会话继承。
- 它要你**改文档时顺手改台账**（否则 `E006` 会抓住你）。这不舒服，但正是它有用的地方；`/fp reanchor` 把这件事降到一条命令。

## 零依赖

`dependencies: {}`、`schema=0`，只用 Node 内置模块；台账是纯 Markdown，不写数据库、不建服务。

## License

MIT
