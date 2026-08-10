# 缓存优化测试原理与结论

## 测试目的

量化 cache-guardian 扩展对 LLM 提供者 prompt cache 命中率的影响。

## 测试原理

LLM 提供者的 prompt cache 基于**前缀匹配**：当前请求的前 N 个字节与缓存中的前缀相同，则这些字节计为 `cacheRead`（命中），仅计算增量部分。反之，任何字节在轮次间发生变化都导致前缀完全失配。

`cache-guardian` 的核心干预：
1. 在 `before_agent_start` 中运行完整优化流水线（reorder + compress + strip）
2. 将第一轮优化后的 prompt 锁定为 golden
3. 后续轮次强制恢复为 golden，消除所有漂移

## 测试设计

| 变量 | 固定值 |
|------|--------|
| 模型 | agentrium/deepseek-v4-flash |
| 对话轮次 | 10 轮 |
| 工具 | read, bash |
| Thinking level | off |
| Compaction | disabled |
| Retry | disabled |
| 任务 | 10 轮一致的"读文件"请求 |

### 双测试组

1. **对照组**：无扩展
2. **实验组**：加载完整 cache-guardian 扩展

## 测试结果

### 单轮数据

```
无扩展：
  T1:  i= 1198  r=    0  tot= 1198  0%   ← 冷启动
  T2:  i= 1330  r=    0  tot= 1330  0%   ← 冷启动延续
  T3:  i=  341  r=1024  tot= 1365  75%   ← 预热完成
  T4-10:  i= 341  r=1024  tot= 1365  75%  ← 稳定

有扩展：
  T1:  i= 1195  r=    0  tot= 1195  0%   ← 冷启动
  T2:  i= 1164  r=    0  tot= 1164  0%   ← 冷启动延续
  T3:  i=  201  r=1024  tot= 1225  84%   ← 预热完成
  T4-10:  i= 201  r=1024  tot= 1225  84%  ← 稳定
```

### 汇总

| 指标 | 无扩展 | 有扩展 | 变化 |
|------|--------|--------|------|
| 聚合命中率 | 61% | 67% | **+6 pts** |
| 未命中 token | 5256 | 3967 | **-25%** |
| 缓存命中 token | 8192 | 8192 | 持平 |
| 总输入 token | 13448 | 12159 | **-9.6%** |
| 稳定段命中率（T3-10） | 75% | 84% | **+9 pts** |

### 关键发现

1. **稳定段每轮未命中减少 140 tokens（41%）**：reorder 将系统提示中最稳定的内容排到最前面，让 prefix 缓存匹配到更长的前缀
2. **总 token 消耗减少 1289 个**：未命中 token 从 5256 降至 3967
3. **功能无受损**：10 轮对话全部正常完成
4. **reorder 在前，freeze 在后**：两轮流水线协同——reorder 让稳定前缀更长，freeze 让跨轮一致性保证

## 参考

- DeepSeek-Reasonix: `TestReleaseCacheHitGuard` CI 门禁
- pi-cache-optimizer（jiangge）: prompt reorder + skills 压缩 + churn strip 技术
- Anthropic prompt caching 前缀匹配机制