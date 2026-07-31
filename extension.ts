import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { classifyTool, consumeOverride, evaluate, pathIsInScope, requestOverride } from "./gate.ts";
import {
  contractIsComplete,
  describeState,
  initialState,
  overrideBudget,
  readState,
  recordAudit,
  statePathForSession,
  writeState,
  type LoopState,
} from "./state.ts";
import { verifyProof } from "./proof.ts";

const controlParameters = Type.Object({
  action: StringEnum(["lock", "override", "status", "gate"] as const),
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

export default function terraloopMode(pi: ExtensionAPI) {
  pi.registerTool({
    name: "terraloop_control",
    label: "Terraloop",
    description:
      "Operate inside an armed terraloop. lock = record goal/gate/scope/proof after the user approves the contract. gate = mark the stop gate reached. override = permit a bounded number of inline mutations with a recorded reason. status = show current phase. Only the user can arm or release terraloop, via /terraloop and /terraloop-off.",
    promptSnippet: "Lock the contract, mark the gate, or request an override inside an armed terraloop",
    promptGuidelines: [
      "Call terraloop_control action=lock with goal, gate, scope, and proof after the user approves the contract, before spawning any terrarium child.",
      "Call terraloop_control action=override with a reason when terraloop blocks an inline action that is genuinely required.",
      "Do not attempt to arm or release terraloop; only the user can, with /terraloop and /terraloop-off.",
    ],
    parameters: controlParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const state = readSessionState(ctx);
      if (params.action === "status") return text(describeState(state));

      if (state.phase === "off") {
        return text("terraloop is off. Only the user can arm it, with /terraloop. Do not attempt to arm it yourself.");
      }

      if (params.action === "lock") {
        const contract = { goal: params.goal ?? "", gate: params.gate ?? "", scope: params.scope ?? [], proof: params.proof ?? "" };
        if (!contractIsComplete(contract)) {
          return text("lock rejected: goal, gate, scope, and proof are all required and must be non-empty.");
        }
        const next = writeSessionState(ctx, { ...state, contract });
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
      const next = writeSessionState(ctx, { ...state, phase: "gated" });
      recordSessionAudit(ctx, { event: "gate-reached", command: proof.command, contract: state.contract });
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
      writeSessionState(ctx, { ...initialState(), phase: "armed" });
      recordSessionAudit(ctx, { event: "arm", via: "slash-command", northStar: args || null });
      const northStar = args.trim();
      ctx.ui.notify("terraloop armed for this session — other Pi sessions are unaffected", "info");
      pi.sendUserMessage(
        [
          "Terraloop is now ARMED by explicit slash command for this Pi session.",
          northStar ? `North star: ${northStar}` : "No north star was supplied with the command.",
          "",
          "Follow the terraloop skill on-ramp:",
          "1. Read the terraloop protocol if it is not already loaded.",
          "2. Draft the contract: Goal (falsifiable), Gate (binary), Scope (absolute paths), Proof (exact command or receipt).",
          "3. Echo it back in about five lines and wait for a one-word go.",
          "4. After the go, call terraloop_control action=lock, then create the driver loop, then spawn children.",
          "",
          "The gate blocks terrarium spawns and inline edit/write/mutating-bash in this session until the contract is locked. Do not try to work around it; satisfy it.",
        ].join("\n"),
      );
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
      writeSessionState(ctx, initialState());
      recordSessionAudit(ctx, { event: "release", via: "slash-command", previousPhase: previous.phase });
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
      "- driving: you orchestrate and verify. Inline edit/write/mutating-bash is blocked. Spawn bounded children instead.",
      "- gated: new spawns are blocked until the driver loop is deleted.",
      "Use terraloop_control action=override with a reason when an inline action is genuinely required.",
      "You cannot arm or release this mode. Only the user can, with /terraloop and /terraloop-off.",
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
