import { SITE_URL } from "@/lib/site";
import {
  PRODUCT_DESCRIPTION,
  USE_CASES,
  WHEN_TO_USE,
  urlGrammarMd,
  apiSummaryMd,
  mcpSummaryMd,
  toolingMd,
  NAMED_STATS,
  AGENT_LINK_HEADER,
} from "@/lib/agent-docs";

export const dynamic = "force-static";
export const revalidate = 86400;

/**
 * /index.md — the markdown twin of the homepage. Served to agents that arrive
 * from web search and either request `Accept: text/markdown` or `?mode=agent`
 * (the proxy rewrites the homepage here), and reachable directly. Leads with a
 * top-level heading and real prose — the acceptmarkdown.com / cold-discovery
 * contract. Content shared with /llms.txt via src/lib/agent-docs.ts.
 */
export function buildIndexMd(): string {
  return `# ghsphere

${PRODUCT_DESCRIPTION}

In a public dataset of ${NAMED_STATS.accountsScored} scored accounts (${NAMED_STATS.fullSnapshots} with full raw-metric
snapshots), faked or farmed contribution was ${NAMED_STATS.flaggedShare} of accounts — rare, but
extreme when it happens. Every number is reproducible from public GitHub data.

## Quickstart

\`\`\`bash
# Deterministic score for any GitHub login (no auth, no LLM):
curl -s ${SITE_URL}/api/score/torvalds

# Full evidence payload (metrics, repos, PRs, red flags):
curl -s -X POST ${SITE_URL}/api/scan \\
  -H 'Content-Type: application/json' \\
  -d '{"username":"torvalds"}'
\`\`\`

## Use cases

${USE_CASES.map((u) => `- ${u}`).join("\n")}

## When to use ghsphere

${WHEN_TO_USE.map((w) => `- ${w}`).join("\n")}

${urlGrammarMd()}

${apiSummaryMd()}

${mcpSummaryMd()}

${toolingMd()}

## More

- llms.txt index: [${SITE_URL}/llms.txt](${SITE_URL}/llms.txt)
- Authentication: [${SITE_URL}/auth.md](${SITE_URL}/auth.md)
- Methodology: [${SITE_URL}/methodology](${SITE_URL}/methodology)
- About / Contact / Privacy: [${SITE_URL}/about](${SITE_URL}/about) · [${SITE_URL}/contact](${SITE_URL}/contact) · [${SITE_URL}/privacy](${SITE_URL}/privacy)
`;
}

export function GET() {
  return new Response(buildIndexMd(), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=86400",
      Vary: "Accept",
      Link: AGENT_LINK_HEADER,
    },
  });
}
