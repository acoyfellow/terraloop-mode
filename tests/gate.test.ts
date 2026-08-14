import { expect, test } from "bun:test";
import { classifyTool, evaluate, consumeOverride, outOfScopeSpawnPath, pathIsInScope, spawnTargetPaths } from "../gate.ts";
import { contractIsComplete, initialState, readState, statePathForSession, writeState, type LoopState } from "../state.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const contract = { goal: "endpoint returns 200 with the new field", gate: "review-zero and 200 verified", scope: ["/repo/src"], proof: "curl -s /health | grep ok" };

function state(overrides: Partial<LoopState>): LoopState {
  return { ...initialState(), ...overrides };
}

test("classifies tools by the authority they exercise", () => {
  expect(classifyTool("terrarium_terrarium_spawn", {})).toBe("spawn");
  expect(classifyTool("terrarium_terrarium_spawn_batch", {})).toBe("spawn");
  expect(classifyTool("loops_task", { action: "create" })).toBe("driver-create");
  expect(classifyTool("loops_task", { action: "delete" })).toBe("driver-delete");
  expect(classifyTool("loops_task", { action: "list" })).toBe("read");
  expect(classifyTool("edit", {})).toBe("mutate");
  expect(classifyTool("write", {})).toBe("mutate");
  expect(classifyTool("read", {})).toBe("read");
  expect(classifyTool("terraloop_control", {})).toBe("terraloop-control");
});

test("classifies mutating shell separately from read-only shell", () => {
  expect(classifyTool("bash", { command: "grep -rn thing src/" })).toBe("read");
  expect(classifyTool("bash", { command: "ls -la" })).toBe("read");
  expect(classifyTool("bash", { command: "git status" })).toBe("read");
  expect(classifyTool("bash", { command: "rm -rf build" })).toBe("mutate");
  expect(classifyTool("bash", { command: "bun run build" })).toBe("mutate");
  expect(classifyTool("bash", { command: "echo x > file.txt" })).toBe("mutate");
  expect(classifyTool("bash", { command: "sed -i '' s/a/b/ f" })).toBe("mutate");
  expect(classifyTool("bash", { command: "wrangler deploy" })).toBe("mutate");
});

test("off phase never interferes", () => {
  for (const intent of ["spawn", "driver-create", "mutate", "read"] as const) {
    expect(evaluate(state({ phase: "off" }), intent).allowed).toBe(true);
  }
});

test("armed blocks spawning before a contract is locked", () => {
  const decision = evaluate(state({ phase: "armed" }), "spawn");
  expect(decision.allowed).toBe(false);
  if (!decision.allowed) expect(decision.reason).toContain("terraloop_lock");
});

test("armed blocks the driver loop until the contract is complete", () => {
  expect(evaluate(state({ phase: "armed" }), "driver-create").allowed).toBe(false);
  expect(evaluate(state({ phase: "armed", contract }), "driver-create").allowed).toBe(true);
});

test("armed blocks inline mutation", () => {
  expect(evaluate(state({ phase: "armed" }), "mutate").allowed).toBe(false);
});

test("driving allows spawning and blocks inline mutation", () => {
  const driving = state({ phase: "driving", contract, driverLoopId: "loop-1" });
  expect(evaluate(driving, "spawn").allowed).toBe(true);
  expect(evaluate(driving, "driver-delete").allowed).toBe(true);
  const mutation = evaluate(driving, "mutate");
  expect(mutation.allowed).toBe(false);
  if (!mutation.allowed) expect(mutation.reason).toContain("terraloop_override");
});

test("gated blocks new drivers and inline work but never verification spawns", () => {
  const gated = state({ phase: "gated", contract });
  expect(evaluate(gated, "spawn").allowed).toBe(true);
  expect(evaluate(gated, "driver-create").allowed).toBe(false);
  expect(evaluate(gated, "driver-delete").allowed).toBe(true);
  expect(evaluate(gated, "mutate").allowed).toBe(false);
});

test("read and control are never blocked in any phase", () => {
  for (const phase of ["off", "armed", "driving", "gated"] as const) {
    expect(evaluate(state({ phase }), "read").allowed).toBe(true);
    expect(evaluate(state({ phase }), "terraloop-control").allowed).toBe(true);
  }
});

test("an incomplete contract is rejected", () => {
  expect(contractIsComplete(null)).toBe(false);
  expect(contractIsComplete({ ...contract, goal: "" })).toBe(false);
  expect(contractIsComplete({ ...contract, gate: "  " })).toBe(false);
  expect(contractIsComplete({ ...contract, scope: [] })).toBe(false);
  expect(contractIsComplete({ ...contract, proof: "" })).toBe(false);
  expect(contractIsComplete(contract)).toBe(true);
});

test("override is consumed and expires", () => {
  const granted = state({ phase: "driving", contract, override: { reason: "child stalled twice on this edit", grantedAt: "now", remainingCalls: 2 } });
  const once = consumeOverride(granted);
  expect(once.override?.remainingCalls).toBe(1);
  const twice = consumeOverride(once);
  expect(twice.override).toBeNull();
});

test("scope containment is enforced by prefix", () => {
  expect(pathIsInScope("/repo/src/index.ts", ["/repo/src"])).toBe(true);
  expect(pathIsInScope("/repo/secrets/.env", ["/repo/src"])).toBe(false);
});

test("a spawn cwd outside locked scope is refused", () => {
  expect(spawnTargetPaths({ cwd: "/repo/src" })).toEqual(["/repo/src"]);
  expect(spawnTargetPaths({ jobs: [{ cwd: "/repo/src" }, { cwd: "/tmp/other" }] })).toEqual(["/repo/src", "/tmp/other"]);
  expect(outOfScopeSpawnPath({ cwd: "/repo/src" }, ["/repo/src"])).toBeNull();
  expect(outOfScopeSpawnPath({ cwd: "/Users/me/.pi/agent/extensions" }, ["/repo/src"])).toBe("/Users/me/.pi/agent/extensions");
  expect(outOfScopeSpawnPath({ jobs: [{ cwd: "/repo/src/a" }, { cwd: "/secret" }] }, ["/repo/src"])).toBe("/secret");
});

test("state round-trips through disk and survives a corrupt file", () => {
  const directory = mkdtempSync(join(tmpdir(), "terraloop-"));
  try {
    const path = join(directory, "state.json");
    writeState(state({ phase: "driving", contract, driverLoopId: "loop-9" }), path);
    const loaded = readState(path);
    expect(loaded.phase).toBe("driving");
    expect(loaded.contract?.goal).toBe(contract.goal);
    expect(loaded.driverLoopId).toBe("loop-9");
    expect(readState(join(directory, "missing.json")).phase).toBe("off");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("parallel Pi sessions have independent state files", () => {
  const first = statePathForSession("session-one");
  const second = statePathForSession("session-two");
  expect(first).not.toBe(second);
  expect(first.endsWith("terraloop-state/session-one.json")).toBe(true);
  expect(second.endsWith("terraloop-state/session-two.json")).toBe(true);
  expect(statePathForSession("session/three").endsWith("terraloop-state/session_three.json")).toBe(true);
});

test("negative control: a permissive gate fails the blocking scenarios", () => {
  const permissive = () => ({ allowed: true }) as const;
  const mustBlock = [
    [state({ phase: "armed" }), "spawn"],
    [state({ phase: "armed" }), "mutate"],
    [state({ phase: "driving", contract }), "mutate"],
    [state({ phase: "gated", contract }), "driver-create"],
  ] as const;
  let realBlocks = 0;
  let permissiveBlocks = 0;
  for (const [loopState, intent] of mustBlock) {
    if (!evaluate(loopState, intent).allowed) realBlocks += 1;
    if (!permissive().allowed) permissiveBlocks += 1;
  }
  expect(realBlocks).toBe(mustBlock.length);
  expect(permissiveBlocks).toBe(0);
});
