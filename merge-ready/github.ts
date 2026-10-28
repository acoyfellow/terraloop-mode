import type { Change } from "./change.ts";

type GithubCheck = { status?: string | null; conclusion?: string | null; state?: string | null };

export type GithubPullRequest = {
  state: string;
  isDraft: boolean;
  mergeable: string;
  mergeStateStatus: string;
  autoMergeRequest: unknown;
  statusCheckRollup: GithubCheck[];
  reviewThreads: { isResolved: boolean }[];
};

const failedConclusions = new Set(["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);

function githubChecks(rollup: GithubCheck[]): Change["checks"] {
  if (rollup.length === 0) return "none";
  if (rollup.some((check) => failedConclusions.has(check.conclusion ?? check.state ?? ""))) return "failed";
  if (rollup.some((check) => (check.status ?? "COMPLETED") !== "COMPLETED" || check.state === "PENDING")) return "pending";
  return "green";
}

function githubState(pull: GithubPullRequest): Change["state"] {
  if (pull.state === "MERGED") return "merged";
  if (pull.state === "CLOSED") return "closed";
  return pull.isDraft ? "draft" : "open";
}

export function fromGithub(pull: GithubPullRequest): Change {
  return {
    provider: "github",
    state: githubState(pull),
    checks: githubChecks(pull.statusCheckRollup ?? []),
    unresolvedThreads: (pull.reviewThreads ?? []).filter((thread) => !thread.isResolved).length,
    mergeable: pull.mergeable === "MERGEABLE" && pull.mergeStateStatus !== "DIRTY",
    behind: pull.mergeStateStatus === "BEHIND",
    autoMerge: pull.autoMergeRequest != null,
  };
}

export type GithubTarget = { owner: string; repo: string; number: number };

export function githubFetchCommands(target: GithubTarget): { view: string[]; threads: string[] } {
  const url = `https://github.com/${target.owner}/${target.repo}/pull/${target.number}`;
  const query = `query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved}}}}}`;
  return {
    view: ["gh", "pr", "view", url, "--json", "state,isDraft,mergeable,mergeStateStatus,autoMergeRequest,statusCheckRollup"],
    threads: ["gh", "api", "graphql", "-f", `query=${query}`, "-F", `o=${target.owner}`, "-F", `r=${target.repo}`, "-F", `n=${target.number}`, "--jq", ".data.repository.pullRequest.reviewThreads.nodes"],
  };
}
