# 插件方向决策台账

question: 这个插件接下来应该做什么方向，凭什么这样判断？
mode: decision
scope: PLAN.md, README.md, docs/*.md, plugin/src/*.js, tests/*.js
review_after: 2026-11-20
confidence: 0.75
kill: 发布 30 天后重复使用率 <10%，或 10 人访谈中 ≥7 人表示只想要自动答案，就停止扩功能

## Facts

- F1 · docs/RESEARCH-first-principles.md:25 · `we do not think that we know a thing until we are acquainted with its primary conditions or first principles`
  亚里士多德《物理学》I.1：知识始于对第一前提的熟悉。
- F2 · docs/RESEARCH-first-principles.md:43 · `Science does not, he maintains, rest upon any foundational bedrock.`
  波普尔：科学没有岩床，只有暂时够牢的桩。
- F3 · docs/RESEARCH-first-principles.md:105 · `five state-of-the-art AI assistants consistently exhibit sycophancy across four varied free-form text-generation tasks.`
  谄媚是系统性行为，不是偶发。
- F4 · docs/LEDGER-FORMAT.md:204 · `只检查它非空`
  校验器明确不判断 falsify 是否真的可证伪。
- F5 · plugin/src/ledger.js:472 · `结论依赖的假设没有出现在 Revisit`
  E014：结论闭包内的假设必须进入 Revisit。
- F6 · README.md:147 · `只认不可逆操作；读操作与可逆写不拦——误拦一次，用户就会把整个插件关掉。`
  M5 把闸门做成可选：默认关，只在不可逆操作前问一句。
- F7 · PLAN.md:157 · `有效的不是「更好的提示词」，而是「独立检查器 + 显式前提 + 可撤回的依赖图」`
  PLAN 的核心结论。
- F8 · docs/evidence/market-scan-2026-10-20.md:46 · `ledger 类条目共 22 条，排名第一的是记忆型插件 dsh-ledger-memory，不是校验型台账。`
  生态空位的可核对依据：索引里 ledger 类插件排第一的是记忆型，不是校验型。
- F9 · docs/DIRECTION.md:145 · `生成过台账的用户中第二次使用率 < 10%` [policy]
  本项目自己承诺的 kill criteria（不是对世界的判断，故标注 policy）。
- F10 · docs/RESEARCH-first-principles.md:205 · `外部网页/论文/报价不能直接当事实引用——它们不在仓库里，检查器无法逐字比对`
  dogfooding 暴露的证据落地约束。
- F11 · docs/RESEARCH-first-principles.md:145 · `criteria of refutation have to be laid down beforehand`
  证伪条件必须先于观察写死。
- F12 · README.md:77 · `82 passed（校验器 28 / M4 17 / 闸门 12 / 可移植性 7 / 装配 8 / 面板 10）`
  M5 测试现状：校验器 28、M4 17、闸门 8、可移植性 7、装配 6，共 66 条。

## Assumptions

- A1 · basis: external · falsify: 若 10 人试用访谈中 ≥7 人表示只想要“自动给答案”，不关心依据可否核对，则本假设失效
  目标用户愿意为“可核验”付费或持续使用，而不只是想要更聪明的答案。
- A2 · basis: inference · falsify: 若发布后 30 天内生成过台账的用户复用率 ≥30%，则本假设失效
  写作摩擦是弃用的首要原因，而不是“没有需求”。
- A3 · basis: external · falsify: 若同规模评测显示有外部检查与无外部检查的准确率无显著差异，则本假设失效
  目标模型的自纠与谄媚问题仍然显著，外部检查仍有增益。
- A4 · basis: convention · falsify: 若 10 人访谈中 ≥6 人认为“第一性原理”只是营销词、与决策无关，则本假设失效
  中文语境里“first principles”仍被理解为一种决策方法，可保留品牌名。
- A5 · basis: inference · falsify: 若 DSH 发布说明移除 tools/pre-execute 或限制第三方插件注册该钩子，则本假设失效
  发布版 DSH 仍允许插件注册 tools/pre-execute 并按 session 决策。

## Open

- O1 · probe: npm view dsh-first-principles version（发布前复核） · deferred(当前未发布，npm 无此包)
- O2 · probe: node --test tests/ledger.test.js tests/apply.test.js · resolved(F12)
- O3 · probe: 在 docs/RESEARCH-first-principles.md 检索 criteria of refutation · resolved(F11)
- O4 · probe: 读 plugin/src/ledger.js 的 E014 分支（313 行） · resolved(F5)

## Derivation

- D1 · from F1,F2
  起点不可证明、没有岩床 → 台账的正确产物是“可作废的结论 + 显式依据”，产品价值在可核验结构。
- D2 · from F3,F7,A3
  谄媚与自纠失败 → 模型自评不可靠；PLAN 的结论是独立检查器 + 显式前提 + 可撤回依赖图。
- D3 · from D1,D2,F6,A5
  闸门只能拦动作、拦不住错误前提，且强阻断会误伤普通任务 → 闸门只作补充、默认关、仅拦不可逆操作。
- D4 · from F8,A1,A4
  生态空位在“书面可核验台账”；成立前提是用户要可核验、且品牌词仍指方法。
- D5 · from D3,D4,F10,A2
  外部材料无法直接引用、写作摩擦会导致弃用 → 先补证据落地与轻模板，再谈闸门与 UI。
- D6 · from F4,F5,F11,F12
  falsify 虽只查非空，但 E014 与“事先写死证伪条件”保证可作废机制，且有测试覆盖 → 保留六段与 Revisit。
- D7 · from F9,A2
  kill criteria 绑定 30 天复用率；复用率低则停止扩功能。

## Conclusion

- C1 · depends: D5
  M3.5 证据落地与 M4 复查字段/可移植已完成；下一步 M5 闸门（默认关、只拦不可逆操作），UI 推迟到 M7。
- C2 · depends: D4
  对外定位“可核验决策台账 + 检查器”，发布 npm 并进 dsh-plugin 市场，不使用“让你更会思考”的主张。
- C3 · depends: D3
  闸门默认 false，只对不可逆操作 ask，误拦率必须可观测；可逆操作零打扰。
- C4 · depends: D6
  不因降低摩擦删除 Revisit 与依赖闭合；falsify 只做非空检查这一边界必须在 README 与报告里明示。
- C5 · depends: D7
  发布 30 天后复测复用率；若 <10%，停止扩功能，只保留 `/fp` 与模板。

## Revisit

- R1 · A1
  若试用访谈显示用户只想要“自动答案”，重估 C2 的价值主张与整个定位。
- R2 · A2
  若 30 天复用率 ≥30%，重估 C1 的排序（可提前做闸门，不必先做证据管线）。
- R3 · A3
  若评测显示外部检查无显著增益，重估 C3 与检查器的存在价值。
- R4 · A4
  若多数受访者认为“第一性原理”是营销词，重估 C2 的命名（加副标题或改名）。
- R5 · A5
  若发布版移除或限制 tools/pre-execute，重估 C3（M5 闸门不可行，转为提醒模式）。
