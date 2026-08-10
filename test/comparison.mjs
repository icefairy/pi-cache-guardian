// Cache hit rate comparison test — cache-guardian extension
// Usage: bun run comparison.mjs
// Requires: agentrium/deepseek-v4-flash configured in ~/.pi/agent/models.json

import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "/opt/nodejs/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js";

await Bun.write("/tmp/cache-test/test.txt", "This is the test file content for cache comparison testing.\n");

const TURNS = [
  "Read /tmp/cache-test/test.txt once. What does it contain?",
  "Read /tmp/cache-test/test.txt again. What is the same file content?",
  "Read /tmp/cache-test/test.txt a third time. What does it still contain?",
  "Read /tmp/cache-test/test.txt a fourth time. What is the unchanged content?",
  "Read /tmp/cache-test/test.txt a fifth time. What is the content?",
  "Read /tmp/cache-test/test.txt again. What is there now?",
  "Read /tmp/cache-test/test.txt yet again. What's inside?",
  "Read /tmp/cache-test/test.txt. Same content?",
  "Read /tmp/cache-test/test.txt once more. Confirm content.",
  "Read /tmp/cache-test/test.txt. Any change?",
];

function aggregate(results) {
  const sum = results.reduce((s, r) => ({
    input: s.input + r.input,
    cacheRead: s.cacheRead + r.cacheRead,
    cacheWrite: s.cacheWrite + r.cacheWrite,
  }), { input: 0, cacheRead: 0, cacheWrite: 0 });
  const total = sum.input + sum.cacheRead;
  return { ...sum, total, hitPct: total > 0 ? Math.round((sum.cacheRead / total) * 100) : 0 };
}

function print(label, results) {
  console.log(`\n──── ${label} ────`);
  for (const r of results) {
    const total = r.input + r.cacheRead;
    const hp = total > 0 ? Math.round((r.cacheRead / total) * 100) : 0;
    console.log(`  T${String(r.turn).padStart(2)}:  i=${String(r.input).padStart(6)}  r=${String(r.cacheRead).padStart(6)}  w=${String(r.cacheWrite).padStart(6)}  tot=${String(total).padStart(6)}  ${hp}%`);
  }
  const a = aggregate(results);
  console.log(`  ${"─".repeat(54)}`);
  console.log(`  TOTAL: i=${String(a.input).padStart(6)}  r=${String(a.cacheRead).padStart(6)}  w=${String(a.cacheWrite).padStart(6)}  tot=${String(a.total).padStart(6)}  ${a.hitPct}%`);
  return a;
}

async function runTest(ext) {
  const mr = await ModelRuntime.create();
  const m = mr.getModel("agentrium", "deepseek-v4-flash");

  const loader = new DefaultResourceLoader({
    cwd: "/tmp/cache-test",
    agentDir: process.env.HOME + "/.pi/agent",
    systemPromptOverride: () => "You are a test assistant. Answer concisely. Use the read tool when asked to read a file.",
    extensionFactories: ext ? [ext] : [],
  });
  await loader.reload();

  const sm = SessionManager.inMemory("/tmp/cache-test");
  const ss = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });

  const { session } = await createAgentSession({
    cwd: "/tmp/cache-test",
    model: m ?? undefined,
    thinkingLevel: "off",
    tools: ["read", "bash"],
    modelRuntime: mr,
    resourceLoader: loader,
    sessionManager: sm,
    settingsManager: ss,
  });

  const results = [];
  for (let i = 0; i < TURNS.length; i++) {
    try { await session.prompt(TURNS[i]); } catch (e) { console.log(`T${i+1}: ${e.message.split("\n")[0]}`); }
    const msgs = session.messages;
    let usage = null;
    for (let j = msgs.length - 1; j >= 0; j--) {
      if (msgs[j].role === "assistant" && msgs[j].usage) { usage = msgs[j].usage; break; }
    }
    results.push(usage
      ? { turn: i+1, input: usage.input ?? 0, cacheRead: usage.cacheRead ?? 0, cacheWrite: usage.cacheWrite ?? 0 }
      : { turn: i+1, input: 0, cacheRead: 0, cacheWrite: 0 });
  }
  session.dispose();
  return results;
}

// ── Test 1: WITHOUT extension ──
const r1 = await runTest(null);
const a1 = print("WITHOUT", r1);

// ── Test 2: WITH cache-guardian extension ──
const extFile = "/root/codes/pi-cache-guardian/extensions/cache-guardian.ts";
const extMod = await import(extFile);
const extFactory = extMod.default || extMod;

const r2 = await runTest(extFactory);
const a2 = print("WITH cache-guardian", r2);

console.log("\n═══════════════ COMPARISON ═══════════════");
console.log(`                    input       cacheRead   cacheWrite  total       hit%`);
console.log(`Without:  ${String(a1.input).padStart(8)}   ${String(a1.cacheRead).padStart(8)}   ${String(a1.cacheWrite).padStart(8)}   ${String(a1.total).padStart(8)}   ${a1.hitPct}%`);
console.log(`With:     ${String(a2.input).padStart(8)}   ${String(a2.cacheRead).padStart(8)}   ${String(a2.cacheWrite).padStart(8)}   ${String(a2.total).padStart(8)}   ${a2.hitPct}%`);
const dI = a1.input - a2.input;
const dR = a2.cacheRead - a1.cacheRead;
console.log(`\nReduced uncached input: ${dI > 0 ? dI : 0} tokens (${Math.round((Math.max(0, dI) / Math.max(1, a1.input)) * 100)}% less)`);
console.log(`Extra cacheRead:        ${dR > 0 ? "+" : ""}${dR} tokens`);
console.log(`Hit rate:               ${a1.hitPct}% → ${a2.hitPct}% (+${a2.hitPct - a1.hitPct} pts)`);
console.log(`Winner: ${a2.hitPct > a1.hitPct ? "WITH extension" : a2.hitPct < a1.hitPct ? "WITHOUT extension" : "Similar"}`);