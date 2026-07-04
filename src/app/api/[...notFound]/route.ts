import { apiError } from "@/lib/api-error";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";

/**
 * Catch-all for unknown /api/* paths so agents probing the API get a structured
 * JSON 404 instead of the HTML not-found page. Route precedence keeps this safe:
 * every real route starts with a static segment under /api, and static/dynamic
 * segments always win over a catch-all.
 */
function notFound() {
  const res = apiError("not_found", {
    status: 404,
    message: "no such API endpoint",
    hint: `See ${SITE_URL}/openapi.json for the full endpoint list, ${SITE_URL}/auth.md for auth, ${SITE_URL}/mcp for the MCP server.`,
  });
  // Probe storms hit the CDN, not the function pool.
  res.headers.set(
    "Cache-Control",
    "public, s-maxage=3600, stale-while-revalidate=86400",
  );
  res.headers.set(
    "Link",
    `<${SITE_URL}/openapi.json>; rel="service-desc"; type="application/openapi+json"`,
  );
  return res;
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
