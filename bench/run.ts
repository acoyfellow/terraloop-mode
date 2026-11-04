import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { classifyTool, credentialAccess, evaluate, opaqueShellWrite, persistenceTarget, outOfScopeShellWrite, outOfScopeSpawnPath, pathIsInScope, protectedTarget } from "../gate.ts";
import { settleTickDecision } from "../settle.ts";
import { initialState, type LoopState } from "../state.ts";
import { cases, home, scope, type B2Case } from "./b2-cases.ts";
import { scenario } from "./b3-scenario.ts";
import { attackGateRoot, attackScope, attacks } from "./b9-attacks.ts";

const contract = { goal: "g", gate: "b", scope: [...scope], proof: "bun test" };

const stateFor = (phase: B2Case["phase"]): LoopState => ({ ...initialState(), phase, contract, driverLoopId: "drv", driverPrompt: "tick" });

const decide = (testCase: B2Case, caseScope: readonly string[] = scope): "allow" | "block" => {
  const state = { ...stateFor(testCase.phase), contract: { ...contract, scope: [...caseScope] } };
  if (credentialAccess(testCase.input, home)) return "block";
  if (persistenceTarget(testCase.toolName, testCase.input, home)) return "block";
  if (testCase.toolName === "bash" && opaqueShellWrite(testCase.input, caseScope, home)) return "block";
  if (protectedTarget(testCase.toolName, testCase.input, home, attackGateRoot)) return "block";
  const intent = classifyTool(testCase.toolName, testCase.input);
  if (intent === "read" || intent === "terraloop-control") return "allow";
  if (intent === "mutate" && state.phase === "driving") {
    const path = testCase.input.path;
    if (typeof path === "string" && !pathIsInScope(path, caseScope)) return "block";
    if (testCase.toolName === "bash" && outOfScopeShellWrite(testCase.input, caseScope, home)) return "block";
  }
  if (intent === "spawn" && (state.phase === "driving" || state.phase === "gated") && outOfScopeSpawnPath(testCase.input, caseScope)) return "block";
  return evaluate(state, intent).allowed ? "allow" : "block";
};

const runB2 = () => {
  const outcomes = cases.map((testCase) => ({ testCase, got: decide(testCase) }));
  const wrong = outcomes.filter((outcome) => outcome.got !== outcome.testCase.expect);
  const falseBlocks = wrong.filter((outcome) => outcome.testCase.expect === "allow").map((outcome) => outcome.testCase.id);
  const missedBlocks = wrong.filter((outcome) => outcome.testCase.expect === "block").map((outcome) => outcome.testCase.id);
  return { cases: cases.length, falseBlocks: falseBlocks.length, missedBlocks: missedBlocks.length, errors: wrong.length, falseBlockIds: falseBlocks, missedBlockIds: missedBlocks };
};

const runB9 = () => {
  const outcomes = attacks.map((testCase) => ({ testCase, got: decide(testCase, attackScope) }));
  const escapes = outcomes.filter((outcome) => outcome.testCase.expect === "block" && outcome.got === "allow").map((outcome) => outcome.testCase.id);
  const brokenControls = outcomes.filter((outcome) => outcome.testCase.expect === "allow" && outcome.got === "block").map((outcome) => outcome.testCase.id);
  const attackCount = attacks.filter((testCase) => testCase.expect === "block").length;
  return { attacks: attackCount, escapes: escapes.length, held: attackCount - escapes.length, brokenControls: brokenControls.length, escapeIds: escapes, brokenControlIds: brokenControls };
};

const runB3 = () => {
  const state: LoopState = { ...initialState(), phase: "driving", contract, driverLoopId: "drv", driverPrompt: "tick" };
  const tally = scenario.reduce(
    (acc, turn) => {
      const decision = settleTickDecision(acc.state, { toolCallsThisRun: turn.toolCalls, idle: true, pendingMessages: false });
      const delivered = decision.deliver;
      const wanted = turn.newEvidence || turn.childCallback;
      return {
        state: decision.deliver ? decision.state : acc.state,
        emptyTicks: acc.emptyTicks + (delivered && !wanted ? 1 : 0),
        usefulTicks: acc.usefulTicks + (delivered && wanted ? 1 : 0),
        missedWakes: acc.missedWakes + (!delivered && wanted ? 1 : 0),
      };
    },
    { state, emptyTicks: 0, usefulTicks: 0, missedWakes: 0 },
  );
  return {
    turns: scenario.length,
    emptyTicks: tally.emptyTicks,
    usefulTicks: tally.usefulTicks,
    missedWakes: tally.missedWakes,
    emptyPerUseful: +(tally.emptyTicks / Math.max(tally.usefulTicks, 1)).toFixed(2),
  };
};

type AuditEvent = { at: string; sessionId?: string; event: string };

const parseLine = (line: string): AuditEvent | null => {
  try {
    return JSON.parse(line) as AuditEvent;
  } catch {
    return null;
  }
};

const runB3History = () => {
  const path = join(homedir(), ".terrarium", "terraloop-audit.jsonl");
  if (!existsSync(path)) return { available: false };
  const ticks = readFileSync(path, "utf8")
    .split("\n")
    .map(parseLine)
    .filter((event): event is AuditEvent => event !== null && event.event === "settle-tick-delivered");
  const lastBySession = new Map<string, number>();
  const rapid = ticks.filter((event) => {
    const at = Date.parse(event.at);
    const key = event.sessionId ?? "";
    const previous = lastBySession.get(key);
    lastBySession.set(key, at);
    return previous !== undefined && at - previous < 60_000;
  }).length;
  return { available: true, deliveredTicks: ticks.length, rapidTicks: rapid, rapidTickShare: +(rapid / Math.max(ticks.length, 1)).toFixed(2) };
};

const sha = execSync("git rev-parse --short HEAD", { cwd: join(import.meta.dir, ".."), encoding: "utf8" }).trim();
const dirty = execSync("git status --short -- gate.ts settle.ts state.ts extension.ts", { cwd: join(import.meta.dir, ".."), encoding: "utf8" }).trim().length > 0;

const result = { at: new Date().toISOString(), sha, dirty, b2: runB2(), b3: runB3(), b9: runB9(), b3h: runB3History() };

if (process.argv.includes("--record")) appendFileSync(join(import.meta.dir, "results.jsonl"), `${JSON.stringify(result)}\n`);

console.log(`bench @ ${sha}${dirty ? " (dirty)" : ""}`);
console.log(`B2 lock   errors ${result.b2.errors}/${result.b2.cases}  false blocks ${result.b2.falseBlocks}  missed blocks ${result.b2.missedBlocks}`);
console.log(`          false: ${result.b2.falseBlockIds.join(", ") || "-"}`);
console.log(`          missed: ${result.b2.missedBlockIds.join(", ") || "-"}`);
console.log(`B3 alive  empty/useful ${result.b3.emptyPerUseful}  empty ${result.b3.emptyTicks}  useful ${result.b3.usefulTicks}  missed wakes ${result.b3.missedWakes}`);
console.log(`B9 trust  escapes ${result.b9.escapes}/${result.b9.attacks}  held ${result.b9.held}  broken controls ${result.b9.brokenControls}`);
console.log(`          escaped: ${result.b9.escapeIds.join(", ") || "-"}`);
console.log(`B3h past  ${JSON.stringify(result.b3h)}`);
