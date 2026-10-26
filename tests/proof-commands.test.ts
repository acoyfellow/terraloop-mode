import { expect, test } from "bun:test";
import { firstRunnableCommand, proofProblem } from "../proof.ts";

test("a relative script path is a runnable proof", () => {
  expect(firstRunnableCommand("./gate.sh")).toBe("./gate.sh");
});

test("a directory change before a script path is a runnable proof", () => {
  expect(firstRunnableCommand("cd effect && ./gate.sh")).toBe("cd effect && ./gate.sh");
});

test("absolute and home script paths are runnable proofs", () => {
  expect(firstRunnableCommand("/usr/local/bin/check --all")).toBe("/usr/local/bin/check --all");
  expect(firstRunnableCommand("~/bin/gate")).toBe("~/bin/gate");
});

test("any executable on PATH is a runnable proof, not only a fixed list", () => {
  expect(firstRunnableCommand("test -f README.md")).toBe("test -f README.md");
  expect(firstRunnableCommand("git diff --exit-code")).toBe("git diff --exit-code");
});

test("English prose is still not a runnable proof", () => {
  expect(firstRunnableCommand("the endpoint looks right and the vibes are good")).toBeNull();
  expect(firstRunnableCommand("tests pass on main")).toBeNull();
});

test("lock-time check names the problem for an unrunnable proof and passes a runnable one", () => {
  expect(proofProblem("./gate.sh")).toBeNull();
  expect(proofProblem("the tests pass")).toContain("no runnable command");
});
