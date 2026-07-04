import { SITE_URL } from "@/lib/site";
import { PRODUCT_ONELINER } from "@/lib/agent-docs";

export const dynamic = "force-static";
export const revalidate = 86400;

/**
 * A2A Agent Card (/.well-known/agent-card.json). Describes ghsphere's capabilities
 * and where to reach them. ghsphere is not a JSON-RPC A2A server, so we advertise
 * the real interfaces (MCP + REST + OpenAPI) rather than a fake A2A endpoint.
 */
export function GET() {
  const card = {
    protocolVersion: "0.3.0",
    name: "ghsphere",
    description: PRODUCT_ONELINER,
    url: SITE_URL,
    version: "1.0.0",
    provider: {
      organization: "ghsphere",
      url: SITE_URL,
    },
    documentationUrl: `${SITE_URL}/llms.txt`,
    preferredTransport: "MCP",
    // Where an agent can actually act. Honest: MCP (streamable HTTP) + REST.
    additionalInterfaces: [
      { transport: "MCP", url: `${SITE_URL}/mcp` },
      { transport: "REST", url: `${SITE_URL}/openapi.json` },
    ],
    capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["application/json", "text/markdown"],
    skills: [
      {
        id: "score_user",
        name: "Score a GitHub account",
        description:
          "Return a deterministic 0-100 value & trust score, tier, and six-dimension breakdown for any GitHub login. No LLM, no auth.",
        tags: ["github", "scoring", "trust", "developer"],
        examples: ["Score github user torvalds", "How trustworthy is the account gaearon?"],
      },
      {
        id: "scan_user",
        name: "Full scan payload",
        description:
          "Crawl a GitHub account and return raw metrics, top repos, recent PRs, and red-flag signals used by the score.",
        tags: ["github", "metrics", "anti-abuse"],
        examples: ["Get the full scan evidence for user sindresorhus"],
      },
      {
        id: "compare_users",
        name: "Compare two developers",
        description: "Head-to-head deterministic comparison of two GitHub accounts with winner and gap.",
        tags: ["github", "comparison"],
        examples: ["Compare torvalds vs gaearon on GitHub"],
      },
      {
        id: "get_leaderboard",
        name: "Developer leaderboard",
        description: "Ranked public developers by score, trend, heat, or progress.",
        tags: ["discovery", "leaderboard"],
        examples: ["Top-scoring GitHub developers this week"],
      },
      {
        id: "search_users",
        name: "Search scored developers",
        description: "Prefix search across already-scored GitHub accounts.",
        tags: ["discovery", "search"],
        examples: ["Find scored users starting with 'tor'"],
      },
    ],
  };
  return Response.json(card, {
    headers: { "Cache-Control": "public, max-age=0, s-maxage=86400" },
  });
}
