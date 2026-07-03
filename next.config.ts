import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // A stray lockfile in the home dir makes Next infer the wrong workspace root.
  // Pin it to this project.
  turbopack: {
    root: __dirname,
  },
  // NOTE: the agent RFC-8288 Link header is set on the markdown/doc route
  // responses (src/lib/agent-docs.ts AGENT_LINK_HEADER), not here — the homepage
  // HTTP Link header is owned by Next's hreflang metadata and can't be extended
  // via next.config headers(), which the locale rewrite also defeats.
  async rewrites() {
    return [
      // Markdown twin for blog posts: /blog/{slug}.md → the raw-markdown handler.
      { source: "/blog/:slug.md", destination: "/blog-md/:slug" },
      { source: "/en/blog/:slug.md", destination: "/blog-md/:slug" },
    ];
  },
};

export default withNextIntl(nextConfig);
