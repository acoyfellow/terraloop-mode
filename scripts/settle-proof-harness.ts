import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { initialState, statePathForSession, writeState } from "../state.ts";

const proofOut = process.env.TERRALOOP_PROOF_OUT;
if (!proofOut) throw new Error("TERRALOOP_PROOF_OUT is required for the settle proof harness");

export const proofDriverLoopId = "settle-proof";
export const proofDriverPrompt = "Reply with exactly the text TERRALOOP_TICK_OK and do not call any tools.";

function record(entry: Record<string, unknown>) {
  appendFileSync(proofOut as string, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

export default function settleProofHarness(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    writeState(
      {
        ...initialState(),
        phase: "driving",
        contract: { goal: "settle proof", gate: "tick delivered once", scope: [process.cwd()], proof: "bun test" },
        driverLoopId: proofDriverLoopId,
        driverPrompt: proofDriverPrompt,
      },
      statePathForSession(sessionId),
    );
    record({ event: "seeded", sessionId });
  });

  pi.on("agent_start", (_event, ctx) => {
    record({ event: "agent_start", sessionId: ctx.sessionManager.getSessionId() });
  });

  pi.on("agent_settled", (_event, ctx) => {
    record({ event: "agent_settled", sessionId: ctx.sessionManager.getSessionId(), idle: ctx.isIdle() });
  });

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const content = event.message.content;
    const text = Array.isArray(content)
      ? content.map((part) => (part.type === "text" ? part.text : "")).join("")
      : String(content ?? "");
    record({ event: "assistant_message", sessionId: ctx.sessionManager.getSessionId(), text });
  });
}
