import { expect, test } from "bun:test";
import { settleTickBudget, settleTickDecision, settleTickMessage } from "../settle.ts";
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
