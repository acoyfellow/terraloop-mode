import { expect, test } from "bun:test";
import { callMakesProgress, settleTickBudget, settleTickDecision, settleTickMessage } from "../settle.ts";
import { initialState, type LoopState } from "../state.ts";

const contract = { goal: "g", gate: "b", scope: ["/repo"], proof: "bun test" };

function driving(overrides: Partial<LoopState> = {}): LoopState {
  return { ...initialState(), phase: "driving", contract, driverLoopId: "loop1", driverPrompt: "Do the next step.", ...overrides };
}

const productive = { toolCallsThisRun: 3, idle: true, pendingMessages: false };

test("a productive settled run while driving delivers the next tick immediately", () => {
  const decision = settleTickDecision(driving(), productive);
  expect(decision.deliver).toBe(true);
  if (decision.deliver) {
    expect(decision.tick).toBe(1);
    expect(decision.state.settleTicks).toBe(1);
  }
});

test("a settled run with no tool calls hands the next tick back to the heartbeat", () => {
  const decision = settleTickDecision(driving(), { ...productive, toolCallsThisRun: 0 });
  expect(decision.deliver).toBe(false);
  if (!decision.deliver) expect(decision.reason).toContain("no tool calls");
});

test("no tick fires outside the driving phase", () => {
  for (const phase of ["off", "armed", "gated"] as const) {
    expect(settleTickDecision(driving({ phase }), productive).deliver).toBe(false);
  }
});

test("no tick fires without a recorded driver or captured prompt", () => {
  expect(settleTickDecision(driving({ driverLoopId: null }), productive).deliver).toBe(false);
  expect(settleTickDecision(driving({ driverPrompt: null }), productive).deliver).toBe(false);
});

test("no tick fires while the agent is busy or a follow-up is already queued", () => {
  expect(settleTickDecision(driving(), { ...productive, idle: false }).deliver).toBe(false);
  expect(settleTickDecision(driving(), { ...productive, pendingMessages: true }).deliver).toBe(false);
});

test("the settle tick budget is finite", () => {
  const atCap = driving({ settleTicks: settleTickBudget });
  const decision = settleTickDecision(atCap, productive);
  expect(decision.deliver).toBe(false);
  if (!decision.deliver) expect(decision.reason).toContain("budget exhausted");
});

test("the delivered message carries the driver prompt and the tick number", () => {
  const message = settleTickMessage(driving(), 4);
  expect(message).toContain("settle tick 4");
  expect(message).toContain("loop1");
  expect(message).toContain("Do the next step.");
});

test("a settled run that only read or polled hands the next tick back to the heartbeat", () => {
  const decision = settleTickDecision(driving(), { ...productive, progressCallsThisRun: 0 });
  expect(decision.deliver).toBe(false);
  if (!decision.deliver) expect(decision.reason).toContain("only read or polled");
});

test("a settled run with at least one progress call still delivers", () => {
  expect(settleTickDecision(driving(), { ...productive, progressCallsThisRun: 1 }).deliver).toBe(true);
});

test("reads and polls are not progress; writes, spawns and driver changes are", () => {
  expect(callMakesProgress("read", { path: "/repo/a.ts" })).toBe(false);
  expect(callMakesProgress("bash", { command: "tail -5 run.log" })).toBe(false);
  expect(callMakesProgress("bash", { command: "git status --short" })).toBe(false);
  expect(callMakesProgress("edit", { path: "/repo/a.ts" })).toBe(true);
  expect(callMakesProgress("bash", { command: "echo row >> log.md" })).toBe(true);
  expect(callMakesProgress("loops_task", { action: "delete", id: "x" })).toBe(true);
  expect(callMakesProgress("loops_task", { action: "list" })).toBe(false);
});

test("no tick fires while the loop is waiting on the user", () => {
  const decision = settleTickDecision(driving({ waitingOn: "Pick option 1, 2 or 3" }), productive);
  expect(decision.deliver).toBe(false);
  if (!decision.deliver) expect(decision.reason).toContain("waiting on the user");
});
