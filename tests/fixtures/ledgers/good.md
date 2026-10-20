# 第一性原理台账 · sample-app

question: 会话过期时间该由哪一侧决定？
mode: decision
scope: package.json, src/auth/**

## Facts

- F1 · package.json:2 · `"name": "sample-app",`
- F2 · src/auth/session.ts:2 · `const ttl = 60 * 60 * 1000`

## Assumptions

- A1 · basis: inference · falsify: 若客户端已存在本地强制刷新逻辑，则本假设失效
  TTL 目前完全由服务端单方面决定，客户端只能被动接受

## Open

- O1 · probe: 在 src/auth/ 下读一遍是否有 refresh 端点 · deferred(等 auth 模块重构后再查)

## Derivation

- D1 · from F1,F2,A1
  TTL 硬编码在服务端，客户端拿不到过期时间，只能靠 401 反推

## Conclusion

- C1 · depends: D1
  过期时间应随登录响应一并下发，而不是让客户端猜

## Revisit

- R1 · A1
  一旦客户端出现主动刷新逻辑，C1 需要重估：下发 TTL 的收益会被刷新机制吃掉
