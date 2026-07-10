import { getPost } from "@/lib/blog";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * Raw-markdown twin of a blog post, exposed as /blog/{slug}.md via the rewrite in
 * next.config. Leads with the title as an H1 so it reads as markdown (not HTML),
 * then the post body. English source of truth — the citable, extractable version
 * of each research post for LLMs.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const post = await getPost(slug, "en");
  if (!post) return new Response("# Not found\n", { status: 404 });

  const meta = [
    `# ${post.title}`,
    "",
    `> ${post.description}`,
    "",
    `Published ${post.date}${post.updated ? ` · updated ${post.updated}` : ""} · [${SITE_URL}/blog/${slug}](${SITE_URL}/blog/${slug})`,
    "",
    "---",
    "",
  ].join("\n");

  return new Response(meta + post.body + "\n", {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=300",
      Vary: "Accept",
    },
  });
}
