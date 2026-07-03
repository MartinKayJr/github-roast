import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";
export const revalidate = 86400;

/**
 * Protected-resource metadata (RFC 9728) at /.well-known/oauth-protected-resource.
 * ghfind's read surface is public; the only credential is a static machine Bearer
 * key. We deliberately do NOT list an `authorization_servers` array — there is no
 * OAuth authorization server, and advertising one that 404s under probing would
 * be dishonest. We publish the honest minimum: the resource, the accepted bearer
 * method, and a pointer to the prose auth doc.
 */
export function GET() {
  return Response.json(
    {
      resource: SITE_URL,
      bearer_methods_supported: ["header"],
      resource_documentation: `${SITE_URL}/auth.md`,
      resource_name: "ghfind API",
    },
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=86400" } },
  );
}
