import { buildLlmsTxt } from "@/app/llms.txt/route";

export const dynamic = "force-static";
export const revalidate = 86400;

/** /llms.md — the llms.txt index served with a markdown content-type, for agents
 *  that negotiate markdown by URL suffix. Same body as /llms.txt. */
export function GET() {
  return new Response(buildLlmsTxt(), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=86400",
      Vary: "Accept",
    },
  });
}
