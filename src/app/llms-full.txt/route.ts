import { buildLlmsTxt } from "@/app/llms.txt/route";
import { buildIndexMd } from "@/app/index.md/route";
import { buildAuthMd } from "@/app/auth.md/route";

export const dynamic = "force-static";
export const revalidate = 86400;

/**
 * /llms-full.txt — the whole machine-facing manual in one file: the llms.txt
 * index, the agent homepage, and the auth walkthrough concatenated. Linked from
 * llms.txt so an agent can fetch everything in a single request.
 */
export function GET() {
  const body = [buildLlmsTxt(), buildIndexMd(), buildAuthMd()].join(
    "\n\n---\n\n",
  );
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=86400",
    },
  });
}
