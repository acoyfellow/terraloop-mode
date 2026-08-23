import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { classifyTool, consumeOverride, evaluate, outOfScopeSpawnPath, pathIsInScope, requestOverride } from "./gate.ts";
import {
  contractIsComplete,
  describeState,
  initialState,
  overrideBudget,
  readState,
  recordAudit,
  releaseState,
  statePathForSession,
  writeState,
  type LoopState,
} from "./state.ts";
import { verifyProof } from "./proof.ts";

const controlParameters = Type.Object({
  action: StringEnum(["arm", "lock", "override", "status", "gate"] as const),
  northStar: Type.Optional(Type.String({ description: "What the loop is for, in one line. Required for arm." })),
  goal: Type.Optional(Type.String({ description: "Falsifiable end state. Required for lock." })),
  gate: Type.Optional(Type.String({ description: "Binary stop condition. Required for lock." })),
  scope: Type.Optional(Type.Array(Type.String(), { description: "Absolute paths in play. Required for lock." })),
  proof: Type.Optional(Type.String({ description: "Exact command or receipt that proves each step. Required for lock." })),
  reason: Type.Optional(Type.String({ description: "Why an inline action is required. Required for override." })),
  calls: Type.Optional(Type.Number({ description: "How many inline mutations the override covers. Default 1." })),
});

function text(body: string) {
  return { content: [{ type: "text" as const, text: body }], details: undefined };
}

function sessionId(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionId();
}

function readSessionState(ctx: ExtensionContext): LoopState {
  return readState(statePathForSession(sessionId(ctx)));
}

function writeSessionState(ctx: ExtensionContext, state: LoopState): LoopState {
  return writeState(state, statePathForSession(sessionId(ctx)));
}

function recordSessionAudit(ctx: ExtensionContext, entry: Record<string, unknown>): void {
  recordAudit({ sessionId: sessionId(ctx), ...entry });
}

function onRamp(northStar: string, armedBy: "the user, by slash command" | "you, by tool call"): string {
  return [
    `Terraloop is now ARMED for this Pi session, by ${armedBy}.`,
    northStar ? `North star: ${northStar}` : "No north star was supplied.",
    "",
    "Follow the terraloop protocol on-ramp:",
    "1. Read the terraloop skill if it is not already loaded.",
    "2. Draft the contract: Goal (falsifiable), Gate (binary), Scope (absolute paths), Proof (exact runnable command).",
    "3. Echo it back in about five lines and wait for a one-word go.",
    "4. After the go, call terraloop_control action=lock, create the driver loop, then spawn children.",
    "",
    "The gate blocks terrarium spawns and inline edit/write/mutating-bash in this session until the contract is locked and a driver exists. Do not work around it; satisfy it.",
    "Only the user can leave terraloop mode, with /terraloop-off.",
  ].join("\n");
}

export default function terraloopMode(pi: ExtensionAPI) {
  pi.registerTool({
    name: "terraloop_control",
    label: "Terraloop",
    description:
      "Run a terraloop: a bounded orchestration loop with a locked contract, a recurring driver, delegated children, and a verified stop gate. arm = enter terraloop mode with a northStar when the user asks for a loop. lock = record goal/gate/scope/proof after the user approves the contract. override = permit a bounded number of inline mutations with a recorded reason. gate = verify the stop condition by running the contract's proof. status = show current phase. Only the user can leave terraloop mode, with /terraloop-off.",
    promptSnippet: "Arm a terraloop, lock its contract, request an override, or verify its stop gate",
    promptGuidelines: [
      "Call terraloop_control action=arm with a northStar when the user asks for a terraloop, a driver loop, or a long autonomous run that should stop at a stated condition.",
      "Call terraloop_control action=lock with goal, gate, scope, and proof after the user approves the contract, before spawning any terrarium child.",
      "Call terraloop_control action=override with a reason when terraloop blocks an inline action that is genuinely required.",
      "Do not try to leave terraloop mode or clear its state; only the user can, with /terraloop-off.",
    ],
    parameters: controlParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const state = readSessionState(ctx);
      if (params.action === "status") return text(describeState(state));

      if (params.action === "arm") {
        const northStar = (params.northStar ?? "").trim();
        if (northStar.length < 8) {
          return text("arm rejected: northStar is required and must say what the loop is for in one line.");
        }
        if (state.phase !== "off") {
          return text(`arm rejected: terraloop is already ${state.phase} in this session.\n${describeState(state)}`);
        }
        const next = writeSessionState(ctx, { ...initialState(), lastCompletedLoop: state.lastCompletedLoop, phase: "armed" });
        recordSessionAudit(ctx, { event: "arm", via: "agent-tool", northStar });
        return text(`${describeState(next)}\n\n${onRamp(northStar, "you, by tool call")}`);
      }

      if (state.phase === "off") {
        return text("terraloop is off. Arm it first with terraloop_control action=arm and a northStar, or ask the user to run /terraloop.");
      }

      if (params.action === "lock") {
        const contract = { goal: params.goal ?? "", gate: params.gate ?? "", scope: params.scope ?? [], proof: params.proof ?? "" };
        if (!contractIsComplete(contract)) {
          return text("lock rejected: goal, gate, scope, and proof are all required and must be non-empty.");
        }
        const next = writeSessionState(ctx, { ...state, contract, gateReceipt: null });
        recordSessionAudit(ctx, { event: "lock", contract });
        return text(`${describeState(next)}\n\nContract locked. Create the driver loop with loops_task action=create, then spawn children.`);
      }

      if (params.action === "override") {
        const request = requestOverride(state, params.reason ?? "", params.calls ?? 1, overrideBudget);
        if (!request.granted) {
          recordSessionAudit(ctx, { event: "override-refused", reason: request.reason, grantsUsed: state.overrideGrantsUsed });
          return text(`Override refused: ${request.reason}`);
        }
        const next = writeSessionState(ctx, request.state);
        recordSessionAudit(ctx, { event: "override-granted", reason: params.reason, calls: request.calls, grantsUsed: next.overrideGrantsUsed });
        return text(
          `Override granted for ${request.calls} inline mutation(s). Grant ${next.overrideGrantsUsed} of ${overrideBudget} this loop.\n${describeState(next)}`,
        );
      }

      if (!contractIsComplete(state.contract)) {
        return text("gate rejected: no complete contract is locked, so there is no gate condition to verify.");
      }
      const proof = verifyProof(state.contract.proof);
      if (!proof.verified) {
        recordSessionAudit(ctx, { event: "gate-refused", command: proof.command, detail: proof.command === null ? proof.reason : `exit ${proof.exitCode}` });
        const detail =
          proof.command === null
            ? `${proof.reason}. Ask the user to confirm the gate, or re-lock the contract with a runnable proof command.`
            : `the proof command failed with exit ${proof.exitCode}.\n\n$ ${proof.command}\n${proof.output}`;
        return text(`Gate refused: ${detail}`);
      }
      const gateReceipt = {
        command: proof.command,
        exitCode: 0 as const,
        output: proof.output,
        verifiedAt: new Date().toISOString(),
      };
      const next = writeSessionState(ctx, { ...state, phase: "gated", gateReceipt });
      recordSessionAudit(ctx, { event: "gate-reached", command: proof.command, contract: state.contract, gateReceipt });
      return text(
        `Gate verified by running the contract's proof.\n\n$ ${proof.command}\n${proof.output}\n\n${describeState(next)}\n\nDelete the driver loop with loops_task action=delete, then report what is proven and what remains. The user leaves terraloop with /terraloop-off.`,
      );
    },
  });

  pi.registerCommand("terraloop", {
    description: "Arm the terraloop gate for this Pi session",
    handler: async (args, ctx) => {
      const state = readSessionState(ctx);
      if (state.phase !== "off") {
        ctx.ui.notify(`terraloop already ${state.phase} in this session. Use /terraloop-off to leave.`, "warning");
        return;
      }
      writeSessionState(ctx, { ...initialState(), lastCompletedLoop: state.lastCompletedLoop, phase: "armed" });
      recordSessionAudit(ctx, { event: "arm", via: "slash-command", northStar: args.trim() || null });
      ctx.ui.notify("terraloop armed for this session — other Pi sessions are unaffected", "info");
      pi.sendUserMessage(onRamp(args.trim(), "the user, by slash command"));
    },
  });

  pi.registerCommand("terraloop-status", {
    description: "Show the current session's terraloop phase, contract, and override state",
    handler: async (_args, ctx) => {
      ctx.ui.notify(describeState(readSessionState(ctx)), "info");
    },
  });

  pi.registerCommand("terraloop-off", {
    description: "Leave terraloop mode in this Pi session and clear its gate",
    handler: async (_args, ctx) => {
      const previous = readSessionState(ctx);
      const released = writeSessionState(ctx, releaseState(previous));
      recordSessionAudit(ctx, {
        event: "release",
        via: "slash-command",
        previousPhase: previous.phase,
        lastCompletedLoop: released.lastCompletedLoop,
      });
      ctx.ui.notify(`terraloop off in this session (was ${previous.phase})`, "info");
    },
  });

  pi.on("before_agent_start", (event, ctx) => {
    const state = readSessionState(ctx);
    if (state.phase === "off") return undefined;
    const rules = [
      `TERRALOOP MODE ACTIVE IN THIS PI SESSION — phase ${state.phase}.`,
      describeState(state),
      "",
      "This is enforced by a tool-call gate, not by your judgment:",
      "- armed: terrarium spawns and inline mutation are blocked until a contract is locked.",
      "- driving: you are the default worker. In-scope edit/write/mutating-bash is allowed. Spawn a child only when a named lever applies.",
      "- gated: new spawns are blocked until the driver loop is deleted.",
      "Use terraloop_control action=override with a reason when an inline action is genuinely required.",
      "You cannot leave this mode or clear its state. Only the user can, with /terraloop-off.",
    ].join("\n");
    return { systemPrompt: `${event.systemPrompt}\n\n${rules}` };
  });

  pi.on("tool_result", (event, ctx) => {
    const state = readSessionState(ctx);
    if (state.phase === "off") return undefined;
    const intent = classifyTool(event.toolName, event.input);
    if (intent !== "driver-create" && intent !== "spawn") return undefined;

    const serialized = JSON.stringify(event.details ?? "") + JSON.stringify(event.content ?? "");
    if (intent === "driver-create" && state.driverLoopId === null) {
      const loopId = serialized.match(/\b(?:loop|task)[-_ ]?id["':\s]+([A-Za-z0-9_-]{4,})/i)?.[1] ?? serialized.match(/\bid["':\s]+([A-Za-z0-9_-]{6,})/)?.[1] ?? null;
      if (loopId) {
        writeSessionState(ctx, { ...state, driverLoopId: loopId });
        recordSessionAudit(ctx, { event: "driver-id-captured", driverLoopId: loopId });
      }
      return undefined;
    }
    if (intent === "spawn") {
      const runIds = [...serialized.matchAll(/\b(ter_[A-Za-z0-9_]+)\b/g)].map((match) => match[1] as string);
      const merged = [...new Set([...state.spawnedRunIds, ...runIds])];
      if (merged.length !== state.spawnedRunIds.length) {
        writeSessionState(ctx, { ...state, spawnedRunIds: merged });
        recordSessionAudit(ctx, { event: "child-ids-captured", count: merged.length });
      }
    }
    return undefined;
  });

  pi.on("tool_call", (event, ctx) => {
    const state = readSessionState(ctx);
    if (state.phase === "off") return undefined;

    const intent = classifyTool(event.toolName, event.input);
    if (intent === "read" || intent === "terraloop-control") return undefined;

    if (intent === "mutate" && state.contract && state.phase === "driving") {
      const path = (event.input as { path?: unknown } | null)?.path;
      if (typeof path === "string" && pathIsInScope(path, state.contract.scope) === false) {
        recordSessionAudit(ctx, { event: "blocked", toolName: event.toolName, intent, phase: state.phase, detail: "path outside locked scope" });
        return { block: true, reason: `terraloop scope violation: ${path} is outside the locked scope (${state.contract.scope.join(", ")}).` };
      }
    }

    if (intent === "spawn" && state.contract && (state.phase === "driving" || state.phase === "gated")) {
      const cwd = outOfScopeSpawnPath(event.input, state.contract.scope);
      if (cwd) {
        recordSessionAudit(ctx, { event: "blocked", toolName: event.toolName, intent, phase: state.phase, detail: "spawn cwd outside locked scope" });
        return {
          block: true,
          reason: `terraloop scope violation: spawn cwd ${cwd} is outside the locked scope (${state.contract.scope.join(", ")}). A child cannot be granted a wider write surface than the parent.`,
        };
      }
    }

    if (intent === "mutate" && state.override) {
      const next = consumeOverride(state);
      writeSessionState(ctx, next);
      recordSessionAudit(ctx, { event: "override-consumed", toolName: event.toolName, reason: state.override.reason, remainingCalls: next.override?.remainingCalls ?? 0 });
      return undefined;
    }

    const decision = evaluate(state, intent);
    if (decision.allowed) {
      if (intent === "spawn") {
        writeSessionState(ctx, { ...state, delegatedSpawns: state.delegatedSpawns + 1 });
        recordSessionAudit(ctx, { event: "spawn-allowed", phase: state.phase });
      }
      if (intent === "driver-create") {
        writeSessionState(ctx, { ...state, phase: "driving" });
        recordSessionAudit(ctx, { event: "driver-created", phase: "driving" });
      }
      return undefined;
    }

    recordSessionAudit(ctx, { event: "blocked", toolName: event.toolName, intent, phase: state.phase, reason: decision.reason });
    return { block: true, reason: decision.reason };
  });
}

export type { LoopState };
