---
name: usage-dashboard
description: OpenClaw 用量监控面板 — 实时追踪 AI 模型调用量、花费和供应商配额
---

# usage-dashboard

本地 web 面板，监控 OpenClaw 所有模型的用量和花费。

## 启动

```bash
node ~/.openclaw/workspace/skills/usage-dashboard/scripts/server.mjs
```

服务默认运行在 `http://127.0.0.1:18790`。

## 功能

- 今日/本周/本月花费概览
- 供应商额度状态（ZenMux / OpenAI / Antigravity）
- 模型维度用量明细（可排序）
- 近 30 天每日花费趋势图
- 基于使用习惯的省钱建议

## API

| 路由 | 说明 |
|------|------|
| `GET /` | 面板页面 |
| `GET /api/summary` | 总览数据 |
| `GET /api/daily?days=30` | 每日明细 |
| `GET /api/models` | 模型维度明细 |
| `GET /api/quotas` | 供应商配额 |
| `GET /api/tips` | 省钱建议 |
| `GET /api/all` | 全量数据 |

## 数据来源

解析 `~/.openclaw/agents/main/sessions/*.jsonl` 中的实际 API 调用记录，每 5 分钟增量刷新。
