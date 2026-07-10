export const ARTICLE_KINDS = ["blog", "vulnerability"] as const;
export type ArticleKind = (typeof ARTICLE_KINDS)[number];

export const ARTICLE_STATUSES = ["draft", "published"] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export const ARTICLE_LOCALES = ["zh", "en"] as const;
export type ArticleLocale = (typeof ARTICLE_LOCALES)[number];

export interface ArticleTranslation {
  title: string;
  description: string;
  body: string;
}

export interface PublicArticle {
  id: string;
  kind: ArticleKind;
  slug: string;
  title: string;
  description: string;
  date: string;
  updated?: string;
  tags: string[];
  locale: ArticleLocale;
  isFallback: boolean;
  availableLocales: ArticleLocale[];
  readingMinutes: number;
  body: string;
  authorLogin: string | null;
}

export type PublicArticleMeta = Omit<PublicArticle, "body">;

export interface AdminArticleView {
  id: string;
  kind: ArticleKind;
  slug: string;
  status: ArticleStatus;
  tags: string[];
  authorLogin: string | null;
  publishedAt: number | null;
  createdAt: number;
  updatedAt: number;
  translations: Partial<Record<ArticleLocale, ArticleTranslation>>;
}

export interface SaveArticleInput {
  kind: ArticleKind;
  slug: string;
  status: ArticleStatus;
  tags: string[];
  authorLogin: string;
  titleZh: string;
  descriptionZh: string;
  bodyZh: string;
  titleEn: string;
  descriptionEn: string;
  bodyEn: string;
}

export interface ArticleComment {
  id: string;
  articleId: string;
  author: {
    githubId: number;
    login: string;
    avatarUrl: string | null;
  };
  body: string;
  createdAt: number;
}

export const ARTICLE_COMMENT_MAX_LENGTH = 1000;
export const ARTICLE_TITLE_MAX_LENGTH = 180;
export const ARTICLE_DESCRIPTION_MAX_LENGTH = 600;
export const ARTICLE_BODY_MAX_LENGTH = 100_000;
export const ARTICLE_TAG_MAX_LENGTH = 48;
export const ARTICLE_MAX_TAGS = 12;

const ARTICLE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isArticleKind(value: unknown): value is ArticleKind {
  return typeof value === "string" && ARTICLE_KINDS.includes(value as ArticleKind);
}

export function isArticleStatus(value: unknown): value is ArticleStatus {
  return typeof value === "string" && ARTICLE_STATUSES.includes(value as ArticleStatus);
}

export function normalizeArticleSlug(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  return value.length <= 120 && ARTICLE_SLUG_RE.test(value) ? value : null;
}

export function normalizeArticleTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const tag = raw.replace(/\s+/g, " ").trim().slice(0, ARTICLE_TAG_MAX_LENGTH);
    if (tag) seen.add(tag);
    if (seen.size >= ARTICLE_MAX_TAGS) break;
  }
  return [...seen];
}

export function normalizeArticleText(input: unknown, maxLength: number): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value || Array.from(value).length > maxLength) return null;
  return value;
}

export function normalizeOptionalArticleText(input: unknown, maxLength: number): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (Array.from(value).length > maxLength) return null;
  return value;
}

export function normalizeArticleCommentText(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.replace(/\s+/g, " ").trim();
  if (!value || Array.from(value).length > ARTICLE_COMMENT_MAX_LENGTH) return null;
  return value;
}

export function readingMinutes(text: string): number {
  const cjk = (text.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) ?? []).length;
  const words = text
    .replace(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(cjk / 400 + words / 220));
}
