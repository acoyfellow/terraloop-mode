import { expect, test } from "bun:test";
import { evaluateMerge, findMergeAction, parseMergeMode } from "../merge-guard.ts";
import { readiness, type Change } from "../merge-ready/change.ts";
import { fromGithub } from "../merge-ready/github.ts";
import { fromGitlab } from "../merge-ready/gitlab.ts";
import { parseChangeUrl } from "../merge-ready/url.ts";

test("a contract without a merge field is treated as merge: never", () => {
  expect(parseMergeMode(undefined)).toBe("never");
  expect(parseMergeMode("gate")).toBe("gate");
  expect(parseMergeMode("yolo")).toBe("never");
});

test("merges are found through wrappers, chains, and env prefixes", () => {
  expect(findMergeAction("gh pr merge 1")?.provider).toBe("github");
  expect(findMergeAction("glab mr merge 1")?.provider).toBe("gitlab");
  expect(findMergeAction("bun test && GH_TOKEN=x gh pr merge 1")).not.toBeNull();
  expect(findMergeAction("bash -c 'glab mr merge 1'")).not.toBeNull();
  expect(findMergeAction("git -C /r push origin HEAD:refs/heads/main")?.provider).toBe("git");
});

test("ordinary review and branch work is not a merge", () => {
  expect(findMergeAction("gh pr view 1")).toBeNull();
  expect(findMergeAction("glab mr note 1 -m 'merge later'")).toBeNull();
  expect(findMergeAction("git push --force-with-lease origin feature/main-menu")).toBeNull();
  expect(findMergeAction("git push -o merge_request.create origin feature")).toBeNull();
  expect(findMergeAction("gh api repos/o/r/pulls/1/merge")).toBeNull();
});

test("merge: gate opens only after the stop gate is verified", () => {
  const action = findMergeAction("gh pr merge 1");
  expect(evaluateMerge("driving", "gate", action).allowed).toBe(false);
  expect(evaluateMerge("gated", "gate", action).allowed).toBe(true);
  expect(evaluateMerge("gated", "never", action).allowed).toBe(false);
  expect(evaluateMerge("off", "never", action).allowed).toBe(true);
});

const ready: Change = { provider: "github", state: "open", checks: "green", unresolvedThreads: 0, mergeable: true, behind: false, autoMerge: false };

test("readiness names every unmet condition", () => {
  expect(readiness(ready)).toEqual({ ready: true, reasons: [] });
  const verdict = readiness({ ...ready, checks: "failed", unresolvedThreads: 2, autoMerge: true });
  expect(verdict.ready).toBe(false);
  expect(verdict.reasons).toHaveLength(3);
});

test("both adapters map onto the same Change shape", () => {
  const github = fromGithub({ state: "OPEN", isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", autoMergeRequest: null, statusCheckRollup: [], reviewThreads: [] });
  const gitlab = fromGitlab({ state: "opened", draft: false, has_conflicts: false, detailed_merge_status: "mergeable", merge_when_pipeline_succeeds: false, head_pipeline: null, blocking_discussions_resolved: true, diverged_commits_count: 0 });
  expect({ ...github, provider: "x" }).toEqual({ ...gitlab, provider: "x" });
});

test("urls pick the provider", () => {
  expect(parseChangeUrl("https://github.com/o/r/pull/3")?.provider).toBe("github");
  expect(parseChangeUrl("https://gitlab.example.com/a/b/c/-/merge_requests/9")).toEqual({ provider: "gitlab", host: "gitlab.example.com", project: "a/b/c", iid: 9 });
  expect(parseChangeUrl("https://example.com/x")).toBeNull();
});
