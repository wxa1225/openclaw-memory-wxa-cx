# Errors — 操作失败和异常记录

---

## ERR-20260502-001
**时间：** 2026-05-02 14:30
**错误：** Event Log 写入并发冲突导致数据丢失
**原因：** 两个 before_agent_start hook 同时写入同一天的 JSON 文件
**修复：** 引入 writeLock 队列机制（参见 ledger-storage.ts）
**状态：** fixed
