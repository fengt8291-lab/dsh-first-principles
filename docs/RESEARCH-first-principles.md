# 第一性原理与 OPC / 个人 Agent 的决策协议

> 调研日期：2026-10-20。文中引文均来自文末列出的原始来源；外部来源按不可信数据处理，只取可逐字核对的原话。

## 0. 一页结论

**第一性原理不是“更聪明的思考”，而是把决策拆到不可再拆的前提，再检查结论是否真的长在这些前提上。**

三个反直觉结论：

1. **起点不可证明。** 亚里士多德说第一前提“必须是首要的、不可证明的”；波普尔说科学没有“foundational bedrock”。所以第一性原理的产物不是“绝对正确的结论”，而是“说清楚它建立在什么之上、什么情况下作废”。
2. **它很贵，不能对所有决策都用。** 马斯克自己说这“takes a lot more mental energy”。贝索斯的分级是：可逆决策用轻流程，不可逆决策才值得重流程。
3. **写下来不等于想清楚。** 模型会谄媚、会自纠失败、会在前提被抽走后继续硬推；人脑会“actively edit the past”。所以关键不是模板，而是**外部可复核的检查**。

对本插件的含义：它的位置不是“教用户第一性原理”的提示词，而是**决策的可核验工件 + 检查器**——把“事实能否回到原文、假设是否可证伪、结论依赖是否闭合”变成机器能查的东西。详细方向见 `docs/DIRECTION.md`。

---

## 1. 定义：哲学、方法、工程

### 1.1 哲学源头：arche（起点）

亚里士多德在《物理学》I.1 给出最常被引用的一段：

> “When the objects of an inquiry, in any department, have principles, conditions, or elements, it is through acquaintance with these that knowledge, that is to say scientific knowledge, is attained. For we do not think that we know a thing until we are acquainted with its primary conditions or first principles, and have carried our analysis as far as its simplest elements.”

同书 I.5 补了另一半——第一原理之间不能互相推导：

> “first principles must not be derived from one another nor from anything else, while everything has to be derived from them.”

《形而上学》V.1 把“起点”定义为“认知开始的地方”：

> “(6) That from which a thing can first be known,—this also is called the beginning of the thing, e.g. the hypotheses are the beginnings of demonstrations.”

《后分析篇》I.3 则明确了代价：第一前提不可证明。

> “knowledge of the immediate premisses is independent of demonstration.”

**读法**：第一性原理不是“终极真理”，而是“当前推理链的端点”。端点是**被接受的**，不是**被证明的**。这就解释了为什么一个好的决策记录必须标注每条假设的**依据类型**（定义 / 约定 / 外部事实 / 推断），而不是假装它们都是事实。

波普尔把这件事说得更狠（Stanford Encyclopedia of Philosophy, “Karl Popper”）：

> “Science does not, he maintains, rest upon any foundational bedrock.”

他用打桩比喻：桩打进沼泽，不是打到了岩床，只是“暂时够牢”。这对做产品决策的直接含义是：**结论要带复查条件，而不是带信心口号。**

### 1.2 方法内核：拆到“可证伪”，再向上推

Farnam Street 的总结是“separating what we know is absolutely true from anything that is an assumption”，并给了一个重要限定：

> “First principles do not provide a checklist of things that will always be true; our understanding of first principles evolves as we gain more knowledge.”

马斯克的电池例子是公开版本里最完整的：市场价约 **$600/kWh**，拆到材料 constituents 后按现货价算约 **$80/kWh**。火箭也是同一路数：原材料约占总价的 **2%**。他在 Kevin Rose 访谈里的原话是：

> “I think it’s important to reason from first principles rather than by analogy... it’s mentally easier to reason by analogy... First principles is kind of a physics way of looking at the world... boil things down to the most fundamental truths and say, ‘okay, what are we sure is true?’ ... and then reason up from there. That takes a lot more mental energy.”

Wait But Why 的版本补充了“为什么大多数人不用它”：

> “I think generally people’s thinking process is too bound by convention or analogy to prior experiences. It’s rare that people try to think of something on a first principles basis.”

**关键区分**：第一性原理不是“禁止类比”。类比是**生成假设**的压缩器（“这个行业像那个行业”），第一性原理是**检验假设**的展开器（“这条类比成立需要哪些前提？前提在吗？”）。把两者对立起来，是常见误读。

### 1.3 工程化：从“想”到“可核验的工件”

把上面的东西落进项目，只需要问三个问题：

1. 这条结论**依赖**哪些事实与假设？（可追踪）
2. 每条假设**出现什么证据就算错**？（可证伪）
3. 哪个事件发生时，这条结论必须**重估**？（可复查）

这三问对应插件台账里的 `Facts / Assumptions(falsify) / Revisit`。它不是新发明：ADR 已经证明“决策记录”是成熟品类——

> “An Architectural Decision Record (ADR) captures a single AD and its rationale”

但主流 ADR 只要求“选了什么 + 理由”，不要求“事实可回到原文、假设可证伪、依赖不成环”。这正是空位。

---

## 2. 五个常见误解

| # | 误解 | 实际 | 后果 |
| --- | --- | --- | --- |
| 1 | 第一性原理 = 不用经验、不用类比 | 从“对我们更易知的东西”出发（亚里士多德），类比用来生成假设 | 变成空想，或陷入“什么都自己推”的低效 |
| 2 | 一定能找到“绝对正确”的起点 | 起点不可证明（亚里士多德）；没有岩床（波普尔） | 把假设当事实，结论看似坚固其实悬空 |
| 3 | 所有决策都该这么做 | 成本高（马斯克）；可逆决策用轻流程（贝索斯） | 分析瘫痪，错过窗口 |
| 4 | 拆得越细越好 | 拆到“足以决定下一步行动”的分辨率即可 | 无限还原，产出无法执行 |
| 5 | 写下来 = 想清楚了 | 模型会谄媚/自纠失败；人脑会美化记忆 | 得到一份“看起来很对”的自欺文档 |

第 5 条最值得展开，因为它决定了工具该长什么样。

---

## 3. 为什么 LLM / Agent 时代更需要它

四条独立证据，指向同一个结论：**模型的自检不可信，外部检查才可信。**

**(a) 没有外部反馈时，自纠会失败甚至变差。** Huang et al., “Large Language Models Cannot Self-Correct Reasoning Yet”（ICLR 2024）：

> “LLMs struggle to self-correct their responses without external feedback, and at times, their performance even degrades after self-correction.”

**(b) 过程监督显著优于结果监督。** Lightman et al., “Let’s Verify Step by Step”：process supervision “significantly outperforms outcome supervision”，过程监督模型在 MATH 代表性测试子集上解决 **78%**，并发布了 **800,000** 条步级标注（PRM800K）。含义：**检查“每一步的依据”比检查“最后答案像不像”更有用。**

**(c) 谄媚是系统性的，不是偶发。** Sharma et al., “Towards Understanding Sycophancy in Language Models”：

> “five state-of-the-art AI assistants consistently exhibit sycophancy across four varied free-form text-generation tasks.”
>
> “both humans and preference models (PMs) prefer convincingly-written sycophantic responses over correct ones a non-negligible fraction of the time.”

**(d) 前提被抽走，模型仍会硬推。** “Premise Removal Interventions”（EMNLP 2024 Findings，https://aclanthology.org/2024.findings-emnlp.378/）发现：移除推理所需前提后，模型仍倾向于给出答案，而不是报告“信息不足”。

**推论**：一个“让模型再想想”的提示词，正好落在模型最不可靠的能力区间。可靠的替代品是**外部工件 + 独立检查**：事实要能回到原文，假设要带证伪条件，结论要能追到依赖。Lean 4 / DeepSeek-Prover 的可靠性也来自同一个结构——检查器独立于生成器。

---

## 4. 操作协议：五步 + 三个前置动作

### 4.0 先分级（否则一定过度流程）

贝索斯 2016 致股东信：

> “Many decisions are reversible, two-way doors. Those decisions can use a light-weight process. For those, so what if you’re wrong?”

以及信息阈值：

> “most decisions should probably be made with somewhere around 70% of the information you wish you had. If you wait for 90%, in most cases, you’re probably being slow.”

分级只看两个维度：**可逆性**（错了能不能退回）与**影响面**（一个人 / 一个项目 / 公司存续）。可逆 + 小影响 → 不建台账；不可逆或大影响 → 建。

### 4.1 五步

1. **写问题**：一句话 `question`，加 `scope`（这次考核哪些文件/数据）。问题不清，后面全是自证。
2. **列事实**：每条 `路径:行` 或数据来源，反引号里放原文。写不出出处的，不是事实，是假设。
3. **列假设**：每条写 `basis`（定义/推断/约定/外部）+ `falsify`（出现什么证据算错）。写不出 falsify 的，通常是愿望。
4. **推导**：`D1 from F1,F2,A1`，一步一句。推导要能追到编号，不能是叙述。
5. **结论 + 复查**：`C1 depends: D1`，一句可执行判断；`R1` 写清哪个假设失效时重估。

### 4.2 三个前置动作（都可直接借用）

- **预验尸（premortem）**：Klein 的做法是“assume that the project they are planning has just failed”，再倒推动因。对 OPC 尤其有用——团队里没人敢反对时，用“已经失败了”绕开乐观偏差。
- **决策日志（decision journal）**：Farnam Street 的八项模板，核心是**在行动前**记录预期与概率、当时的身心状态。原文：

  > “our brains actively edit the past to make us look better and smarter.”

  两个逃逸口也值得写进工具提示：hindsight bias 与 jargon（“When we use vague terms, we give ourselves wiggle room.”）。
- **预注册（preregistration）**：Center for Open Science 的原则是“the same data cannot be used to generate and test a hypothesis”，且“Preregistration simply makes clear which analyses were planned and which were not.” 对应到决策：**先写死证伪条件，再看结果**。波普尔说得更直接：“criteria of refutation have to be laid down beforehand”。

### 4.3 反面清单

- 用“第一性原理”给已有直觉背书（先有结论，再挑方便的公理）。
- 把模板当成果（填满六段，但没有一条事实被真正使用）。
- 在可逆小事上建重台账（流程成本 > 决策价值）。
- 结论没有复查条件（等于宣布“永远正确”）。
- 台账写完就锁进抽屉（不复查 = 没写）。

---

## 5. OPC 与小团队：把方法论压到可执行

### 5.1 约束

一人公司/极小团队的决策约束与大公司不同：

- **没有人反对你**：缺少 dissent，谄媚型工具会放大而非抵消这一点。
- **决策即执行**：没有“决策会”和“执行层”的分离，思考时间就是交付时间。
- **资源固定**：不能靠“再融一轮”买试错空间，能承受的损失是硬约束。
- **记忆即资产**：人少，决策上下文只存在脑子里，换人/隔月就丢。

Effectuation 的五原则正好补上“资源固定”这一半：Bird in Hand（我是谁/我知道什么/我认识谁）、Affordable Loss（先定可承受损失，而非预期收益）、Crazy Quilt（用承诺换伙伴）、Lemonade（把意外变机会）、Pilot in the Plane（控制未来而非预测未来）。它与第一性原理不冲突：**effectuation 决定“从哪开始”，第一性原理检查“凭什么相信”。**

### 5.2 三档协议

| 档位 | 适用 | 时间盒 | 产物 |
| --- | --- | --- | --- |
| L0 不建台账 | 可逆、影响 < 一天工作量、有先例 | 0 | 直接做，事后一句话记录 |
| L1 轻台账 | 可逆但影响一周以上；或重复出现的决策 | 10–15 分钟 | 3 条事实 + 2 条假设（带 falsify）+ 1 条结论 + 1 条复查 |
| L2 全台账 | 不可逆（发布/定价/合作/删库/迁移）；或涉及生死 | 45–90 分钟 | 六段完整 + 预验尸 + 决策日志（含概率与 kill criteria）+ 外部反对者 |

**L2 的“外部反对者”可以是一个 agent**：让它只做一件事——挑一条事实说“这行不支持你的结论”，或挑一条假设说“你的 falsify 不可观测”。这比让它“再想想”有效，因为它被要求指向具体行。

### 5.3 决策分级表（把分级写成规则）

| 可逆性 \ 影响 | 小（<1 天） | 中（1 天–2 周） | 大（不可逆/存续） |
| --- | --- | --- | --- |
| 易撤回 | L0 | L1 | L2（简化版） |
| 有成本撤回 | L1 | L1 | L2 |
| 难撤回 | L1 | L2 | L2 + 预验尸 + kill criteria |

kill criteria 是 OPC 最缺的一栏：**在什么条件下我承认这件事失败了、停止投入**。不写，就会用“再坚持一下”替代判断。

---

## 6. 个人 Agent：决策协议

### 6.1 Agent 的四个失效模式

1. **无连续记忆**：上下文压缩/换会话后，前提丢失，结论还在。
2. **会漂移**：多轮之后目标被改写，没人提醒“你原来要解决的是 X”。
3. **会谄媚**：用户说“我觉得 A 更好”，模型倾向于把 A 论证得更合理（见 §3c）。
4. **会自信地跳过证据**：前提被移除仍给答案（见 §3d）。

这四条恰好对应台账的四个字段：`question`（防漂移）、`Facts`（防无据）、`Assumptions.falsify`（防谄媚式自证）、`Revisit`（防过期结论）。

### 6.2 三条硬规则

- **事实必须落地到仓库。** 外部网页/论文/报价不能直接当事实引用——它们不在仓库里，检查器无法逐字比对。流程是：抓取 → 摘录原文到 `docs/evidence/`（含 URL 与日期）→ 台账引用本地行。这不是插件缺陷，而是“可复核”的必然代价。
- **假设必须带可观测的 falsify。** “如果这个方向不对”不是 falsify；“如果两周内 10 个目标用户中少于 2 人愿意第二次使用”才是。
- **结论必须带复查触发。** 时间（`review_after`）或事件（“当 X 指标 < Y”）。没有触发条件的结论，默认过期。

### 6.3 闸门策略（gate）

只在**不可逆操作**前阻断：删除、发布、支付、对外承诺、批量改写。可逆操作只提示、不阻断。贝索斯的 two-way doors 是这条策略的最好依据；否则工具会变成“每步都要审批”的仪式，而仪式会被绕过。

技术上是可行的：DSH 的 `tools/pre-execute` 钩子允许插件对某次工具调用返回 `{kind:'ask'|'deny', reason}`，并按 agent/session 做策略（本机 `dsh-automation`、`dsh-skills-manager` 已有同类用法）。设计上要避免“默认开”——默认开会让用户第一小时就关掉它。

### 6.4 人机分工

| 角色 | 人 | Agent |
| --- | --- | --- |
| question / scope | 定 | 复述、指出歧义 |
| Facts | 提供领域事实与数据 | 抓取、摘录、标注行号 |
| Assumptions | 判断哪条是真正的赌注 | 补 basis、写 falsify 草案 |
| Derivation | 抽查关键一跳 | 生成完整链 |
| Conclusion | 拍板 | 写可执行版本 |
| Revisit | 定 kill criteria 与复查日 | 监控、到期提醒 |

---

## 7. 边界：它不能做什么

诚实划界，避免把工具当万能：

1. **不验证相关性。** 检查器只能确认“这行确实这么写”，不能确认“这行支持你的结论”。
2. **不验证语义。** 推导可以形式闭合、语义荒谬（“因为 A，所以 A”换个编号就能过）。
3. **不验证 falsify 是否真的可观测。** 只检查非空。
4. **不判断结论对错。** 只判断它挂在一条完整链上。
5. **不能还原复杂系统。** 市场有反身性、组织有涌现；把社会系统当物理系统拆到“材料成本”，会得到算术正确、战略错误的答案。这时应该用的是“可证伪 + 复查”，而不是“还原到终极真理”。

这五条不是缺陷列表，而是**产品承诺的边界**：它守的是“可围栏化的错误”——没有出处的断言、写不出证伪条件的假设、悬空的待查项、不知道自己建立在什么之上的结论。这恰好是模型（和人）最容易糊弄过去的地方。

---

## 8. 对本插件的含义

1. **定位**：`first-principles` 作为方法名可以保留，但对外主张应是“**决策台账 + 检查器**”，不是“让你更会思考”。前者可验证，后者不可验证。
2. **必须补的三件事**（按优先级）：
   - **证据落地**：一键把 URL/摘录写入 `docs/evidence/` 并生成可引用行（否则研究型决策根本用不了台账）。
   - **复查字段**：`review_after`、`confidence`、`kill criteria`（把决策日志/预注册的实践接进来）。
   - **可选闸门**：只对不可逆操作 ask/deny（M4），默认关。
3. **不做**：运行时裁决模型（`dsh-decision-layer` 已占）、多模型会审（`dsh-decision-room` 已占）、通用 ADR 模板（`madr` 已占）。这三类都不是“可核验工件”。
4. **分发**：`dsh-first-principles` 目前只在本机 `link:` 安装，npm 上 E404；先发布 + 进社区市场，再谈 UI。

详细取舍、路线与 kill criteria 见 `docs/DIRECTION.md`。

---

## 9. 来源

**哲学**
- Aristotle, *Physics* I.1, I.5 — https://classics.mit.edu/Aristotle/physics.1.i.html
- Aristotle, *Posterior Analytics* I.2–I.3 — https://classics.mit.edu/Aristotle/posterior.1.i.html
- Aristotle, *Metaphysics* V.1 — https://classics.mit.edu/Aristotle/metaphysics.5.v.html
- Stanford Encyclopedia of Philosophy, “Karl Popper” — https://plato.stanford.edu/entries/popper/

**方法与实践**
- Farnam Street, “What is First Principles Thinking?” — https://fs.blog/first-principles/
- Wait But Why, “The Cook and the Chef: Musk’s Secret Sauce” — https://waitbutwhy.com/2015/11/the-cook-and-the-chef-musks-secret-sauce.html
- Amazon 2016 Letter to Shareholders — https://www.aboutamazon.com/news/company-news/2016-letter-to-shareholders
- Gary Klein, “Performing a Project Premortem”, HBR 2007 — https://hbr.org/2007/09/performing-a-project-premortem
- Farnam Street, “Decision Journal” — https://fs.blog/decision-journal/
- Center for Open Science, “Preregistration” — https://www.cos.io/initiatives/prereg
- adr.github.io — https://adr.github.io/
- Saras Sarasvathy / Effectuation, five principles — https://effectuation.org/the-five-principles-of-effectuation

**LLM 可靠性**
- Huang et al., “Large Language Models Cannot Self-Correct Reasoning Yet”, ICLR 2024 — https://arxiv.org/abs/2310.01798
- Lightman et al., “Let’s Verify Step by Step” — https://arxiv.org/abs/2305.20050
- Sharma et al., “Towards Understanding Sycophancy in Language Models” — https://arxiv.org/abs/2310.13548
- “Premise Removal Interventions”, EMNLP 2024 Findings — https://aclanthology.org/2024.findings-emnlp.378/
