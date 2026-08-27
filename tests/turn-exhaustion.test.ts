import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeadSpot, requiredTurnAction, type TurnSituation } from "../src/turn-exhaustion.ts";

const idle: TurnSituation = {
  inScopeWorkRemains: false,
  callbackPending: false,
  wouldWaitForHeartbeat: false,
  spawnTimedOut: false,
  hookFailStalledTwice: false,
  hookFailStalledOnce: false,
  cancelCorpse143: false,
  listStatusTimedOut: false,
  knownRunId: false,
  outOfScopeWrite: false,
  gateMet: false,
  childrenRunning: false,
  independentParentStep: false,
};

test("callback with remaining work stays in this turn", () => {
  const s = { ...idle, callbackPending: true, inScopeWorkRemains: true };
  expect(requiredTurnAction(s)).toBe("handle_callback");
  expect(isDeadSpot({ ...s, wouldWaitForHeartbeat: true })).toBe(true);
});

test("parent work with no child does not yield to heartbeat", () => {
  const s = { ...idle, inScopeWorkRemains: true };
  expect(requiredTurnAction(s)).toBe("continue_turn");
  expect(isDeadSpot({ ...s, wouldWaitForHeartbeat: true })).toBe(true);
});

test("truly idle turn may end so the heartbeat can net", () => {
  const s = { ...idle, wouldWaitForHeartbeat: true };
  expect(requiredTurnAction(s)).toBe("end_turn_idle");
  expect(isDeadSpot(s)).toBe(false);
});

test("saying wait for heartbeat while work remains is a dead spot", () => {
  const s = { ...idle, inScopeWorkRemains: true, wouldWaitForHeartbeat: true };
  expect(requiredTurnAction(s)).toBe("continue_turn");
  expect(isDeadSpot(s)).toBe(true);
});

test("spawn timeout recovers ids this turn and does not twin", () => {
  expect(requiredTurnAction({ ...idle, spawnTimedOut: true })).toBe("recover_ids");
});

test("hook-fail once cancels; twice parent does the work", () => {
  expect(requiredTurnAction({ ...idle, hookFailStalledOnce: true })).toBe("cancel_once");
  expect(requiredTurnAction({ ...idle, hookFailStalledTwice: true })).toBe("parent_does_work");
});

test("exit 143 is a corpse; remaining work still continues the turn", () => {
  expect(requiredTurnAction({ ...idle, cancelCorpse143: true })).toBe("ignore_corpse");
  expect(requiredTurnAction({ ...idle, cancelCorpse143: true, inScopeWorkRemains: true })).toBe("continue_turn");
});

test("list-mode timeout with a known id uses by-id status this turn", () => {
  expect(requiredTurnAction({ ...idle, listStatusTimedOut: true, knownRunId: true })).toBe("handle_callback");
});

test("out of scope write does not spawn a laundering child or wait", () => {
  expect(requiredTurnAction({ ...idle, outOfScopeWrite: true })).toBe("stop_or_ask");
});

test("gate met deletes the driver this turn", () => {
  expect(requiredTurnAction({ ...idle, gateMet: true, inScopeWorkRemains: true })).toBe("delete_driver");
});

test("running children plus independent parent work continues the turn", () => {
  const s = { ...idle, childrenRunning: true, independentParentStep: true };
  expect(requiredTurnAction(s)).toBe("continue_turn");
});

test("gherkin feature names every stall path", () => {
  const feature = readFileSync(join(import.meta.dir, "../features/turn-exhaustion.feature"), "utf8");
  for (const needle of [
    "Callback arrives while the parent still has work",
    "This turn never spawned Terrarium",
    "Heartbeat is only the idle net",
    "Model says it will wait for the heartbeat",
    "Spawn batch RPC times out",
    "Child log is banner plus hook-fail",
    "Cancelled callback with exit 143",
    "List-mode status times out",
    "Scope block on parent write",
    "Gate is met",
    "Live children and parent work both exist",
  ]) {
    expect(feature).toContain(needle);
  }
});
