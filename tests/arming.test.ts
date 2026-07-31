import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const extensionSource = readFileSync(join(import.meta.dir, "..", "extension.ts"), "utf8");

test("the LLM-callable tool cannot arm or release terraloop", () => {
  const actionEnum = extensionSource.match(/action: StringEnum\(\[([^\]]*)\]/)?.[1] ?? "";
  expect(actionEnum).not.toContain("arm");
  expect(actionEnum).not.toContain("release");
  expect(actionEnum).toContain("lock");
  expect(actionEnum).toContain("override");
  expect(actionEnum).toContain("gate");
});

test("arming and releasing are registered as user slash commands", () => {
  expect(extensionSource).toContain('pi.registerCommand("terraloop"');
  expect(extensionSource).toContain('pi.registerCommand("terraloop-off"');
  expect(extensionSource).toContain('pi.registerCommand("terraloop-status"');
});

test("the tool refuses to operate while terraloop is off", () => {
  expect(extensionSource).toContain('return text("terraloop is off. Only the user can arm it, with /terraloop.');
});

test("no prompt-intent regex arms the gate", () => {
  expect(extensionSource).not.toMatch(/gogogogo|terraloop this|event\.prompt/);
});
