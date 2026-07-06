import {
  getGitHubTokenCandidates,
  markGitHubTokenFailure,
  markGitHubTokenSuccess,
} from "./db";

export interface GitHubAuthToken {
  id: string | null;
  label: string;
  token: string;
}

export async function getGitHubAuthTokens(limit = 5): Promise<GitHubAuthToken[]> {
  const dbTokens = await getGitHubTokenCandidates(limit);
  const tokens: GitHubAuthToken[] = dbTokens.map((item) => ({
    id: item.id,
    label: item.label,
    token: item.token,
  }));
  const envToken = process.env.GITHUB_TOKEN?.trim();
  if (envToken && !tokens.some((item) => item.token === envToken)) {
    tokens.push({ id: null, label: "GITHUB_TOKEN", token: envToken });
  }
  return tokens;
}

export function githubHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ghsphere",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function reportGitHubTokenSuccess(token: GitHubAuthToken | null): Promise<void> {
  if (token?.id) await markGitHubTokenSuccess(token.id);
}

export async function reportGitHubTokenFailure(
  token: GitHubAuthToken | null,
  error: string,
  cooldownMs?: number,
): Promise<void> {
  if (token?.id) {
    await markGitHubTokenFailure({ id: token.id, error, cooldownMs });
  }
}
