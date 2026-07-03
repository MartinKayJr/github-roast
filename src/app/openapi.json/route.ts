import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";
export const revalidate = 86400;

/**
 * /openapi.json — machine-readable contract for ghfind's public API, so agents,
 * SDK generators, and API directories can discover and call the endpoints.
 *
 * Documents only the public, stable surface. Auth/admin/OAuth internal routes are
 * intentionally omitted. Kept hand-authored (not generated) because the Next.js
 * App Router has no built-in OpenAPI emit; the two official SDKs (`ghfind` on npm
 * and PyPI) wrap exactly these endpoints.
 */
export function GET() {
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "ghfind API",
      version: "1.0.0",
      description:
        "Score any GitHub account 0-100 for value and trustworthiness with a deterministic engine, " +
        "plus roasts, head-to-head battles, leaderboards, and developer discovery. " +
        "Official SDKs: `ghfind` on npm and PyPI.",
      contact: { url: SITE_URL },
      license: { name: "AGPL-3.0-or-later" },
    },
    servers: [{ url: SITE_URL }],
    externalDocs: { description: "llms.txt", url: `${SITE_URL}/llms.txt` },
    tags: [
      { name: "scoring", description: "Deterministic 0-100 scoring (no LLM)" },
      { name: "roast", description: "LLM-written roast report (bring-your-own key supported)" },
      { name: "battle", description: "Head-to-head PK; deterministic winner, optional LLM commentary" },
      { name: "discovery", description: "Leaderboards, developer directory, search, stats" },
      { name: "images", description: "SVG badge and OG card images" },
    ],
    paths: {
      "/api/score/{username}": {
        get: {
          tags: ["scoring"],
          operationId: "getScore",
          summary: "Get the deterministic score for a GitHub account",
          description:
            "Read-only, no auth, cacheable, never calls an LLM. Returns the deterministic score, " +
            "tier, sub-scores, and percentile. If the account is already indexed you get the stored " +
            "payload (with tags/roast_line); otherwise it is scored live on demand by crawling GitHub " +
            "and running the pure scoring engine (`source: \"live\"`, includes red_flags, no LLM copy). " +
            "The only 404 is a GitHub login that does not exist. Rate limited per IP.",
          parameters: [
            {
              name: "username",
              in: "path",
              required: true,
              description: "GitHub login (case-insensitive)",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Score payload (indexed or live-scored)",
              content: { "application/json": { schema: { $ref: "#/components/schemas/ScorePayload" } } },
            },
            "400": { description: "Invalid username" },
            "404": { description: "GitHub account does not exist" },
            "429": { description: "Rate limited (live scoring path)" },
            "503": { description: "GitHub temporarily unavailable" },
          },
        },
      },
      "/api/scan": {
        post: {
          tags: ["scoring"],
          operationId: "scan",
          summary: "Crawl GitHub and compute the full deterministic scan + score",
          description:
            "Authoritative factual payload: metrics, repo/PR signals, sub_scores, red_flags, and " +
            "final_score. Deterministic — no LLM. In production, machine callers send " +
            "`Authorization: Bearer <api-key>`; browser callers pass a Cloudflare Turnstile token.",
          security: [{ bearerAuth: [] }, {}],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["username"],
                  properties: {
                    username: { type: "string", description: "GitHub login" },
                    turnstileToken: { type: "string", description: "Cloudflare Turnstile token (browser callers)" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Full scan result",
              content: { "application/json": { schema: { $ref: "#/components/schemas/ScanResult" } } },
            },
            "400": { description: "Invalid body or username" },
            "403": { description: "Turnstile verification failed" },
            "404": { description: "GitHub account not found" },
            "429": { description: "Rate limited" },
            "503": { description: "GitHub temporarily unavailable" },
          },
        },
      },
      "/api/roast": {
        post: {
          tags: ["roast"],
          operationId: "roast",
          summary: "Generate the human-facing roast report + AI-adjusted score (streaming)",
          description:
            "Takes a scan (or a username to reuse a cached scan) and streams a markdown roast report " +
            "plus meta (final_score, tier, delta, percentile, tags, roast_line). The only LLM endpoint " +
            "for scoring: the model may adjust the deterministic score by a bounded ±10. Pass `byoKey` " +
            "to use your own OpenAI-compatible provider instead of the server model. Response is a " +
            "text/plain stream using an in-band frame protocol (0x1f prefix: T=progress, M=base64 meta, " +
            "E=error); meta is also returned in the `X-Roast-Meta` header (base64 JSON).",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    scan: { $ref: "#/components/schemas/ScanResult" },
                    username: { type: "string", description: "Use a server-cached scan instead of passing `scan`" },
                    lang: { type: "string", enum: ["zh", "en"] },
                    byoKey: {
                      type: "object",
                      description: "Bring-your-own OpenAI-compatible LLM provider",
                      properties: {
                        baseURL: { type: "string" },
                        apiKey: { type: "string" },
                        model: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Streamed roast report", content: { "text/plain": { schema: { type: "string" } } } },
            "400": { description: "Missing scan / no LLM configured" },
            "429": { description: "Rate limited" },
          },
        },
      },
      "/api/vs-verdict": {
        post: {
          tags: ["battle"],
          operationId: "vsVerdict",
          summary: "Head-to-head verdict for two scored accounts",
          description:
            "Both accounts must already be scored. The winner and gap bucket are deterministic; a " +
            "bilingual savage verdict + self-improvement advice are added by the LLM only when both " +
            "sides clear the floor and the pairing is not cached.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["a", "b"],
                  properties: { a: { type: "string" }, b: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "200": { description: "Verdict (verdict may be null when below the LLM floor or cached)" },
            "400": { description: "Invalid pair" },
            "404": { description: "One or both accounts not scored" },
          },
        },
      },
      "/api/leaderboard": {
        get: {
          tags: ["discovery"],
          operationId: "leaderboard",
          summary: "Ranked public profiles (Hall of Fame / trending / heat / progress)",
          parameters: [
            { name: "view", in: "query", schema: { type: "string", enum: ["trending", "score", "heat", "progress"] } },
            { name: "window", in: "query", schema: { type: "string", enum: ["all", "24h", "7d", "30d"] } },
          ],
          responses: { "200": { description: "Ranked entries" } },
        },
      },
      "/api/developers": {
        get: {
          tags: ["discovery"],
          operationId: "developers",
          summary: "Discover developers by language, organization, or contributed repo",
          parameters: [
            { name: "type", in: "query", required: true, schema: { type: "string", enum: ["language", "org", "repo"] } },
            { name: "value", in: "query", schema: { type: "string" }, description: "Facet value; omit to list categories" },
          ],
          responses: { "200": { description: "Facet categories or entries" }, "400": { description: "Invalid type" } },
        },
      },
      "/api/search-users": {
        get: {
          tags: ["discovery"],
          operationId: "searchUsers",
          summary: "Prefix autocomplete over scored accounts",
          parameters: [{ name: "q", in: "query", schema: { type: "string" } }],
          responses: { "200": { description: "Up to 6 matching users" } },
        },
      },
      "/api/stats": {
        get: {
          tags: ["discovery"],
          operationId: "stats",
          summary: "Platform totals (number of scored accounts)",
          responses: { "200": { description: "Aggregate counts" } },
        },
      },
      "/api/badge/{username}": {
        get: {
          tags: ["images"],
          operationId: "badge",
          summary: "SVG score badge for a README",
          parameters: [
            { name: "username", in: "path", required: true, schema: { type: "string" } },
            { name: "lang", in: "query", schema: { type: "string", enum: ["zh", "en"] } },
          ],
          responses: { "200": { description: "SVG image", content: { "image/svg+xml": {} } } },
        },
      },
      "/api/card/{username}": {
        get: {
          tags: ["images"],
          operationId: "card",
          summary: "1200x630 OG PNG card for an account",
          parameters: [{ name: "username", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "PNG image", content: { "image/png": {} } } },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "Machine API key (GITHUB_ROAST_CLI_API_KEY)" },
      },
      schemas: {
        ScorePayload: {
          type: "object",
          properties: {
            source: { type: "string", enum: ["indexed", "live"], description: "indexed = stored; live = just crawled + scored deterministically" },
            cached: { type: "boolean", description: "live path only: served from the scan cache" },
            red_flags: {
              type: "array",
              description: "live path only: deterministic penalties",
              items: {
                type: "object",
                properties: { flag: { type: "string" }, penalty: { type: "number" }, detail: { type: "string" } },
              },
            },
            username: { type: "string" },
            display_name: { type: "string", nullable: true },
            avatar_url: { type: "string", nullable: true },
            profile_url: { type: "string" },
            final_score: { type: "number", description: "0-100, 2 decimals" },
            tier: { type: "string", enum: ["夯", "顶级", "人上人", "NPC", "拉完了"] },
            tier_key: { type: "string", enum: ["god", "elite", "solid", "npc", "trash"] },
            sub_scores: { $ref: "#/components/schemas/SubScores" },
            tags: { type: "object", properties: { zh: { type: "array", items: { type: "string" } }, en: { type: "array", items: { type: "string" } } } },
            roast_line: { type: "object", properties: { zh: { type: "string" }, en: { type: "string" } } },
            percentile: {
              type: "object",
              nullable: true,
              properties: {
                beat: { type: "number", nullable: true, description: "Percent of ranked accounts beaten" },
                total: { type: "integer" },
                rank: { type: "integer", nullable: true },
              },
            },
            scanned_at: { type: "integer", description: "Epoch ms of last score" },
            profile: { type: "string", description: "Human profile URL on ghfind.com" },
          },
        },
        SubScores: {
          type: "object",
          properties: {
            account_maturity: { type: "number" },
            original_project_quality: { type: "number" },
            contribution_quality: { type: "number" },
            ecosystem_impact: { type: "number" },
            community_influence: { type: "number" },
            activity_authenticity: { type: "number" },
          },
        },
        Scoring: {
          type: "object",
          properties: {
            sub_scores: { $ref: "#/components/schemas/SubScores" },
            base_score: { type: "number" },
            red_flags: {
              type: "array",
              items: {
                type: "object",
                properties: { flag: { type: "string" }, penalty: { type: "number" }, detail: { type: "string" } },
              },
            },
            total_penalty: { type: "number" },
            final_score: { type: "number" },
            tier: { type: "string" },
            tier_label: { type: "string" },
          },
        },
        ScanResult: {
          type: "object",
          description: "Full scan payload — identical shape to the open-source github-account-value skill output.",
          properties: {
            metrics: { type: "object", description: "Raw GitHub-derived metrics (snake_case)" },
            top_repos: { type: "array", items: { type: "object" } },
            recent_prs: { type: "array", items: { type: "object" } },
            flood_pr_titles: { type: "array", items: { type: "string" } },
            impact_repos: { type: "array", items: { type: "object" } },
            scoring: { $ref: "#/components/schemas/Scoring" },
          },
        },
      },
    },
  };

  return new Response(JSON.stringify(spec), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=86400",
    },
  });
}
