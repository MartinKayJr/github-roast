import { NextRequest, NextResponse } from "next/server";
import { getAdminAccess } from "@/lib/admin";
import {
  ARTICLE_BODY_MAX_LENGTH,
  ARTICLE_DESCRIPTION_MAX_LENGTH,
  ARTICLE_MAX_TAGS,
  ARTICLE_TAG_MAX_LENGTH,
  ARTICLE_TITLE_MAX_LENGTH,
} from "@/lib/articles";
import {
  createAdminArticle,
  listAdminArticles,
  updateAdminArticle,
  type ArticleKind,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ArticleStatus = "draft" | "published";
type SaveArticleInput = Parameters<typeof createAdminArticle>[0];

function forbidden(reason: string) {
  return NextResponse.json(
    { error: reason },
    { status: reason === "unauthorized" ? 401 : 403 },
  );
}

async function requireAdmin() {
  const access = await getAdminAccess();
  return access.ok ? { access } : { response: forbidden(access.reason) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseKind(value: unknown): ArticleKind | null {
  return value === "blog" || value === "vulnerability" ? value : null;
}

function parseStatus(value: unknown): ArticleStatus | null {
  return value === "draft" || value === "published" ? value : null;
}

function parseText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" || value.length > maxLength) return null;
  return value.trim();
}

function parseBody(value: unknown): string | null {
  if (typeof value !== "string" || value.length > ARTICLE_BODY_MAX_LENGTH) return null;
  return value.trim();
}

function parseTags(value: unknown): string[] | null {
  const rawTags =
    typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : null;
  if (!rawTags || rawTags.some((tag) => typeof tag !== "string")) return null;

  const tags = [...new Set(rawTags.map((tag) => tag.trim()).filter(Boolean))];
  return tags.length <= ARTICLE_MAX_TAGS && tags.every((tag) => tag.length <= ARTICLE_TAG_MAX_LENGTH)
    ? tags
    : null;
}

function parseArticleInput(
  body: unknown,
  authorLogin: string,
): SaveArticleInput | null {
  if (!isRecord(body)) return null;

  const kind = parseKind(body.kind);
  const status = parseStatus(body.status);
  const slug = parseText(body.slug, 120);
  const titleZh = parseText(body.titleZh, ARTICLE_TITLE_MAX_LENGTH);
  const titleEn = parseText(body.titleEn, ARTICLE_TITLE_MAX_LENGTH);
  const descriptionZh = parseText(body.descriptionZh, ARTICLE_DESCRIPTION_MAX_LENGTH);
  const descriptionEn = parseText(body.descriptionEn, ARTICLE_DESCRIPTION_MAX_LENGTH);
  const bodyZh = parseBody(body.bodyZh);
  const bodyEn = parseBody(body.bodyEn);
  const tags = parseTags(body.tags);

  if (
    !kind ||
    !status ||
    !slug ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
    titleZh === null ||
    titleEn === null ||
    descriptionZh === null ||
    descriptionEn === null ||
    bodyZh === null ||
    bodyEn === null ||
    !tags
  ) {
    return null;
  }

  const hasPublishedTranslation =
    (Boolean(titleZh) && Boolean(bodyZh)) || (Boolean(titleEn) && Boolean(bodyEn));
  if (status === "published" && !hasPublishedTranslation) return null;

  return {
    kind,
    slug,
    status,
    tags,
    authorLogin,
    titleZh,
    descriptionZh,
    bodyZh,
    titleEn,
    descriptionEn,
    bodyEn,
  };
}

function isDuplicateSlugError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate|unique|constraint/i.test(message);
}

async function hasDuplicateSlug(slug: string, exceptId?: string) {
  const articles = await listAdminArticles();
  return articles.some((article) => article.slug === slug && article.id !== exceptId);
}

async function readJson(req: NextRequest): Promise<unknown | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if ("response" in admin) return admin.response!;

  const kindParam = new URL(req.url).searchParams.get("kind");
  const kind = kindParam === null ? undefined : parseKind(kindParam);
  if (kindParam !== null && !kind) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const articles = await listAdminArticles(kind ?? undefined);
    return NextResponse.json({ articles });
  } catch {
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if ("response" in admin) return admin.response!;

  const body = await readJson(req);
  const input = parseArticleInput(body, admin.access.session.user.login);
  if (!input) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  try {
    if (await hasDuplicateSlug(input.slug)) {
      return NextResponse.json({ error: "duplicate_slug" }, { status: 409 });
    }
    const article = await createAdminArticle(input);
    if (!article) return NextResponse.json({ error: "save_failed" }, { status: 500 });
    return NextResponse.json({ article });
  } catch (error) {
    return NextResponse.json(
      { error: isDuplicateSlugError(error) ? "duplicate_slug" : "save_failed" },
      { status: isDuplicateSlugError(error) ? 409 : 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin();
  if ("response" in admin) return admin.response!;

  const body = await readJson(req);
  if (!isRecord(body)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const id = parseText(body.id, 200);
  const input = parseArticleInput(body, admin.access.session.user.login);
  if (!id || !input) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  try {
    if (await hasDuplicateSlug(input.slug, id)) {
      return NextResponse.json({ error: "duplicate_slug" }, { status: 409 });
    }
    const article = await updateAdminArticle(id, input);
    if (!article) return NextResponse.json({ error: "save_failed" }, { status: 500 });
    return NextResponse.json({ article });
  } catch (error) {
    return NextResponse.json(
      { error: isDuplicateSlugError(error) ? "duplicate_slug" : "save_failed" },
      { status: isDuplicateSlugError(error) ? 409 : 500 },
    );
  }
}
