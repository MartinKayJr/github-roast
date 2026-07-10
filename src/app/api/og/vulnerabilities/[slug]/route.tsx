import { ImageResponse } from "next/og";
import { CDN_CACHE, fonts } from "../../../card/shared";
import { getVulnerability } from "@/lib/vulnerabilities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const post = await getVulnerability(slug, "en");
  if (!post) return new Response("not found", { status: 404 });

  const date = new Date(post.date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0a0a0b",
          padding: "72px 80px",
          fontFamily: "Inter",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                background: "#ef4444",
              }}
            />
            <div style={{ fontSize: 28, fontWeight: 800, color: "#fafafa" }}>ghsphere</div>
            <div style={{ fontSize: 26, color: "#a1a1aa" }}>Vulnerabilities</div>
          </div>
          <div
            style={{
              marginTop: 52,
              fontSize: post.title.length > 70 ? 54 : 62,
              fontWeight: 800,
              lineHeight: 1.15,
              color: "#fafafa",
            }}
          >
            {post.title}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: "1px solid #27272a",
            paddingTop: 28,
          }}
        >
          <div style={{ fontSize: 26, color: "#a1a1aa" }}>{date}</div>
          <div style={{ fontSize: 26, color: "#ef4444" }}>ghsphere.com/vulnerabilities</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: await fonts(),
      headers: { "Cache-Control": CDN_CACHE },
    },
  );
}
