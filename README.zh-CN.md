# cache-guardian

[English](./README.md) · 中文文档

Pi Agent 扩展：最大化 prompt cache 命中率，减少 token 成本。

Pi Agent 有完善的事件系统和扩展 API，但默认没有针对 provider prompt cache 做优化。当多个扩展在 `before_agent_start` 中注入内容时，system prompt 的字节级漂移会导致缓存前缀完全失效——实测中从 75% 直接崩到 0%。

`cache-guardian` 解决这一问题，并将 pi-cache-optimizer 和 DeepSeek-Reasonix 中的缓存优化技术整合到一个统一的扩展中。

## 核心机制

### 1. Golden 冻结（最关键）

第一轮完整处理后的 system prompt 捕获为 golden 副本。后续轮次无条件恢复为 golden，确保 system prompt 字节级一致。

### 2. Prompt reorder

将 system prompt 中最稳定的内容（自定义提示、工具说明、指导原则、上下文文件、技能索引）排到最前面。Provider 的 prefix 缓存从开头匹配，稳定内容在前越长，命中率越高。

### 3. Skills 压缩

> 4 个技能时，将 Pi 的 4 行 XML 块（`<name>`/`<description>`/`<location>`）压缩为一行索引。31 个技能时可将 13.3 KB 缩减到 ~1 KB，同时保持模型可发现性。

### 4. Session-overview churn strip

移除 trellis 的 `<session-overview>` 中每轮变化的字段（RECENT COMMITS、Working directory 状态、Line count），让剩余字段成为缓存友好前缀。

### 5. 兼容自动检测

- OpenAI `prompt_cache_retention` 被 400 拒绝时自动剥离
- Anthropic TTL 排序被 400 拒绝时自动降级
- `prompt_cache_key` 注入（OpenAI 兼容接口）

### 6. 缓存守护

`PI_CACHE_GUARD=1` 时，session 结束时聚合命中率低于阈值（默认 90%）则发出警告。

### 7. 缓存统计

每轮自动记录 `cacheRead`/`cacheWrite`/`input`，`/cache-guardian` 命令查看完整统计。

## 安装

### npm（推荐）

```bash
npm install -g pi-cache-guardian
```

Pi 自动发现并加载，无需设置变更。

### 直接复制

```bash
git clone https://github.com/icessssssssssss/pi-cache-guardian.git
cp pi-cache-guardian/extensions/cache-guardian.ts ~/.pi/agent/extensions/
```

### 环境变量

| 变量 | 默认值 | 说明 |
| ------ | -------- | ------ |
| `PI_CACHE_GUARD_VERBOSE` | `0` | 每轮打印缓存统计到 stderr |
| `PI_CACHE_GUARD` | `0` | session 结束时启用缓存守护警告 |
| `PI_CACHE_GUARD_THRESHOLD` | `90` | 缓存守护命中率阈值 |
| `PI_CACHE_GUARD_NO_SKILL_COMPRESSION` | `0` | 禁用 skills 压缩 |
| `PI_CACHE_GUARD_NO_PROMPT_REWRITE` | `0` | 禁用 prompt reorder（仅做冻结） |

## 命令

```
/cache-guardian          # 显示当前 session 缓存统计
/cache-guardian disable  # 禁用扩展（本进程，重启后恢复）
/cache-guardian enable   # 重新启用
/cache-guardian reset    # 重置所有统计和兼容状态
```

## 测试结论

### 测试方法

10 轮"读文件"对话，模型 `agentrium/deepseek-v4-flash`，关闭 compaction 和 retry。同一脚本分别用无扩展和有扩展运行，从每轮 assistant 消息的 `usage` 字段提取 `cacheRead`/`cacheWrite`/`input`。

### 结果

| 场景 | 未命中 | 缓存命中 | 总输入 | 聚合命中率 |
|------|--------|----------|--------|-----------|
| 无扩展 | 5256 | 8192 | 13448 | 61% |
| 有扩展 | 3967 | 8192 | 12159 | 67% |

### 稳定段（T3-T10，缓存预热后）

| 场景 | 每轮未命中 | 缓存命中 | 命中率 |
| ------ | ----------- | --------- | ------- |
| 无扩展 | 341 | 1024 | 75% |
| 有扩展 | 201 | 1024 | 84% |

### 提升

- 未命中 token 减少 **1289 个（25%）**
- 稳定段命中率 **+9 pts**（75% → 84%）
- 无功能受损

## 参考

- DeepSeek-Reasonix: `TestReleaseCacheHitGuard` CI 门禁（90% 阈值）
- pi-cache-optimizer（jiangge）: prompt reorder + skills 压缩 + churn strip
- Anthropic prompt caching: `cache_control: { type: "ephemeral" }` 前缀匹配
