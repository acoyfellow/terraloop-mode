import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HOME = mkdtempSync(join(tmpdir(), "terraloop-off-"));

type Handler = (event: unknown, ctx: unknown) => unknown;
type Listener = (data: unknown) => void;

function fakePi() {
  const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
  const hooks = new Map<string, Handler[]>();
  const listeners = new Map<string, Listener[]>();
  const emitted: Array<{ name: string; data: unknown }> = [];
  const pi = {
    registerCommand: (name: string, spec: { handler: (args: string, ctx: unknown) => Promise<void> }) => commands.set(name, spec),
    registerTool: () => undefined,
    on: (name: string, handler: Handler) => hooks.set(name, [...(hooks.get(name) ?? []), handler]),
    sendMessage: () => undefined,
    appendEntry: () => undefined,
    events: {
      on: (name: string, listener: Listener) => listeners.set(name, [...(listeners.get(name) ?? []), listener]),
      emit: (name: string, data: unknown) => {
        emitted.push({ name, data });
        for (const listener of listeners.get(name) ?? []) listener(data);
      },
    },
  };
  return { pi, commands, hooks, emitted };
}

function fakeCtx(sessionId: string) {
  const notes: string[] = [];
  return {
    notes,
    ctx: {
      sessionManager: { getSessionId: () => sessionId },
      ui: { notify: (message: string) => notes.push(message) },
      hasUI: false,
      isIdle: () => true,
      hasPendingMessages: () => false,
    },
  };
}

async function fireToolResult(hooks: Map<string, Handler[]>, ctx: unknown, input: unknown, content: string) {
  for (const handler of hooks.get("tool_result") ?? []) {
    await handler({ toolName: "loops_task", input, content: [{ type: "text", text: content }], details: {} }, ctx);
  }
}

test("/terraloop-off stops a loop created while terraloop was off", async () => {
  const { default: terraloopMode } = await import("../extension.ts");
  const { pi, commands, hooks, emitted } = fakePi();
  terraloopMode(pi as never);
  const { ctx, notes } = fakeCtx("off-loop-session");

  await fireToolResult(hooks, ctx, { action: "create", interval: "5m", prompt: "tick" }, "Created f1bb45ea every 5m · next 300s");
  await commands.get("terraloop-off")?.handler("", ctx);

  expect(emitted).toContainEqual({ name: "loops:stop", data: { id: "f1bb45ea" } });
  expect(notes.join("\n")).toContain("stopped loops f1bb45ea");
});

test("/terraloop-off does not stop a loop the agent already deleted", async () => {
  const { default: terraloopMode } = await import("../extension.ts");
  const { pi, commands, hooks, emitted } = fakePi();
  terraloopMode(pi as never);
  const { ctx } = fakeCtx("deleted-loop-session");

  await fireToolResult(hooks, ctx, { action: "create", interval: "5m", prompt: "tick" }, "Created 0a1b2c3d every 5m · next 300s");
  await fireToolResult(hooks, ctx, { action: "delete", id: "0a1b2c3d" }, "Stopped loop 0a1b2c3d.");
  await commands.get("terraloop-off")?.handler("", ctx);

  expect(emitted.filter((event) => event.name === "loops:stop")).toEqual([]);
});
