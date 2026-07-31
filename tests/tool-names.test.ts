import { expect, test } from "bun:test";
import { classifyTool } from "../gate.ts";

const requiredSpawnTools = ["terrarium_terrarium_spawn", "terrarium_terrarium_spawn_batch"] as const;

test("the gate recognizes the live terrarium spawn tool names", () => {
  for (const name of requiredSpawnTools) {
    expect(classifyTool(name, {})).toBe("spawn");
  }
});

test("an unrecognized spawn-shaped name is not silently treated as spawn", () => {
  expect(classifyTool("terrarium_spawn", {})).toBe("read");
  expect(classifyTool("spawn", {})).toBe("read");
});

test("the driver tool is recognized by action", () => {
  expect(classifyTool("loops_task", { action: "create" })).toBe("driver-create");
  expect(classifyTool("loops_task", {})).toBe("read");
  expect(classifyTool("loops_task", { action: null })).toBe("read");
});

test("classification tolerates malformed input without throwing", () => {
  expect(classifyTool("bash", null)).toBe("read");
  expect(classifyTool("bash", { command: 42 })).toBe("read");
  expect(classifyTool("loops_task", null)).toBe("read");
  expect(classifyTool("edit", undefined)).toBe("mutate");
});
