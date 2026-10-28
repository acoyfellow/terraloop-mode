import type { GithubTarget } from "./github.ts";
import type { GitlabTarget } from "./gitlab.ts";

export type ChangeTarget = ({ provider: "github" } & GithubTarget) | ({ provider: "gitlab" } & GitlabTarget);

export function parseChangeUrl(input: string): ChangeTarget | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const github = url.hostname === "github.com" ? url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/) : null;
  if (github) return { provider: "github", owner: github[1] as string, repo: github[2] as string, number: Number(github[3]) };
  const gitlab = url.pathname.match(/^\/(.+?)\/-\/merge_requests\/(\d+)\/?$/);
  if (gitlab) return { provider: "gitlab", host: url.host, project: gitlab[1] as string, iid: Number(gitlab[2]) };
  return null;
}

export function describeTarget(target: ChangeTarget): string {
  return target.provider === "github" ? `GitHub PR #${target.number}` : `GitLab MR !${target.iid}`;
}
