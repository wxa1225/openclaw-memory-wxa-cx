# Learnings — 教训和发现

---

## LRN-20260501-001 | correction
**背景：** 代码审查时发现，直接使用 JSON 文件存储存在并发风险
**教训：** 生产环境需要引入文件锁或改用数据库
**状态：** promoted
**提升到：** TOOLS.md

---

## LRN-20260503-002 | best_practice
**背景：** 团队记忆系统中，安全类记忆的半衰期应该设长一些
**发现：** security 类别默认半衰期 30 天，general 只有 7 天
**教训：** 关键信息的遗忘曲线应该更平缓

---

## LRN-20260505-003 | knowledge_gap
**背景：** Vector Search 功能配置了但 embedding API 未接入
**发现：** 搜索功能降级为 keyword-only
**教训：** 需要配置 text-embedding 端点以启用混合检索
