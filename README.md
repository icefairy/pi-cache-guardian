# cache-guardian

English · [中文文档](./README.zh-CN.md)

A Pi Agent extension that maximizes prompt-cache hit rate and reduces token cost.

Pi Agent has a solid event system and extension API, but does not optimize for provider prompt caching by default. When multiple extensions inject content into the system prompt via `before_agent_start`, byte-level drift in the system prompt breaks the cache prefix entirely — measured in practice as a drop from 75% to 0%.

`cache-guardian` solves this and consolidates the cache optimization techniques from pi-cache-optimizer and DeepSeek-Reasonix into a single extension.

## How it works

### 1. Golden freeze (most important)

The system prompt, after full chained processing on the first turn, is captured as a golden copy. Every subsequent turn it is unconditionally restored to the golden copy, guaranteeing byte-identical system prompts across the session.

### 2. Prompt reorder

The most stable content in the system prompt (custom prompt, tool snippets, guidelines, context files, skill index) is lifted to the front. Provider prefix caches match from the start, so the longer the stable content at the front, the higher the hit rate.

### 3. Skill compression

With > 4 skills, Pi's 4-line XML block per skill (`<name>`/`<description>`/`<location>`) is compressed into a one-line index. With 31 skills this reduces ~13.3 KB to ~1 KB while preserving model discoverability.

### 4. Session-overview churn strip

Removes per-turn changing fields in trellis's `<session-overview>` (RECENT COMMITS, Working directory status, Line count), so the remaining fields become a cache-friendly prefix.

### 5. Automatic compatibility detection

- Strips `prompt_cache_retention` when rejected with 400 by OpenAI
- Downgrades Anthropic TTL ordering when rejected with 400
- Injects `prompt_cache_key` (OpenAI-compatible endpoints)

### 6. Cache guard

With `PI_CACHE_GUARD=1`, a warning is emitted at session end if the aggregate hit rate falls below the threshold (default 90%).

### 7. Cache statistics

Per-turn `cacheRead`/`cacheWrite`/`input` is recorded automatically; the `/cache-guardian` command shows full statistics.

## Install

### Direct copy

```bash
cp extensions/cache-guardian.ts ~/.pi/agent/extensions/
```

Pi auto-discovers and loads it. No settings changes required.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PI_CACHE_GUARD_VERBOSE` | `0` | Print per-turn cache stats to stderr |
| `PI_CACHE_GUARD` | `0` | Enable cache guard warning at session end |
| `PI_CACHE_GUARD_THRESHOLD` | `90` | Cache guard hit-rate threshold |
| `PI_CACHE_GUARD_NO_SKILL_COMPRESSION` | `0` | Disable skill compression |
| `PI_CACHE_GUARD_NO_PROMPT_REWRITE` | `0` | Disable prompt reorder (freeze only) |

## Commands

```
/cache-guardian          # Show current session cache statistics
/cache-guardian disable  # Disable extension (current process; restored on restart)
/cache-guardian enable   # Re-enable
/cache-guardian reset    # Reset all statistics and compatibility state
```

## Measured results

### Method

A 10-turn read-file conversation on `agentrium/deepseek-v4-flash`, with compaction and retry disabled. The same script runs with and without the extension, extracting `cacheRead`/`cacheWrite`/`input` from each turn's assistant message `usage` field.

### Aggregates

| Scenario | Uncached | Cache-read | Total input | Aggregate hit% |
|----------|----------|------------|-------------|----------------|
| Without | 5256 | 8192 | 13448 | 61% |
| With | 3967 | 8192 | 12159 | 67% |

### Stable segment (T3-T10, after cache warm-up)

| Scenario | Per-turn uncached | Cache-read | Hit% |
|----------|-------------------|------------|------|
| Without | 341 | 1024 | 75% |
| With | 201 | 1024 | 84% |

### Improvement

- Uncached tokens reduced by **1289 (25%)**
- Stable-segment hit rate **+9 pts** (75% → 84%)
- No functional regression

## References

- DeepSeek-Reasonix: `TestReleaseCacheHitGuard` CI gate (90% threshold)
- pi-cache-optimizer (jiangge): prompt reorder + skill compression + churn strip
- Anthropic prompt caching: `cache_control: { type: "ephemeral" }` prefix matching