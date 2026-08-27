export type TurnAction =
  | "continue_turn"
  | "handle_callback"
  | "recover_ids"
  | "cancel_once"
  | "parent_does_work"
  | "ignore_corpse"
  | "stop_or_ask"
  | "delete_driver"
  | "end_turn_idle";

export interface TurnSituation {
  inScopeWorkRemains: boolean;
  callbackPending: boolean;
  wouldWaitForHeartbeat: boolean;
  spawnTimedOut: boolean;
  hookFailStalledTwice: boolean;
  hookFailStalledOnce: boolean;
  cancelCorpse143: boolean;
  listStatusTimedOut: boolean;
  knownRunId: boolean;
  outOfScopeWrite: boolean;
  gateMet: boolean;
  childrenRunning: boolean;
  independentParentStep: boolean;
}

export function requiredTurnAction(s: TurnSituation): TurnAction {
  if (s.gateMet) return "delete_driver";
  if (s.outOfScopeWrite) return "stop_or_ask";
  if (s.cancelCorpse143 && !s.inScopeWorkRemains && !s.callbackPending) return "ignore_corpse";
  if (s.spawnTimedOut) return "recover_ids";
  if (s.listStatusTimedOut && s.knownRunId) return "handle_callback";
  if (s.hookFailStalledTwice) return "parent_does_work";
  if (s.hookFailStalledOnce) return "cancel_once";
  if (s.callbackPending) return "handle_callback";
  if (s.wouldWaitForHeartbeat && s.inScopeWorkRemains) return "continue_turn";
  if (s.childrenRunning && s.independentParentStep) return "continue_turn";
  if (s.inScopeWorkRemains) return "continue_turn";
  if (s.cancelCorpse143) return "ignore_corpse";
  return "end_turn_idle";
}

export function isDeadSpot(s: TurnSituation): boolean {
  return s.wouldWaitForHeartbeat && requiredTurnAction(s) !== "end_turn_idle";
}
