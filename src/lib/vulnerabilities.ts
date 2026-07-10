import {
  getPublishedArticle,
  listPublishedArticles,
} from "./db";
import type { ArticleLocale, PublicArticle, PublicArticleMeta } from "./articles";

export function listVulnerabilities(locale: ArticleLocale): Promise<PublicArticleMeta[]> {
  return listPublishedArticles("vulnerability", locale);
}

export function getVulnerability(
  slug: string,
  locale: ArticleLocale,
): Promise<PublicArticle | null> {
  return getPublishedArticle("vulnerability", slug, locale);
}
