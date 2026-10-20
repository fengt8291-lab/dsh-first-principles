export function sectionText({ language, dir }) {
  const target = `${dir}/ledgers/<slug>.md`
  if (language === 'en') {
    return [
      '[First principles]',
      `For non-trivial work (choosing between designs, a bug whose cause is unknown, changing a module you have not read): write the reasoning into ${target}, call first_principles_check until verdict=pass, then edit code.`,
      'Six fixed sections: Facts (`path:line` plus a verbatim backticked excerpt) · Assumptions (basis + falsify) · Open (probe, ends with resolved(...) or deferred(...)) · Derivation (from IDs) · Conclusion (depends: IDs) · Revisit (which assumptions would invalidate it).',
      'Header carries the life of the conclusion: review_after: YYYY-MM-DD (the checker warns once it passes), confidence: 0.0-1.0, kill: when to admit the judgement was wrong.',
      'A ledger that cannot pass is usually one of three things: a "fact" with no citation, an assumption with no falsifier, or a conclusion leaning on assumptions without a revisit condition.',
      'Skip it for typos, log lines and running tests — discipline must not become ritual.',
    ].join('\n')
  }
  return [
    '【第一性原理台账】',
    `非平凡任务（在几种做法间取舍、修根因不明的缺陷、改动没读过的模块）先把推理写进 ${target}，用 first_principles_check 校验到 verdict=pass，再动手改代码。`,
    '六段固定：Facts（`路径:行` + 反引号原文，校验器逐字比对）· Assumptions（basis + falsify）· Open（probe，结尾 resolved(...) 或 deferred(...)）· Derivation（from 编号）· Conclusion（depends: 编号）· Revisit（列出结论依赖的假设）。',
    '头部再加三行，给结论一个保质期：review_after: 2026-11-20（到期会提醒）· confidence: 0.0–1.0（说清有多确定）· kill: 什么情况下承认判断失败。',
    '过不了校验通常是三种：没有引用的"事实"、写不出 falsify 的假设、结论依赖了假设却没有失效条件。',
    '改错字、加日志、跑测试这类小事不建台账——纪律用成仪式就只剩仪式。',
  ].join('\n')
}

export function usageText({ language, dir }) {
  if (language === 'en') {
    return [
      'First Principles — checkable first-principles ledgers.',
      '',
      `Ledger path: ${dir}/ledgers/<slug>.md`,
      '',
      'Usage:',
      '  first_principles_check                    → print a skeleton filled with real citations',
      '  first_principles_check path=<file>        → verify that ledger (default: newest one)',
      '  /fp status                                → verify every ledger in the project',
      '  /fp stats                                 → how many errors this plugin has caught so far',
      '  /fp gate [on|off]                         → optional gate: ask before irreversible ops',
      '  /fp reanchor [file]                       → re-find drifted line numbers by excerpt',
      '  /fp review 2026-11-20 [file]              → stamp the next review date',
      '',
      'Error codes: E001 header · E002 scope empty · E003 unverifiable fact · E004 missing file · E005 line range · E006 excerpt mismatch · E007 basis · E008 falsify · E009 dangling ref · E010 cycle · E011 conclusion w/o depends · E012 open status · E013 no revisit · E014 assumption w/o revisit · E015 outside cwd · E016 id · E017 self-reference · E018 confidence value · E019 review_after value · E020 ledger too large · E021 parse failure',
      'Warnings: W001 unused fact · W002 ambiguous excerpt · W003 no assumptions · W004 conclusion on assumptions only · W005 stale ledger · W006 self-reference marked policy · W007 review_after passed',
    ].join('\n')
  }
  return [
    '第一性原理台账 · 可校验的第一性原理推理',
    '',
    `台账位置：${dir}/ledgers/<slug>.md`,
    '',
    '用法：',
    '  first_principles_check                   → 打印带真实引用的骨架',
    '  first_principles_check path=<文件>       → 校验这份台账（不传则取最新一份）',
    '  /fp status                               → 校验项目里所有台账（含复查到期提醒）',
    '  /fp stats                                → 这个插件到现在帮你拦下了多少错',
    '  /fp gate [on|off]                        → 可选闸门：不可逆操作前问一句（默认关）',
    '  /fp reanchor [文件]                      → 代码改了行号漂了？按引文重新锚定',
    '  /fp review 2026-11-20 [文件]             → 给台账盖上下次复查日期',
    '',
    '错误码：E001 头部 · E002 scope 为空 · E003 事实不可校验 · E004 文件不存在 · E005 行号越界 · E006 引文不符 · E007 basis · E008 falsify · E009 悬空引用 · E010 成环 · E011 结论缺 depends · E012 Open 无终态 · E013 缺 Revisit · E014 假设无失效条件 · E015 越出项目目录 · E016 编号 · E017 自引（引用台账/决策文档/自身）· E018 confidence 取值 · E019 review_after 取值 · E020 台账过大 · E021 解析失败',
    '警告：W001 未使用的事实 · W002 引文重复 · W003 无假设 · W004 结论只靠假设 · W005 台账比代码旧 · W006 自引但已标 [policy] · W007 review_after 已过期',
  ].join('\n')
}
