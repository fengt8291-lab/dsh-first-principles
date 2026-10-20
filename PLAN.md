# 第一性原理插件（DSH）· 实施计划 v0.1

> 工作区：`/Users/typhoondemac/Documents/deepseek-harness/First_Principles`
> 宿主：DeepSeek Harness（Cordis 插件体系，profile 已装 216 个插件）
> 状态：设计稿，待拍板 §9 的三个选择后进入 M0

---

## 一页纸版（不懂代码也能看）

**一句话**：这个插件不是让 AI 变得更有道理，是让 AI **没法假装有道理**。

**它解决什么问题**：AI 很像一个急着交差的实习生。你问「这个功能要不要重写」，它先说「建议重写」，再补三个听起来很对的理由——但那三个理由可能是它现编的，而且你没处查。

**我们的做法**：把「下结论」变成会计做账，再配一个审计。

| 会计里 | 我们这里 |
|---|---|
| 每笔账都要有原始凭证 | 每条「事实」必须能翻到原文第几行 |
| 会计估计必须写清假设 | 每条「假设」必须写「它不成立会怎样」 |
| 报表由分录推出来 | 结论必须列清由哪几条推出来 |
| 附注写「若假设改变则……」 | 结论依赖的假设必须写进「何时作废」 |
| 审计员抽查凭证 | 插件自动核对，编造的直接报错 |

**一个例子**（问「这个功能要不要重写」）：

- 通常的回答：*「建议重写，因为现有代码耦合严重、维护成本高。」*——听着对，无从查证。
- 台账式回答：
  - **事实**：`auth.ts:88` 那一行写着 `if (a && b && c && d)`，四个条件嵌套（机器可核对）
  - **假设**：这段代码平均每月只改一次（如果实际每周都改，结论就变）
  - **结论**：重写的收益主要来自**减少回归风险**，不是「耦合」
  - **何时作废**：最近三个月它若只被改过 1 次，上述收益不成立

**所以我们要写的只有四样东西**：

1. 一张**模板**——规定 AI 按这个格式写，不许散着写；
2. 一个**检查器**——自动挑错：编造引用、漏写假设、结论没依据；
3. 一句**使用说明**——告诉 AI 什么时候用（选型、查 bug、陌生模块），什么时候别用（改个错字）；
4. 一个 **`/fp` 命令**——让你自己也能一键让 AI 交这份「报告」。

你不需要看懂代码，需要决定的是三件事：这东西**有多硬**（提醒／手动／强制）、报告**存在哪**、**先做多大**。见 §9。

---

## 0. 结论先行

想法是好的，但「让模型按第一性原理思考」这句话本身**不能直接变成插件功能**——它太像提示词，而提示词只能让模型**表演**方法论，不能让它**受方法论约束**。

把它变成工程问题的唯一可靠路径是：**给它一个可机检的产物**。

所以我们要写的不是「一个让模型更哲学的工具」，而是：

> **一份必须通过检查的第一性原理台账（First-Principles Ledger）**
> **\+ 一个会拒绝它的检查器**

模型的每一步「第一性原理」推理都要落成同一份结构：证据、假设、待验证问题、推导、结论、失效条件。检查器逐条验证：

- 事实必须带引用，引用必须落到 `文件:行` 上，且那一行**真的写着**那句话；
- 假设必须写清「凭什么成立」和「什么证据会推翻它」；
- 推导只能引用已登记的 ID，不能凭空出现前提，不能成环；
- 结论必须写明依赖链；
- **凡是结论依赖了某条假设，那条假设必须出现在「何时作废」里**。

写完不能自证清白，必须调工具过一遍，拿到 `pass` 才算数。

一句话：**把「想清楚」变成「写出来，并且被查出来」。**

---

## 1. 问题域

### 1.1 现状：模型不缺方法论词汇，缺的是约束

模型可以流畅复述「第一性原理 / 还原论 / 本质思考」，但实际输出通常是：**先有结论，再补三条冠冕堂皇的「因为」**。这类内容读起来像推理，实际是事后合理化——它没有可被推翻的结构。

三个已知的退化形态：

| 退化 | 表现 | 后果 |
|---|---|---|
| 仪式化 | 开场「让我们从第一性原理出发」，然后照旧输出 | 成本增加，质量不变 |
| 过度还原 | 把业务问题一路拆到「物理层」 | 上下文烧光，得到不可执行的结论 |
| 不可审计 | 推理过程自洽但与代码无关 | 错了无人察觉，也无法撤回 |

### 1.2 为什么「加一段提示词」必然失败

提示词是**建议**，不是**约束**。模型对建议的服从度随上下文长度、任务复杂度、上下文工程（compaction）而衰减；更关键的是，**没有任何机制在它编造前提时报警**。文献侧的证据很一致：LLM 在缺失前提时倾向于*填补*而不是*提问*（missing-premise 系列研究），而单纯的自我反思/自我批评收益不稳定（Reflexion、CRITIC 都指出：只有引入外部可验证信号，自纠正才稳定有效）。

### 1.3 判断：杠杆在「产物形状」，不在「提示语气」

推理模型（o1 / R1 类）已经把「内部思考」变强了，但没改变三件事：

1. 它的思考**对外不可检查**；
2. 它的结论**不落到项目上**（换个 session 就没了）；
3. 它错了**不会撤回**。

本插件恰好只做这三件事。

### 1.4 成功标准（可测量）

| 编号 | 标准 | 测法 |
|---|---|---|
| S1 | 事实引用 100% 可解析 | fixture 台账全绿 |
| S2 | 伪造引用会被抓到 | 塞 5 条假引用 → 5/5 报错 |
| S3 | 结论 ↔ 假设依赖可追溯 | `depends:` 能还原成图，闭包正确 |
| S4 | 台账会失效 | 改 scope 内文件 → 状态转 stale |
| S5 | 不干扰普通任务 | 无触发场景时提示词增量 < ~120 tokens，零额外工具调用 |

---

## 2. 相关资料

分四层。每层只保留「它告诉我们什么」，不做文献综述。

### 2.1 方法论源头：为什么「从第一性原理出发」≠「拆解」

- **Aristotle, _Physics_ I.1（184a10–21）**：认知从「对我们更可知」走向「本性上更可知」；第一原理是推不出来的起点。
  → 必须区分「事实」与「起点」，并承认起点不可证——这就是 Ledger 的 Facts / Assumptions 两段。
- **Descartes, _Discourse on Method_ (1637), Part II**：怀疑一切可怀疑的，只在不可怀疑处重建；分解到最简部分，再按序上升。
  → 分解的对象不是问题，是**信念**。
- **物理学实践**（守恒律、对称性作为不可再问的边界条件）：有边界才叫第一性原理，无边界的「本质思考」是玄学。
  → 所以 Ledger 强制 `scope`。
- **Feynman, "Cargo Cult Science" (1974)**：第一原则是「不要欺骗自己」。
  → 检查器的意义就是让自我欺骗有代价。

### 2.2 论证结构的工程化：Ledger 的形状不是我们发明的

- **Toulmin, _The Uses of Argument_ (1958)**：claim / grounds / warrant / backing / qualifier / rebuttal。
  → Ledger 六段几乎是它的工程版：Facts=grounds，Assumptions=warrant+backing，Conclusion=claim+qualifier，Revisit=rebuttal。
- **Rittel & Webber (1973) + IBIS/gIBIS（Conklin & Begeman, 1988）**：Issue–Position–Argument 图。
  → 论点必须挂在未决问题上 → 我们的 `Open` 段。
- **Kelly & Weaver, Goal Structuring Notation（2004）**：assurance case 里每条 claim 必须挂 evidence，且 evidence 可被独立检查。
  → 「结论必须挂证据」的直接先例。
- **Nygard, ADR（2011）**：决策记录 = context / decision / consequences，且只增不改。
  → `Revisit` 就是 consequences；台账保留历史而不是被覆盖。

### 2.3 假设—依赖—撤回：Ledger 的算法内核

- **Doyle, "A Truth Maintenance System" (1979)；de Kleer, "An Assumption-Based TMS" (1986)**：结论携带 justification，前提失效则自动撤回。
  → `depends:` + `stale` 是该机制的轻量版。这是我们**唯一**需要的算法理论。
- **Meyer, Design by Contract（1988/1997）**：前置条件 / 后置条件 / 不变式。
  → 假设 = 前置条件；Revisit = 违约处理。
- **Hughes, QuickCheck（2000）**：可证伪性优先于「证明正确」。
  → 每条假设必须写 `falsify:`，这是可执行的证伪。

### 2.4 LLM 侧实证：什么有效、什么被证伪

| 工作 | 结论 | 对我们的意义 |
|---|---|---|
| Wei et al. 2022（CoT）；Wang et al. 2022（Self-Consistency） | 显式中间步骤有效 | 结构本身有收益，不是形式主义 |
| Yao et al. 2022（ReAct） | 推理与行动交替 | Facts 必须是「行动取回的证据」 |
| Shinn et al. 2023（Reflexion）；Gou et al. 2023（CRITIC） | 自反思需外部信号才稳定 | 检查器必须独立于生成器 |
| Dhuliawala et al. 2023（Chain-of-Verification） | 分步验证降低幻觉 | 报错要逐条、带定位 |
| Tafjord et al. 2020（ProofWriter）；Han et al. 2022（FOLIO，EMNLP 2024）；Parmar et al.（LogicBench，ACL 2024） | 有显式前提时表现好，缺前提时崩 | 「显式化前提」本身就是收益来源 |
| *Premise Removal Interventions*（Findings of EMNLP 2024，[链接](https://aclanthology.org/2024.findings-emnlp.378/)） | 逐条移除前提后模型照样硬推，**不报告信息不足** | Assumptions 段强制 `basis`+`falsify` 的实证理由 |
| Lean 4 / miniF2F（2021）/ DeepSeek-Prover（2024） | 可靠性来自**检查器独立于生成器** | 检查逻辑写在插件侧，不交给模型自评 |

**合起来只支持一个结论**：有效的不是「更好的提示词」，而是「独立检查器 + 显式前提 + 可撤回的依赖图」。这正好是本插件的三根柱子。

---

## 3. 设计：First-Principles Ledger

### 3.1 六段结构

| 段 | 必须写什么 | 检查什么 | 对应 |
|---|---|---|---|
| `Facts` | 事实 + `路径:行` + 原文引用 | 引用是否真的落在那行 | Toulmin grounds |
| `Assumptions` | 假设 + `basis`（凭什么是这样）+ `falsify`（什么会推翻它） | 两者非空且 basis 合法 | warrant + backing |
| `Open` | 未决问题 + `probe`（怎么查）+ 结论（resolved/deferred） | 不许悬空 | IBIS |
| `Derivation` | 推导 + 只允许引用上面的 ID | 引用存在、无环 | 依赖图 |
| `Conclusion` | 结论 + `depends:` 依赖链 | 必须有依赖 | claim + qualifier |
| `Revisit` | 结论依赖的每条假设，都要说明「何时作废」 | 闭包覆盖检查 | rebuttal + TMS |

### 3.2 格式示例（真实诊断场景）

```markdown
# First-Principles Ledger — session-ttl
question: 为什么把 session TTL 从 15 分钟改成 2 小时会引入刷新风暴？
mode: diagnosis
scope: src/auth/**  package.json

## Facts
- F1 · src/auth/session.ts:42 · `const TTL_MS = 15 * 60 * 1000`
  服务端 TTL 只有这一个常量定义，15 分钟。
- F2 · src/auth/refresh.ts:88 · `if (now - issuedAt > TTL_MS / 2)`
  刷新阈值策略上取 TTL 的一半。
- F3 · src/auth/refresh.ts:90 · `refreshes += 1`
  计数只用于指标上报，未参与限流。

## Assumptions
- A1 · basis: inference · falsify: `rg -n "TTL_MS" -g '*.ts'` 能找到第二处定义
  刷新阈值与 TTL 耦合：改 TTL 会同时移动阈值窗口。

## Open
- O1 · probe: `rg -n "refresh" src/auth` · resolved(F2)
  是否还有其他刷新触发点？

## Derivation
- D1 · from F1,F2 · 阈值 = TTL/2，TTL 放大 8 倍 ⇒ 合法刷新窗口从 7.5 分钟拉到 60 分钟。
- D2 · from D1,A1 · 窗口变长后，同一批客户端会在窗口边缘堆积，形成脉冲。
- D3 · from F3,A1 · 计数不产生背压，脉冲不会被吸收。

## Conclusion
- C1 · depends: D2,D3 · 风暴来自「窗口拉长 × 无背压」，与 TTL 数值本身无关。

## Revisit
- R1 · 若 A1 被推翻（存在独立阈值常量）· C1 需整体重推
```

这份台账的价值不在「写得漂亮」，在于：**F2 的引用可以被机器核对**，**A1 的证伪命令可以被执行**，**C1 依赖了 A1 所以 A1 必须出现在 R1 里**。三条都是硬约束。

### 3.3 校验规则（15 errors + 5 warnings）

| code | 级别 | 规则 | 提示 |
|---|---|---|---|
| E001 | error | 缺 `question` / `mode` / `scope` 任一头字段 | 台账没有边界就不成立 |
| E002 | error | `scope` 里某条 glob 匹配不到文件 | 范围写错了 |
| E003 | error | Fact 没有引用 | 事实必须有出处 |
| E004 | error | 引用路径不存在 | 文件被删/写错 |
| E005 | error | 行号越界 | — |
| E006 | error | 引用原文不在该行 | **防伪造的核心** |
| E007 | error | Assumption 缺 `basis` 或不在枚举内 | basis ∈ {convention, inference, prior, unknown} |
| E008 | error | Assumption 缺 `falsify` | 不可证伪的假设不算假设 |
| E009 | error | Derivation 引用了不存在的 ID | 凭空前提 |
| E010 | error | 依赖图有环 | 循环论证 |
| E011 | error | Conclusion 缺 `depends:` | 结论必须挂链 |
| E012 | error | Open 项既未 resolved 也未 deferred | 不许悬空 |
| E013 | error | 缺 `Revisit` 或为空 | 没有失效条件的结论是教条 |
| E014 | error | **结论依赖链上的假设未出现在 Revisit** | 核心规则，见 §3.4 |
| E015 | error | 引用指向 workspace 之外 | 证据须在项目内 |
| E016 | error | 条目缺编号或编号重复 | 否则引用图无法闭合 |
| E017 | error | 事实引用台账目录 / 决策文档 / 自身（自引） | 用结论证明结论，是最隐蔽的一类幻觉 |
| W001 | warn | Fact 从未被任何推导使用 | 别堆砌事实 |
| W002 | warn | 引用原文在文件中出现多次 | 证据不唯一 |
| W003 | warn | 有结论但零假设 | 多数真实推理都藏着假设 |
| W004 | warn | 结论的全部前提都是假设 | 空中楼阁 |
| W005 | warn | pass 之后 scope 内文件被改动 | 台账已 stale |
| W006 | warn | 自引已标 `[policy]`（项目自身的承诺） | 允许「本项目的规则」当事实，但不许拿它冒充世界的事实 |
| W007 | warn | `review_after` 已过今天（到期没复查） | M4 追加：结论要有人回来复核 |

> M4 追加的 `E018`（`confidence` 非法）/ `E019`（`review_after` 非法）/ `E020`（台账过大或条目过多）/ `E021`（解析异常）/ `W007` 以 [`docs/LEDGER-FORMAT.md`](docs/LEDGER-FORMAT.md) §4.1 为准；本表是 M0 设计时的清单。

### 3.4 为什么这不是形式主义

三个反驳：

1. **伪造会被抓到**——不是「要求你写引用」，而是「引用必须命中某行原文」。模型编造一个不存在的行号或改一个字，立刻 E006。
2. **假设必须可证伪**——`falsify:` 是给**人**或**下一个模型**执行的动作（一条 `rg` / 一个测试），不是自我安慰。
3. **E014 让「依赖」有后果**——结论如果建立在假设上，就必须承认它在什么情况下作废。这是从「我确信」到「我在什么条件下会改主意」的分界，也是第一性原理与教条的唯一区别。

形式主义做不到这三点，因为形式主义**不接触项目文件**。

### 3.5 与现有做法的区别

| 现有做法 | 缺什么 |
|---|---|
| Chain-of-Thought（模型内部思考） | 一次性、不落盘、不可查 |
| ADR（决策记录） | 只有结论与背景，没有证据链和依赖图 |
| 单元测试 | 只在事后验证行为，不验证推理 |
| Todo / plan 文件 | 记录「要做什么」，不记录「凭什么」 |

### 3.6 明确不做的四件事

- **不禁用类比**——类比是启发式，只要在 Assumptions 里标 `basis: prior` 就行。
- **不要求每个任务都写台账**——只在触发场景（§4.3）出现。
- **默认不阻断执行**——硬闸门 opt-in，见 §4.5。
- **不评「推理质量分」**——只查结构完整性。质量由人判，机器只保证「该有的都有、写的都是真的」。

---

## 4. DSH 集成设计

### 4.1 四个挂载点

| 挂载点 | 用途 | 备注 |
|---|---|---|
| `ctx.systemPrompt.section()` | 告诉模型*何时*用、*怎么*用 | 全局段，可配置语言 |
| `ctx.tools.register()` | `first_principles_check` 工具 | 主要交互面 |
| `ctx.commands.register()` | `/fp` 命令（`/fp` 建档、`/fp status` 看状态） | 用户驱动路径 |
| `sessionProjections`（可选） | 状态行 none/draft/pass/fail/stale | M5，非必需 |
| `tools/pre-execute`（可选） | 软闸门 | 默认 off |

### 4.2 工具契约

```ts
name: 'first_principles_check'
parameters: {
  path?: string      // 台账文件（相对 session cwd）
  document?: string  // 内联台账文本
  strict?: boolean   // warnings 也算失败
}
```

行为：
- 三个参数都不给 → 返回**模板 + 已核实的项目事实**（`package.json:2`、顶层目录等），模型照着填；
- 给 `path` → 读文件校验；给 `document` → 直接校验；
- 返回结构化报告，模型据此迭代。

```json
{
  "verdict": "pass | fail | template",
  "counts": { "facts": 3, "facts_verified": 3, "assumptions": 1,
              "assumptions_falsifiable": 1, "open": 1, "derivations": 3 },
  "errors":   [{ "code": "E006", "at": "F2", "message": "...", "hint": "..." }],
  "warnings": [{ "code": "W002", "at": "F1", "message": "..." }]
}
```

description（行为描述，不描述参数）：

> Validate a first-principles ledger before acting on a decision that is not obvious from the code. Checks every fact citation against the workspace (file, line, quoted text), that each assumption names a basis and a falsifier, that derivations only reference declared ids, and that any assumption a conclusion rests on appears under Revisit. Returns errors with codes and a verdict. Call with no arguments to get a template pre-filled with verified project facts.

### 4.3 触发条件（写进提示词段）

只在三类场景出现：
1. **非显然的决策**（选型、取舍、架构改动）；
2. **根因不明的缺陷**；
3. **陌生命名空间**（要动没读过的模块）。

普通任务（改错字、加日志、跑测试）**明确不要建台账**，否则变成流程税。

提示词段草案（约 6 行，中文，可切英文）：

```
【第一性原理台账】
当任务涉及非显然的决策、根因不明的缺陷、或陌生模块时：先把推理写进 .fp/ledgers/<slug>.md，
再调 first_principles_check 直到 verdict=pass，然后才动手改代码。
六段：Facts（`路径:行` + 原文引用）· Assumptions（basis + falsify）· Open（probe → resolved）
· Derivation（只引用上面 ID）· Conclusion（必须写 depends）· Revisit（结论依赖的假设全列）。
禁止：无引用的"事实"、无 falsifier 的假设、跳过 Open。
普通任务不建台账。
```

### 4.4 状态机

```
none ──/fp 或 模型写文件──▶ draft ──check──▶ pass
                                     └────▶ fail ──修──▶ draft
pass ──scope 内文件被改──▶ stale ──重新 check──▶ pass|fail
```

- 状态来源：`path` + `mtime` + scope 内文件 mtime（`W005`）。**不新增 session 事件类型**，全部从文件与 session log 派生。

### 4.5 软闸门（默认 off，M4 才做）

`tools/pre-execute` 可以拦 `edit`/`write`：若目标文件落在某个*过期或未通过*的台账 scope 内，返回 `{kind:'ask'}` 而非 `deny`。

为什么默认 off：误拦的成本远大于收益，且触发判定不可能完美。先用 2 周观察真实使用率，再决定是否开。

### 4.6 与宿主机制的边界（来自 DSH 插件规范）

- 不新增 session 事件类型；派生状态走 `sessionProjections` 或现算。
- 不监听 `system-prompt/assemble` 往提示词里塞文本——用 `systemPrompt.section()`。
- per-agent 逻辑在 `agent/created` 里从 `agent.ctx` 注册，并包 `agent.ctx.effect()`。
- 可调参数全部进 `Config`，不写死。
- 插件包**零运行时依赖**（不 import `zod`，`Config` 用几十行手写校验），因为本地包要能被 `install_bundle` 离线装进一个已有 216 个包的 profile。

---

## 5. 我们要写什么

### 5.1 目录结构

```
First_Principles/
├── PLAN.md                      # 本文档
├── README.md                    # 一句话 + 安装 + 演示
├── plugin/                      # ← 用 plugin_manager install_bundle 安装这个目录
│   ├── package.json             # name: dsh-first-principles, dsh.bundle.patch
│   ├── cordis.patch.yml         # - insert: [{ id: first-principles, name: dsh-first-principles }]
│   ├── icon.svg
│   └── src/
│       ├── index.js             # apply(ctx, config)：注册 section/tool/command/projection/gate
│       ├── ledger.js            # 解析 + 校验 + 计分（纯函数，不碰 cordis）
│       ├── evidence.js          # 证据解析：file:line、glob scope、原文匹配、归一化
│       ├── template.js          # 模板 + 已核实的项目事实
│       ├── prompt.js            # 提示词段文本（zh / en）
│       ├── gate.js              # 可选软闸门（M4）
│       ├── projection.js        # 可选状态（M5）
│       └── locale/{zh-CN,en}.json
├── docs/
│   └── LEDGER-FORMAT.md         # 六段格式 + 20 条规则（规范文档，模型与人都读）
└── tests/
    ├── ledger.test.js           # node:test
    └── fixtures/*.md            # 6 份台账：全绿 / 伪造 / 无 falsify / 环 / 孤儿事实 / 缺 revisit
```

### 5.2 关键签名

```js
// ledger.js
export function parseLedger(text) -> { header, facts, assumptions, open, derivations, conclusions, revisit }
export function checkLedger(parsed, { readFile, resolveScope }) -> { verdict, counts, errors, warnings }
export function revisionClosure(parsed) -> Set<string>   // E014 用的传递闭包

// evidence.js
export function parseCitation(ref) -> { path, line, quote } | { command }
export function verifyCitation(citation, { cwd, readFile }) -> { ok, code?, hint? }

// index.js
export function apply(ctx, config) {}
export const inject = ['tools', 'systemPrompt', 'commands']
export const Config = { enabled: true, language: 'zh-CN', dir: '.fp', strict: false, gate: 'off' }
// 手写校验：类型/枚举/默认值，非法值直接走默认并告警，不抛异常（避免拖垮宿主）
```

### 5.3 交付物清单

| 交付物 | 形式 | 验收 |
|---|---|---|
| Ledger 规范 | `docs/LEDGER-FORMAT.md` | 六段 + 20 条规则，无歧义 |
| 检查器 | `plugin/src/{ledger,evidence}.js` | fixture 6 份全部按预期报错/通过 |
| 工具 | `first_principles_check` | 在 GUI 里可被模型调用并返回报告 |
| 提示段 | `plugin/src/prompt.js` | 无触发场景时零工具调用 |
| 命令 | `/fp`、`/fp status` | 输出模板/状态 |
| 文档 | `README.md` | 新人在 5 分钟内能装能跑 |

### 5.4 安装与验证路径（M0 就要跑通的动作）

1. `plugin_manager install_bundle` 目标 = `First_Principles/plugin` 的**绝对路径**（本地目录，不打 npm）；
2. `plugin_manager list_plugins` 里出现 `include:first-principles` 且 `enabled: true`；
3. 新开一个 session，问一个选型问题（如「这个项目该不该把 X 换成 Y」）；
4. 观察：`.fp/ledgers/*.md` 是否生成、工具是否被调用、返回是否 `pass`；
5. 回滚：`plugin_manager remove_bundle`，工作区文件不受影响。

装不上时的排查顺序：包名/入口 `exports` → `dsh.bundle.patch` 路径 → patch 里的 `insert.id` 是否与已有条目重名 → profile 日志。

---

## 6. 里程碑

| # | 内容 | DoD |
|---|---|---|
| **M0** | 骨架跑通：bundle + 一个空壳工具 + 提示段，装进 profile | `plugin_manager list_plugins` 出现 `include:first-principles`；模型能调用工具并收到 `template` |
| **M1** | `ledger.js` 解析 + 全部 20 条检查 + 计分 | 6 份 fixture 全绿；`node --test` 通过 |
| **M2** | `evidence.js` 真实核对 file:line + glob scope + 模板里塞真实项目事实 | 伪造 5 条引用全部被 E006/E004 命中 |
| **M3** | `/fp` 命令 + 提示段定稿 + 一次真实演示 | 提一个选型问题，观察期模型自发建档并拿到 pass |
| **M4** | 软闸门（默认 off，config 开） | 开关两态行为正确；关闭时无副作用 |
| **M5** | 文档 + 状态投影 + 中英双语 + 2 周使用观察 | README 可复现；记录使用率与误报率 |

**M0 只需要约半天**，跑通后就能看到「模型写台账 → 被拒绝 → 修 → 通过」的完整循环，这是整个项目最关键的验证点，越早越好。

---

## 7. 测试策略

1. **fixture 驱动**：6 份手写台账，每份精确对应一组错误码。检查器是纯函数，测试不需要宿主。
2. **反例优先**：先写「伪造引用」「无 falsifier」「循环依赖」「结论依赖假设但 Revisit 缺失」四个反例，确保它们必挂。E014 尤其要测传递闭包（A1 → D1 → D2 → C1）。
3. **证据解析边界**：行号越界、多行原文、空白归一化、Windows 换行、glob 无匹配。
4. **行为测试（人工）**：3 个 prompt（选型 / 根因 / 普通改错字），观察是否触发、是否通过、是否拖慢。
5. **回归**：每次改提示词段都重跑行为测试的第 3 条（普通任务零打扰）。

---

## 8. 风险

| 风险 | 表现 | 缓解 |
|---|---|---|
| 模型刷分 | 为了 pass 写一堆正确但无用的引用 | W001 孤儿事实 + W002 证据唯一性；E014 提高刷分成本 |
| 台账腐烂 | 写完不改，代码早变了 | W005 stale + 可选闸门 |
| 上下文成本 | 台账占用大量 token | 只在高价值场景触发；台账是文件不是消息 |
| 误拦截 | 普通任务被要求建档 | 默认不阻断；提示段显式豁免普通任务 |
| 检查器过严 | 模型放弃使用 | 分级：E 必须、W 可容忍；`strict` 可选 |
| 打包问题 | 本地包与 216 个已装插件冲突 | 零依赖、零构建、纯 ESM；只用 `node:` 内置模块 |

---

## 9. 需要你拍板的三件事

1. **触发方式**：只靠提示词引导（最轻）／加 `/fp` 用户命令（推荐）／上软闸门（最硬）。
2. **台账落盘位置**：仓库内 `.fp/`（可提交、可 review，推荐）／工作区外的私有目录（不污染仓库）。
3. **首版范围**：只做「解析 + 检查 + 模板」的最小闭环（推荐，约 2–3 天）／一次做到状态投影与双语。

---

## 10. 参考资料

**方法论**
- Aristotle, *Physics*, Book I, 184a10–21.
- René Descartes, *Discourse on Method*, Part II (1637).
- Richard Feynman, "Cargo Cult Science", Caltech commencement (1974).

**论证与决策结构**
- Stephen Toulmin, *The Uses of Argument* (1958).
- Horst Rittel & Melvin Webber, "Dilemmas in a General Theory of Planning" (1973).
- Jeff Conklin & Michael Begeman, "gIBIS: A Hypertext Tool for Exploratory Policy Discussion" (1988).
- Tim Kelly & Rob Weaver, "The Goal Structuring Notation – A Safety Argument Notation" (2004).
- Michael Nygard, "Documenting Architecture Decisions" (2011).

**真值维护与契约**
- Jon Doyle, "A Truth Maintenance System", *Artificial Intelligence* 12(3) (1979).
- Johan de Kleer, "An Assumption-Based TMS", *Artificial Intelligence* 28(2) (1986).
- Bertrand Meyer, *Object-Oriented Software Construction* (1988/1997), Design by Contract.
- Koen Claessen & John Hughes, "QuickCheck: A Lightweight Tool for Random Testing" (2000).

**LLM 推理与验证**
- Jason Wei et al., "Chain-of-Thought Prompting Elicits Reasoning in LLMs" (2022).
- Xuezhi Wang et al., "Self-Consistency Improves Chain of Thought Reasoning" (2022).
- Shunyu Yao et al., "ReAct: Synergizing Reasoning and Acting in Language Models" (2022).
- Noah Shinn et al., "Reflexion: Language Agents with Verbal Reinforcement Learning" (2023).
- ShehZaad Dhuliawala et al., "Chain-of-Verification Reduces Hallucination in LLMs" (2023).
- Zhibin Gou et al., "CRITIC: LLMs Can Self-Correct with Tool-Interactive Critiquing" (2023).
- Oyvind Tafjord et al., "ProofWriter: Generating Implications, Proofs, and Abstractions" (2020).
- Simeng Han et al., "FOLIO: Natural Language Reasoning with First-Order Logic" (EMNLP 2024; arXiv 2022) — https://aclanthology.org/2024.emnlp-main.1229/
- Mihir Parmar et al., "LogicBench: Towards Systematic Evaluation of Logical Reasoning Ability of LLMs" (ACL 2024) — https://aclanthology.org/2024.acl-long.739/
- "Exploring the Limits of Fine-grained LLM-based Physics Inference via Premise Removal Interventions" (Findings of EMNLP 2024) — https://aclanthology.org/2024.findings-emnlp.378/
- DeepSeek-AI, "DeepSeek-Prover: Advancing Theorem Proving in LLMs" (2024).

---

## 9. 方向决策（2026-10-20）

2026-10-20 的调研与生态扫描后，方向收敛为“可核验决策台账 + 检查器”，并调整里程碑顺序（证据落地 M3.5 → 复查字段 M4 → 可选闸门 M5 → 发布 M6）。取舍、风险与 kill criteria 见 `docs/DIRECTION.md`；调研证据见 `docs/RESEARCH-first-principles.md`；本次决策台账见 `.fp/ledgers/plugin-direction.md`。
