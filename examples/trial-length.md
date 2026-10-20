# 试用期从 14 天改成 7 天值不值

question: 把 Team plan 的免费试用期从 14 天缩短到 7 天，能不能提升付费转化？
mode: decision
scope: tests/fixtures/example-pricing/**
review_after: 2026-12-31
confidence: 0.6
kill: A/B 跑到 5000 样本时 7 天组转付费率没有显著上升，就停掉这个改动

## 事实

- F1 · tests/fixtures/example-pricing/metrics.json:3 · `"trial_days": 14,`
  当前试用期长度。
- F2 · tests/fixtures/example-pricing/metrics.json:4 · `"trial_to_paid_pct": 18,`
  试用转付费 18%。
- F3 · tests/fixtures/example-pricing/metrics.json:5 · `"day7_active_pct": 71,`
  71% 的试用用户在第 7 天时是活跃的。
- F4 · tests/fixtures/example-pricing/metrics.json:6 · `"avg_days_to_first_value": 9,`
  平均要 9 天才摸到第一个有价值的报表。

## 假设

- A1 · basis: inference · falsify: 若 A/B 实验里 7 天组的转付费率不低于 14 天组，本假设即错
  试用期短于"首次价值时间"时，用户还没看到价值就到期，转付费会更低。
- A2 · basis: external · falsify: 若能查到第 8–14 天贡献的付费占比低于 5%，本假设即错
  14 天试用的第 8–14 天贡献了不可忽略的一部分付费转化。

## 待查

- O1 · probe: 从计费系统拉第 8–14 天完成付费的订单数 · deferred(埋点只记了到期日，需要补)
- O2 · probe: 找历史 A/B 里有没有 7 vs 14 天的实验 · deferred(历史实验样本量只有 200，不够)

## 推导

- D1 · from F1,F3
  F1 说试用有 14 天，F3 说第 7 天还有 71% 活跃；活跃不等于用满，但也说明第 7 天就掉队的只有 29%。
- D2 · from F4,A1
  F4 的平均首次价值时间是 9 天，长于 7 天；若 A1 成立，缩短到 7 天会把多数用户推到"价值未达就到期"。
- D3 · from F2,D1,D2
  18% 的转付费里，来自第 8–14 天的部分无法从现有数据判定；而缩短试用的收益（销售口径）只是一句定性判断。
- D4 · from D3,A2
  在 A2 无法验证的情况下，缩短试用的下行风险大于上行收益——这是不对称的赌注。

## 结论

- C1 · depends: D4
  不直接全面改成 7 天；先用 7 天 vs 14 天跑一次 A/B，样本够再定，同时补 O1 的埋点。

## 失效条件

- R1 · A1
  若 A/B 显示 7 天组转付费率不降反升 2 个百分点以上，重估 C1。
- R2 · A2
  若 O1 查出来第 8–14 天贡献的付费低于 5%，说明延长段没有价值，重估 C1。
