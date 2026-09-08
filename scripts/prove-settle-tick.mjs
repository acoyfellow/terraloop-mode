import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const workspace = mkdtempSync(join(tmpdir(), "terraloop-settle-proof-"));
const proofOut = join(workspace, "harness.jsonl");
const auditPath = join(homedir(), ".terrarium", "terraloop-audit.jsonl");
const auditLinesBefore = existsSync(auditPath) ? readFileSync(auditPath, "utf8").split("\n").length : 0;

const prompt = "Use the bash tool to run exactly this command: echo settle-proof-start. Then reply with the single word DONE.";
const run = spawnSync(
  "pi",
  ["-p", "--no-session", "-e", join(root, "scripts", "settle-proof-harness.ts"), prompt],
  { cwd: root, env: { ...process.env, TERRALOOP_PROOF_OUT: proofOut }, encoding: "utf8", timeout: 300_000 },
);

const harness = existsSync(proofOut)
  ? readFileSync(proofOut, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
  : [];
const sessionId = harness.find((entry) => entry.event === "seeded")?.sessionId ?? null;
const statePath = sessionId ? join(homedir(), ".terrarium", "terraloop-state", `${sessionId}.json`) : null;
const state = statePath && existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : null;
const auditAfter = existsSync(auditPath) ? readFileSync(auditPath, "utf8").split("\n") : [];
const audit = auditAfter
  .slice(Math.max(0, auditLinesBefore - 1))
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter((entry) => entry.sessionId === sessionId);

const delivered = audit.filter((entry) => entry.event === "settle-tick-delivered");
const skipped = audit.filter((entry) => entry.event === "settle-tick-skipped");
const assistantTexts = harness.filter((entry) => entry.event === "assistant_message").map((entry) => entry.text);
const agentStarts = harness.filter((entry) => entry.event === "agent_start").length;
const tickAnswered = assistantTexts.some((text) => text.includes("TERRALOOP_TICK_OK"));

const checks = {
  piExitedZero: run.status === 0,
  sessionSeeded: sessionId !== null,
  twoAgentRuns: agentStarts === 2,
  oneSettleTickDelivered: delivered.length === 1,
  tickAnsweredByModel: tickAnswered,
  finalRunSkippedForNoToolCalls: skipped.some((entry) => String(entry.reason).includes("no tool calls")),
  settleTicksPersistedOnce: state?.settleTicks === 1,
};
const failures = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);

if (statePath && existsSync(statePath)) rmSync(statePath);
rmSync(workspace, { recursive: true, force: true });

console.log(JSON.stringify({ sessionId, checks, agentStarts, delivered: delivered.length, skipped: skipped.map((entry) => entry.reason), assistantTexts, piStatus: run.status }, null, 2));
if (failures.length > 0) {
  console.error(run.stdout.slice(-2000));
  console.error(run.stderr.slice(-2000));
  console.error(`settle tick proof failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("settle tick proof passed: agent_settled delivered exactly one driver tick in headless pi");
