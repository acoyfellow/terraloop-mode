import { expect, test } from "bun:test";
import { evaluate, requestOverride, consumeOverride } from "../gate.ts";
import { initialState, overrideBudget, type LoopState } from "../state.ts";
import { firstRunnableCommand, verifyProof, type CommandRunner } from "../proof.ts";

const contract = { goal: "g", gate: "b", scope: ["/repo"], proof: "bun test" };

function state(overrides: Partial<LoopState>): LoopState {
  return { ...initialState(), ...overrides };
}

test("a gated loop can still spawn children to finish verifying", () => {
  const gated = state({ phase: "gated", contract });
  expect(evaluate(gated, "spawn").allowed).toBe(true);
  expect(evaluate(gated, "driver-delete").allowed).toBe(true);
});

test("a gated loop still refuses a second driver", () => {
  expect(evaluate(state({ phase: "gated", contract }), "driver-create").allowed).toBe(false);
});

test("the override budget is finite and refuses past the cap", () => {
  const atCap = state({ phase: "driving", contract, overrideGrantsUsed: overrideBudget });
  const refused = requestOverride(atCap, "this is a long enough reason", 1, overrideBudget);
  expect(refused.granted).toBe(false);
  if (!refused.granted) expect(refused.reason).toContain("budget exhausted");
});

test("a granted override increments the used count and caps calls at three", () => {
  const fresh = state({ phase: "driving", contract });
  const granted = requestOverride(fresh, "child stalled twice on this edit", 99, overrideBudget);
  expect(granted.granted).toBe(true);
  if (!granted.granted) return;
  expect(granted.calls).toBe(3);
  expect(granted.state.overrideGrantsUsed).toBe(1);
});

test("a short reason is refused", () => {
  const refused = requestOverride(state({ phase: "driving", contract }), "why", 1, overrideBudget);
  expect(refused.granted).toBe(false);
});

test("consuming an override counts the inline mutation", () => {
  const granted = state({ phase: "driving", contract, override: { reason: "long enough reason here", grantedAt: "now", remainingCalls: 1 } });
  const after = consumeOverride(granted);
  expect(after.inlineMutations).toBe(1);
  expect(after.override).toBeNull();
});

test("proof extraction finds a clean runnable command", () => {
  expect(firstRunnableCommand("bun test")).toBe("bun test");
  expect(firstRunnableCommand("curl -s https://example.test/health | grep ok")).toBe("curl -s https://example.test/health | grep ok");
  expect(firstRunnableCommand("the endpoint looks right and the vibes are good")).toBeNull();
});

test("prose assertions are never executed as shell", () => {
  expect(firstRunnableCommand("bun test >= 77 pass / 0 fail")).toBeNull();
  expect(firstRunnableCommand("bun test must show 0 failures")).toBeNull();
  expect(firstRunnableCommand("curl /state shows the car")).toBeNull();
  expect(firstRunnableCommand("node check.js == 200")).toBeNull();
});

test("a proof whose first command is prose refuses rather than running a redirect", () => {
  let executed = "";
  const runner: CommandRunner = (command) => {
    executed = command;
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  const outcome = verifyProof("bun test >= 77 pass / 0 fail; npx tsc --noEmit", runner);
  expect(outcome.verified).toBe(false);
  expect(executed).toBe("");
});

test("a passing proof command verifies the gate", () => {
  const runner: CommandRunner = () => ({ exitCode: 0, stdout: "77 pass 0 fail", stderr: "" });
  const outcome = verifyProof("bun test", runner);
  expect(outcome.verified).toBe(true);
});

test("a failing proof command refuses the gate", () => {
  const runner: CommandRunner = () => ({ exitCode: 1, stdout: "", stderr: "3 fail" });
  const outcome = verifyProof("bun test", runner);
  expect(outcome.verified).toBe(false);
  if (!outcome.verified && outcome.command !== null) expect(outcome.exitCode).toBe(1);
});

test("an unrunnable proof cannot self-certify the gate", () => {
  const outcome = verifyProof("it works, trust me", () => ({ exitCode: 0, stdout: "", stderr: "" }));
  expect(outcome.verified).toBe(false);
  if (!outcome.verified) expect(outcome.command).toBeNull();
});

test("delegation and inline counters start at zero and are tracked separately", () => {
  const fresh = initialState();
  expect(fresh.delegatedSpawns).toBe(0);
  expect(fresh.inlineMutations).toBe(0);
  expect(fresh.overrideGrantsUsed).toBe(0);
});

test("a proof that changes directory first is runnable, and keeps the cd", () => {
  const proof = "cd /Users/jcoeyman/cloudflare/terraloop-mode && bun run check";
  expect(firstRunnableCommand(proof)).toBe(proof);
});

test("quoted and chained directory changes are still runnable", () => {
  expect(firstRunnableCommand('cd "/tmp/a b" && npm test')).toBe('cd "/tmp/a b" && npm test');
  expect(firstRunnableCommand("cd /tmp && cd sub && make")).toBe("cd /tmp && cd sub && make");
});

test("a bare directory change proves nothing", () => {
  expect(firstRunnableCommand("cd /tmp/project")).toBeNull();
});

test("prose after a directory change is still refused", () => {
  expect(firstRunnableCommand("cd /tmp && bun test >= 77 pass")).toBeNull();
});
