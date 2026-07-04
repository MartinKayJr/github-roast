import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";
export const revalidate = 86400;

/**
 * Agent Skills index (/.well-known/agent-skills/index.json). A flat catalog of
 * the capabilities ghsphere exposes, each with a name + description so an agent can
 * find and parse what the product offers. Points at the concrete surfaces (MCP
 * tools, REST endpoints) that back each skill.
 */
export function GET() {
  const skills = [
    {
      name: "score_user",
      description:
        "Deterministic 0-100 GitHub value & trust score, tier, and six-dimension breakdown for any account. No auth, no LLM.",
      invocation: { mcp: `${SITE_URL}/mcp`, rest: `${SITE_URL}/api/score/{username}` },
    },
    {
      name: "scan_user",
      description:
        "Full scan payload: raw GitHub metrics, top repos, recent PRs, red-flag signals.",
      invocation: { mcp: `${SITE_URL}/mcp`, rest: `${SITE_URL}/api/scan` },
    },
    {
      name: "compare_users",
      description: "Head-to-head deterministic comparison of two GitHub accounts.",
      invocation: { mcp: `${SITE_URL}/mcp`, rest: `${SITE_URL}/api/vs-verdict` },
    },
    {
      name: "get_leaderboard",
      description: "Ranked public developers by score, trend, heat, or progress.",
      invocation: { mcp: `${SITE_URL}/mcp`, rest: `${SITE_URL}/api/leaderboard` },
    },
    {
      name: "search_users",
      description: "Prefix search across already-scored GitHub accounts.",
      invocation: { mcp: `${SITE_URL}/mcp`, rest: `${SITE_URL}/api/search-users` },
    },
  ];
  return Response.json(
    {
      name: "ghsphere",
      description:
        "GitHub developer value & trust scoring and discovery. Agent skills for scoring, scanning, comparing, and finding developers.",
      url: SITE_URL,
      documentation: `${SITE_URL}/llms.txt`,
      skills,
    },
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=86400" } },
  );
}
