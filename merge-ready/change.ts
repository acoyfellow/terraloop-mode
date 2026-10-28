export type Provider = "github" | "gitlab";

export type Change = {
  provider: Provider;
  state: "open" | "draft" | "merged" | "closed";
  checks: "green" | "failed" | "pending" | "none";
  unresolvedThreads: number;
  mergeable: boolean;
  behind: boolean;
  autoMerge: boolean;
};

export type Readiness = { ready: boolean; reasons: string[] };

export function readiness(change: Change): Readiness {
  const reasons: string[] = [];
  if (change.state !== "open") reasons.push(`it is ${change.state}`);
  if (change.checks === "failed") reasons.push("a check failed");
  if (change.checks === "pending") reasons.push("checks are still running");
  if (change.unresolvedThreads > 0) reasons.push(`${change.unresolvedThreads} unresolved thread${change.unresolvedThreads === 1 ? "" : "s"}`);
  if (!change.mergeable) reasons.push("it conflicts with the target branch");
  if (change.behind) reasons.push("it is behind the target branch");
  if (change.autoMerge) reasons.push("auto-merge is on, so it could merge without the user");
  return { ready: reasons.length === 0, reasons };
}
