import { contractIsComplete, type LoopState } from "./state.ts";

export const settleTickBudget = 100;

export type SettleObservation = {
  toolCallsThisRun: number;
  idle: boolean;
  pendingMessages: boolean;
};

export type SettleDecision =
  | { deliver: true; state: LoopState; tick: number }
  | { deliver: false; reason: string };

export function settleTickDecision(state: LoopState, observed: SettleObservation, budget = settleTickBudget): SettleDecision {
  if (state.phase !== "driving") return { deliver: false, reason: `phase is ${state.phase}` };
  if (!contractIsComplete(state.contract)) return { deliver: false, reason: "contract is incomplete" };
  if (state.driverLoopId === null) return { deliver: false, reason: "no driver loop is recorded" };
  if (!state.driverPrompt) return { deliver: false, reason: "no driver prompt was captured" };
  if (!observed.idle) return { deliver: false, reason: "agent is not idle" };
  if (observed.pendingMessages) return { deliver: false, reason: "a follow-up is already queued" };
  if (observed.toolCallsThisRun === 0) return { deliver: false, reason: "settled run made no tool calls; heartbeat owns the next tick" };
  if (state.settleTicks >= budget) return { deliver: false, reason: `settle tick budget exhausted (${state.settleTicks}/${budget})` };
  const tick = state.settleTicks + 1;
  return { deliver: true, tick, state: { ...state, settleTicks: tick } };
}

export function settleTickMessage(state: LoopState, tick: number): string {
  return [
    `[terraloop settle tick ${tick} · driver ${state.driverLoopId}]`,
    "",
    "The previous agent turn settled while terraloop is driving, so the next driver tick starts now instead of waiting for the heartbeat.",
    "",
    state.driverPrompt ?? "",
  ].join("\n");
}
