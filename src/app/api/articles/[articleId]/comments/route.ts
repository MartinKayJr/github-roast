import { NextRequest, NextResponse } from "next/server";
import { auth, authConfigured } from "@/lib/auth";
import {
  createArticleComment,
  getArticleComments,
  getPublishedArticleById,
} from "@/lib/db";
import { normalizeArticleCommentText } from "@/lib/articles";
import { normalizeGitHubUsername } from "@/lib/comments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function jsonNoStore(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...NO_STORE_HEADERS, ...init?.headers },
  });
}

function articleIdFrom(value: string): string | null {
  try {
    const id = decodeURIComponent(value ?? "").trim();
    return /^[0-9a-f-]{16,64}$/i.test(id) ? id : null;
  } catch {
    return null;
  }
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ articleId: string }> },
) {
  const { articleId: rawArticleId } = await ctx.params;
  const articleId = articleIdFrom(rawArticleId);
  if (!articleId) return jsonNoStore({ error: "invalid_article" }, { status: 400 });

  const article = await getPublishedArticleById(articleId);
  if (!article) return jsonNoStore({ error: "not_found" }, { status: 404 });
  const comments = await getArticleComments(articleId);
  return jsonNoStore({ comments });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ articleId: string }> },
) {
  const { articleId: rawArticleId } = await ctx.params;
  const articleId = articleIdFrom(rawArticleId);
  if (!articleId) return jsonNoStore({ error: "invalid_article" }, { status: 400 });

  let payload: { body?: unknown };
  try {
    payload = await req.json();
  } catch {
    return jsonNoStore({ error: "invalid_body" }, { status: 400 });
  }

  const body = normalizeArticleCommentText(payload.body);
  if (!body) return jsonNoStore({ error: "invalid_comment" }, { status: 400 });

  const session = authConfigured() ? await auth() : null;
  const authorLogin = normalizeGitHubUsername(session?.user.login ?? "");
  const authorGithubId = session?.user.githubId;
  if (
    !authorLogin ||
    typeof authorGithubId !== "number" ||
    !Number.isSafeInteger(authorGithubId) ||
    authorGithubId <= 0
  ) {
    return jsonNoStore({ error: "authentication_required" }, { status: 401 });
  }

  const comment = await createArticleComment({
    articleId,
    authorGithubId,
    authorLogin,
    authorAvatarUrl: session?.user.image ?? null,
    body,
  });
  if (!comment) {
    const article = await getPublishedArticleById(articleId);
    return jsonNoStore(
      { error: article ? "comments_unavailable" : "not_found" },
      { status: article ? 503 : 404 },
    );
  }

  return jsonNoStore({ comment }, { status: 201 });
}
