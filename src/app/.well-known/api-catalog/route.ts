import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";
export const revalidate = 86400;

/**
 * API catalog (RFC 9727) at /.well-known/api-catalog. A linkset pointing agents
 * at the OpenAPI spec, the human/agent docs, and the auth walkthrough. Served
 * with the linkset+json content type + profile the spec prescribes.
 */
export function GET() {
  const linkset = {
    linkset: [
      {
        anchor: SITE_URL,
        "service-desc": [
          { href: `${SITE_URL}/openapi.json`, type: "application/openapi+json", title: "ghsphere OpenAPI 3.1 spec" },
        ],
        "service-doc": [
          { href: `${SITE_URL}/llms.txt`, type: "text/plain", title: "llms.txt agent index" },
          { href: `${SITE_URL}/index.md`, type: "text/markdown", title: "Agent homepage" },
          { href: `${SITE_URL}/auth.md`, type: "text/markdown", title: "Authentication" },
        ],
        "service-meta": [
          { href: `${SITE_URL}/.well-known/mcp/server-card.json`, type: "application/json", title: "MCP server card" },
          { href: `${SITE_URL}/.well-known/oauth-protected-resource`, type: "application/json", title: "Protected-resource metadata" },
        ],
      },
    ],
  };
  return new Response(JSON.stringify(linkset), {
    headers: {
      "Content-Type":
        'application/linkset+json;profile="https://www.rfc-editor.org/info/rfc9727"',
      "Cache-Control": "public, max-age=0, s-maxage=86400",
    },
  });
}
