# OpenClaw Usage Dashboard

OpenClaw AI 模型用量监控面板 — 实时追踪调用量、花费和供应商配额。

## 功能

- 今日/本周/本月花费概览
- 供应商额度状态（ZenMux / OpenAI / Google Antigravity）
- 模型维度用量明细（可排序）
- 近 30 天每日花费趋势图
- 基于使用习惯的省钱建议

## 安装

```bash
# 1. 复制到 OpenClaw skills 目录
cp -r . ~/.openclaw/workspace/skills/usage-dashboard/

# 2. 创建数据目录
mkdir -p ~/.openclaw/workspace/skills/usage-dashboard/data

# 3. 安装 LaunchAgent（开机自启）
cp launchd/ai.openclaw.usage-dashboard.plist ~/Library/LaunchAgents/
# 编辑 plist 中的 HOME 路径和 proxy 设置
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.openclaw.usage-dashboard.plist

# 4. 或手动启动
node scripts/server.mjs
```

## 访问

浏览器打开 http://127.0.0.1:18790

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

## 依赖

- Node.js >= 18（零 npm 依赖）
- OpenClaw（数据源）

## License

MIT
