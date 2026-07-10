import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { routing } from "@/i18n/routing";
import {
  getPublishedArticle,
  legacyBlogArticleId,
  listPublishedArticles,
  upsertLegacyBlogArticle,
} from "@/lib/db";
import {
  readingMinutes,
  type ArticleLocale,
  type ArticleTranslation,
  type PublicArticle,
  type PublicArticleMeta,
} from "@/lib/articles";

const BLOG_DIR = path.join(process.cwd(), "content", "blog");
const ARTICLE_DATABASE_TIMEOUT_MS = 750;
const legacySeedAttempts = new Set<string>();

export type PostMeta = PublicArticleMeta;
export type Post = PublicArticle;

interface LegacyArticle {
  slug: string;
  date: string;
  updated?: string;
  tags: string[];
  translations: Partial<Record<ArticleLocale, ArticleTranslation>>;
}

function requestedLocale(locale: string): ArticleLocale {
  return locale === "en" ? "en" : "zh";
}

/** Kept for legacy tooling; public page reads now query the article database. */
export function getPostSlugs(): string[] {
  if (!fs.existsSync(BLOG_DIR)) return [];
  return fs
    .readdirSync(BLOG_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(BLOG_DIR, entry.name, "en.md")))
    .map((entry) => entry.name);
}

function readLegacyArticle(slug: string): LegacyArticle | null {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  const dir = path.join(BLOG_DIR, slug);
  const englishFile = path.join(dir, "en.md");
  if (!fs.existsSync(englishFile)) return null;

  const english = matter(fs.readFileSync(englishFile, "utf8"));
  const translations: Partial<Record<ArticleLocale, ArticleTranslation>> = {};
  for (const locale of ["zh", "en"] as const) {
    const file = path.join(dir, `${locale}.md`);
    if (!fs.existsSync(file)) continue;
    const parsed = matter(fs.readFileSync(file, "utf8"));
    translations[locale] = {
      title: String(parsed.data.title ?? slug),
      description: String(parsed.data.description ?? ""),
      body: parsed.content,
    };
  }
  if (!translations.en) return null;
  return {
    slug,
    date: String(english.data.date ?? ""),
    updated: english.data.updated ? String(english.data.updated) : undefined,
    tags: Array.isArray(english.data.tags) ? english.data.tags.map(String) : [],
    translations,
  };
}

function legacyToPost(article: LegacyArticle, locale: ArticleLocale): Post | null {
  const translation = article.translations[locale] ?? article.translations.en ?? article.translations.zh;
  if (!translation) return null;
  const availableLocales = (["zh", "en"] as const).filter((item) => Boolean(article.translations[item]));
  return {
    id: legacyBlogArticleId(article.slug),
    kind: "blog",
    slug: article.slug,
    title: translation.title,
    description: translation.description,
    date: article.date,
    ...(article.updated ? { updated: article.updated } : {}),
    tags: article.tags,
    locale,
    isFallback: !article.translations[locale],
    availableLocales,
    readingMinutes: readingMinutes(translation.body),
    body: translation.body,
    authorLogin: null,
  };
}

async function seedLegacyArticle(article: LegacyArticle): Promise<void> {
  if (legacySeedAttempts.has(article.slug)) return;
  legacySeedAttempts.add(article.slug);
  await withTimeout(
    upsertLegacyBlogArticle({
      slug: article.slug,
      tags: article.tags,
      date: article.date,
      ...(article.updated ? { updated: article.updated } : {}),
      translations: article.translations,
    }),
    undefined,
  );
}

async function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ARTICLE_DATABASE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Database first; bundled Markdown remains a no-database and migration fallback. */
export async function getPost(slug: string, locale: string): Promise<Post | null> {
  const articleLocale = requestedLocale(locale);
  const legacy = readLegacyArticle(slug);
  if (legacy) void seedLegacyArticle(legacy);
  const stored = legacy
    ? await withTimeout(getPublishedArticle("blog", slug, articleLocale), null)
    : await getPublishedArticle("blog", slug, articleLocale);
  return stored ?? (legacy ? legacyToPost(legacy, articleLocale) : null);
}

export async function listPosts(locale: string): Promise<PostMeta[]> {
  const articleLocale = requestedLocale(locale);
  const legacy = getPostSlugs()
    .map(readLegacyArticle)
    .filter((article): article is LegacyArticle => article !== null);
  for (const article of legacy) void seedLegacyArticle(article);

  const stored = await listPublishedArticles("blog", articleLocale);
  if (stored.length > 0 || legacy.length === 0) return stored;
  return legacy
    .map((article) => legacyToPost(article, articleLocale))
    .filter((article): article is Post => article !== null)
    .map(({ body: _body, ...meta }) => meta)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

function postPath(locale: string, slug: string): string {
  return locale === routing.defaultLocale ? `/blog/${slug}` : `/${locale}/blog/${slug}`;
}

export function postAlternates(locale: string, slug: string, availableLocales: string[]) {
  const isFallback = !availableLocales.includes(locale);
  const fallbackLocale = availableLocales.includes("en") ? "en" : "zh";
  const languages: Record<string, string> = {};
  for (const item of routing.locales) {
    if (availableLocales.includes(item)) {
      languages[item === "zh" ? "zh-CN" : item] = postPath(item, slug);
    }
  }
  languages["x-default"] = postPath(fallbackLocale, slug);
  return {
    canonical: isFallback ? postPath(fallbackLocale, slug) : postPath(locale, slug),
    languages,
  };
}
