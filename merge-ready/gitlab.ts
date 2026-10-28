import type { Change } from "./change.ts";

export type GitlabMergeRequest = {
  state: string;
  draft: boolean;
  has_conflicts: boolean;
  detailed_merge_status: string;
  merge_when_pipeline_succeeds: boolean;
  head_pipeline: { status: string } | null;
  blocking_discussions_resolved: boolean;
  diverged_commits_count: number | null;
};

const greenPipelines = new Set(["success", "skipped"]);
const failedPipelines = new Set(["failed", "canceled"]);

function gitlabChecks(pipeline: GitlabMergeRequest["head_pipeline"]): Change["checks"] {
  if (!pipeline) return "none";
  if (greenPipelines.has(pipeline.status)) return "green";
  if (failedPipelines.has(pipeline.status)) return "failed";
  return "pending";
}

function gitlabState(request: GitlabMergeRequest): Change["state"] {
  if (request.state === "merged") return "merged";
  if (request.state === "closed" || request.state === "locked") return "closed";
  return request.draft ? "draft" : "open";
}

export function fromGitlab(request: GitlabMergeRequest): Change {
  return {
    provider: "gitlab",
    state: gitlabState(request),
    checks: gitlabChecks(request.head_pipeline),
    unresolvedThreads: request.blocking_discussions_resolved === false ? 1 : 0,
    mergeable: !request.has_conflicts && request.detailed_merge_status !== "conflict",
    behind: (request.diverged_commits_count ?? 0) > 0 || request.detailed_merge_status === "need_rebase",
    autoMerge: request.merge_when_pipeline_succeeds === true,
  };
}

export type GitlabTarget = { host: string; project: string; iid: number };

export function gitlabFetchCommand(target: GitlabTarget): string[] {
  return ["glab", "api", "--hostname", target.host, `projects/${encodeURIComponent(target.project)}/merge_requests/${target.iid}?include_diverged_commits_count=true`];
}
