import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

type Phase = "off" | "armed" | "driving" | "gated";
type MergeMode = "never" | "gate";

type GateCase = { id: string; provider: string; merge: MergeMode; phase: Phase; command: string; expect: "block" | "allow" };
type ReadyCase = { id: string; provider: string; url: string; fixture: string; expectExit: number };
type CaseResult = { id: string; kind: "gate" | "merge-ready"; provider: string; pass: boolean; expected: string; actual: string };

const evalDir = import.meta.dir;
const repoRoot = join(evalDir, "..", "..");
const frozenFiles = ["cases.jsonl", "merge-ready.jsonl", "limits.jsonl", "run.ts"];

function readJsonl<T>(name: string): T[] {
  return readFileSync(join(evalDir, name), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

function evalHash(): string {
  const hash = createHash("sha256");
  for (const name of frozenFiles) hash.update(name).update("\0").update(readFileSync(join(evalDir, name)));
  for (const fixture of readJsonl<ReadyCase>("merge-ready.jsonl").map((entry) => entry.fixture).sort()) {
    hash.update(fixture).update("\0").update(readFileSync(join(evalDir, fixture)));
  }
  return hash.digest("hex");
}

const contract = {
  goal: "eval goal",
  gate: "eval gate",
  scope: ["/repo"],
  proof: "bun test",
};

type ToolCallHandler = (event: { toolName: string; input: unknown }, ctx: unknown) => unknown;

async function loadToolCallHandler(home: string): Promise<{ handler: ToolCallHandler; statePath: (sessionId: string) => string }> {
  process.env.HOME = home;
  const stamp = `${Date.now()}-${Math.random()}`;
  const extension = await import(`${join(repoRoot, "extension.ts")}?eval=${stamp}`);
  const state = await import(`${join(repoRoot, "state.ts")}?eval=${stamp}`);
  const handlers = new Map<string, ToolCallHandler>();
  const fakePi = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "on") return (name: string, handler: ToolCallHandler) => handlers.set(name, handler);
        if (property === "events") return { on: () => undefined, emit: () => undefined };
        return () => undefined;
      },
    },
  );
  extension.default(fakePi);
  const handler = handlers.get("tool_call");
  if (!handler) throw new Error("extension registered no tool_call handler");
  return { handler, statePath: (sessionId: string) => state.statePathForSession(sessionId) };
}

function stateFor(entry: GateCase): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    phase: entry.phase,
    contract: entry.phase === "off" ? null : { ...contract, merge: entry.merge },
    merge: entry.merge,
    gateReceipt: entry.phase === "gated" ? { command: "bun test", exitCode: 0, output: "ok", verifiedAt: now } : null,
    lastCompletedLoop: null,
    driverLoopId: entry.phase === "driving" || entry.phase === "gated" ? "eval0001" : null,
    spawnedRunIds: [],
    settleTicks: 0,
    override: null,
    overrideGrantsUsed: 0,
    inlineMutations: 0,
    delegatedSpawns: 0,
    updatedAt: now,
  };
}

async function runGateCases(cases: GateCase[]): Promise<CaseResult[]> {
  const home = mkdtempSync(join(tmpdir(), "full-stop-eval-"));
  const originalHome = process.env.HOME;
  try {
    const { handler, statePath } = await loadToolCallHandler(home);
    const results: CaseResult[] = [];
    for (const entry of cases) {
      const sessionId = `eval-${entry.id}`;
      const path = statePath(sessionId);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(stateFor(entry)));
      const ctx = { sessionManager: { getSessionId: () => sessionId }, cwd: "/repo", hasUI: false, ui: { notify: () => undefined } };
      let actual: "block" | "allow";
      try {
        const outcome = (await handler({ toolName: "bash", input: { command: entry.command } }, ctx)) as { block?: boolean } | undefined;
        actual = outcome?.block === true ? "block" : "allow";
      } catch (error) {
        actual = "allow";
        console.error(`${entry.id}: handler threw ${(error as Error).message}`);
      }
      results.push({ id: entry.id, kind: "gate", provider: entry.provider, pass: actual === entry.expect, expected: entry.expect, actual });
    }
    return results;
  } finally {
    process.env.HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  }
}

function runReadyCases(cases: ReadyCase[]): CaseResult[] {
  const binary = join(repoRoot, "bin", "merge-ready");
  return cases.map((entry) => {
    if (!existsSync(binary)) {
      return { id: entry.id, kind: "merge-ready", provider: entry.provider, pass: false, expected: `exit ${entry.expectExit}`, actual: "bin/merge-ready missing" };
    }
    const result = spawnSync(binary, [entry.url], {
      encoding: "utf8",
      env: { ...process.env, MERGE_READY_FIXTURE: join(evalDir, entry.fixture) },
      timeout: 20_000,
    });
    const code = result.status ?? -1;
    return { id: entry.id, kind: "merge-ready", provider: entry.provider, pass: code === entry.expectExit, expected: `exit ${entry.expectExit}`, actual: `exit ${code}` };
  });
}

function score(results: CaseResult[]): number {
  return results.length === 0 ? 0 : results.filter((result) => result.pass).length / results.length;
}

function byProvider(results: CaseResult[]): Record<string, string> {
  const providers = [...new Set(results.map((result) => result.provider))].sort();
  return Object.fromEntries(providers.map((provider) => {
    const subset = results.filter((result) => result.provider === provider);
    return [provider, `${subset.filter((result) => result.pass).length}/${subset.length}`];
  }));
}

const args = new Set(process.argv.slice(2));
const receiptsDir = join(repoRoot, "receipts");
const baselinePath = join(receiptsDir, "full-stop-baseline.json");
const freezePath = join(evalDir, "FROZEN.sha256");

const results = [...(await runGateCases(readJsonl<GateCase>("cases.jsonl"))), ...runReadyCases(readJsonl<ReadyCase>("merge-ready.jsonl"))];
const total = score(results);
const hash = evalHash();
const receipt = {
  eval: "full-stop",
  ranAt: new Date().toISOString(),
  evalSha256: hash,
  score: total,
  passed: results.filter((result) => result.pass).length,
  cases: results.length,
  byProvider: byProvider(results),
  byKind: { gate: `${results.filter((r) => r.kind === "gate" && r.pass).length}/${results.filter((r) => r.kind === "gate").length}`, mergeReady: `${results.filter((r) => r.kind === "merge-ready" && r.pass).length}/${results.filter((r) => r.kind === "merge-ready").length}` },
  unscoredKnownLimits: readJsonl<{ id: string }>("limits.jsonl").map((limit) => limit.id),
  failures: results.filter((result) => !result.pass),
};

mkdirSync(receiptsDir, { recursive: true });

if (args.has("--record-baseline")) {
  writeFileSync(baselinePath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`baseline recorded: ${receipt.passed}/${receipt.cases} (${(total * 100).toFixed(1)}%)`);
  process.exit(0);
}

if (args.has("--freeze")) {
  writeFileSync(freezePath, `${hash}\n`);
  console.log(`eval frozen: ${hash}`);
  process.exit(0);
}

writeFileSync(join(receiptsDir, "full-stop-eval.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`full-stop eval: ${receipt.passed}/${receipt.cases} (${(total * 100).toFixed(1)}%) gate=${receipt.byKind.gate} merge-ready=${receipt.byKind.mergeReady} github=${receipt.byProvider.github} gitlab=${receipt.byProvider.gitlab}`);
for (const failure of receipt.failures) console.log(`  FAIL ${failure.kind} ${failure.id}: expected ${failure.expected}, got ${failure.actual}`);

const problems: string[] = [];
if (args.has("--require-frozen")) {
  const frozen = existsSync(freezePath) ? readFileSync(freezePath, "utf8").trim() : "";
  if (frozen !== hash) problems.push(`eval hash ${hash} does not match FROZEN.sha256 (${frozen || "missing"})`);
}
if (args.has("--require-baseline-below-half")) {
  if (!existsSync(baselinePath)) problems.push("no baseline receipt recorded");
  else {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as { score: number; evalSha256: string };
    if (baseline.score >= 0.5) problems.push(`baseline score ${baseline.score} is not below 0.5, so the eval does not discriminate`);
    if (baseline.evalSha256 !== hash) problems.push("baseline was recorded against a different eval");
  }
}
if (total < 1) problems.push(`score ${total} is below 1.0`);

for (const problem of problems) console.log(`GATE: ${problem}`);
process.exit(problems.length === 0 ? 0 : 1);
