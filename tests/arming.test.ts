import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const extensionSource = readFileSync(join(import.meta.dir, "..", "extension.ts"), "utf8");

test("the agent-callable tool can arm but never release", () => {
  const actionEnum = extensionSource.match(/action: StringEnum\(\[([^\]]*)\]/)?.[1] ?? "";
  expect(actionEnum).toContain("arm");
  expect(actionEnum).not.toContain("release");
  expect(actionEnum).not.toContain("off");
  expect(actionEnum).toContain("lock");
  expect(actionEnum).toContain("override");
  expect(actionEnum).toContain("gate");
});

test("arming requires a stated north star", () => {
  expect(extensionSource).toContain("arm rejected: northStar is required");
});

test("arming refuses when a loop is already live", () => {
  expect(extensionSource).toContain("arm rejected: terraloop is already");
});

test("releasing stays a user slash command", () => {
  expect(extensionSource).toContain('pi.registerCommand("terraloop"');
  expect(extensionSource).toContain('pi.registerCommand("terraloop-off"');
  expect(extensionSource).toContain('pi.registerCommand("terraloop-status"');
});

test("gate and release persist review evidence", () => {
  expect(extensionSource).toContain("gateReceipt");
  expect(extensionSource).toContain("releaseState(previous)");
  expect(extensionSource).toContain("lastCompletedLoop: released.lastCompletedLoop");
});

test("both arming paths record how the loop was armed", () => {
  expect(extensionSource).toContain('via: "agent-tool"');
  expect(extensionSource).toContain('via: "slash-command"');
});

test("no prompt-intent regex arms the gate", () => {
  expect(extensionSource).not.toMatch(/gogogogo|terraloop this|event\.prompt/);
});
