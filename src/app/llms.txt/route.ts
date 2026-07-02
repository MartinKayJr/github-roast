import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";
export const revalidate = 86400;

/**
 * llms.txt — declares ghfind's URL grammar so LLM agents can construct links
 * directly (mirrors the homepage Omnibox syntax). Plain text, not locale-scoped.
 */
export function GET() {
  const body = `# ghfind — GitHub developer value & trust scoring

> ghfind scores any GitHub account 0-100 for value and trustworthiness, with a
> savage one-line roast. Deterministic engine (open-sourced as the
> github-account-value skill) plus a bounded LLM adjustment.

## URL grammar (agent- and human-friendly, same as the site's Omnibox)

- Roast a user:        ${SITE_URL}/u/{username}
- Compare two users:   ${SITE_URL}/vs/{a}/{b}        (dictionary-ordered; /vs/b/a redirects to /vs/a/b)
- Language leaderboard: ${SITE_URL}/developers/language/{Language}   (e.g. /developers/language/Rust)
- Org leaderboard:     ${SITE_URL}/developers/org/{org}              (e.g. /developers/org/huggingface)
- Project leaderboard: ${SITE_URL}/developers/repo/{owner}/{name}
- Hall of Fame:        ${SITE_URL}/leaderboard

## OG images (1200x630 PNG)

- User card:   ${SITE_URL}/api/card/{username}
- Versus card: ${SITE_URL}/api/card/vs/{a}/{b}

## Notes

- Usernames are GitHub logins (case-insensitive).
- Scores below 60 are reachable and shareable but not indexed.
`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=86400",
    },
  });
}
