const credentialPatterns = [
  "/\\.ssh/id_[^/]*$",
  "/\\.ssh/.*_key$",
  "/\\.aws/credentials$",
  "/\\.wrangler/config/",
  "/Library/Preferences/cloudflare/config/",
  "/\\.config/gh/hosts\\.yml$",
  "/\\.config/glab-cli/",
  "/\\.netrc$",
  "/\\.npm" + "rc$",
  "/\\.docker/config\\.json$",
  "/\\.kube/config$",
  "/\\.env$",
  "/\\.env\\.(local|production|development)$",
  "/\\.dev\\.vars$",
  "\\.secret$",
].map((pattern) => new RegExp(pattern));

export function isCredentialPath(path: string): boolean {
  if (path.endsWith(".pub")) return false;
  return credentialPatterns.some((pattern) => pattern.test(path));
}
