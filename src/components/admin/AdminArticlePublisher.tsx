"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FilePlus2,
  FileText,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Save,
  ShieldAlert,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";

type ArticleKind = "blog" | "vulnerability";
type ArticleStatus = "draft" | "published";

type ArticleTranslation = {
  title: string;
  description: string;
  body: string;
};

type AdminArticleView = {
  id: string;
  kind: ArticleKind;
  slug: string;
  status: ArticleStatus;
  tags: string[];
  authorLogin: string | null;
  publishedAt: number | null;
  createdAt: number;
  updatedAt: number;
  translations: {
    zh: ArticleTranslation | null;
    en: ArticleTranslation | null;
  };
};

type ArticleForm = {
  kind: ArticleKind;
  slug: string;
  status: ArticleStatus;
  tags: string;
  titleZh: string;
  descriptionZh: string;
  bodyZh: string;
  titleEn: string;
  descriptionEn: string;
  bodyEn: string;
};

type ArticleResponse = {
  articles?: AdminArticleView[];
  article?: AdminArticleView;
  error?: string;
};

const emptyForm: ArticleForm = {
  kind: "blog",
  slug: "",
  status: "draft",
  tags: "",
  titleZh: "",
  descriptionZh: "",
  bodyZh: "",
  titleEn: "",
  descriptionEn: "",
  bodyEn: "",
};

function toForm(article: AdminArticleView): ArticleForm {
  return {
    kind: article.kind,
    slug: article.slug,
    status: article.status,
    tags: article.tags.join(", "),
    titleZh: article.translations.zh?.title ?? "",
    descriptionZh: article.translations.zh?.description ?? "",
    bodyZh: article.translations.zh?.body ?? "",
    titleEn: article.translations.en?.title ?? "",
    descriptionEn: article.translations.en?.description ?? "",
    bodyEn: article.translations.en?.body ?? "",
  };
}

function titleFor(article: AdminArticleView) {
  return article.translations.zh?.title || article.translations.en?.title || article.slug;
}

async function responseJson(response: Response): Promise<ArticleResponse> {
  const data = (await response.json().catch(() => ({}))) as ArticleResponse;
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export function AdminArticlePublisher() {
  const t = useTranslations("admin.articlePublisher");
  const [articles, setArticles] = useState<AdminArticleView[]>([]);
  const [form, setForm] = useState<ArticleForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ArticleKind | "all">("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function formatDate(value: number | null) {
    return value ? new Date(value).toLocaleString() : t("notPublished");
  }

  const errorMessage = useCallback((message: string) => {
    switch (message) {
      case "duplicate_slug":
        return t("errors.duplicateSlug");
      case "invalid_request":
        return t("errors.invalidRequest");
      case "save_failed":
        return t("errors.saveFailed");
      default:
        return message;
    }
  }, [t]);

  const loadArticles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/articles", { cache: "no-store" });
      const data = await responseJson(response);
      if (!Array.isArray(data.articles)) throw new Error("save_failed");
      setArticles(data.articles);
    } catch (loadError) {
      setError(errorMessage(loadError instanceof Error ? loadError.message : "save_failed"));
    } finally {
      setLoading(false);
    }
  }, [errorMessage]);

  useEffect(() => {
    let cancelled = false;
    const id = window.setTimeout(() => {
      if (!cancelled) void loadArticles();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [loadArticles]);

  const visibleArticles = useMemo(
    () => articles.filter((article) => filter === "all" || article.kind === filter),
    [articles, filter],
  );

  function startNewArticle() {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
    setNotice(null);
  }

  function editArticle(article: AdminArticleView) {
    setEditingId(article.id);
    setForm(toForm(article));
    setError(null);
    setNotice(null);
  }

  async function saveArticle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/articles", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editingId ? { id: editingId } : {}),
          ...form,
          tags: form.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        }),
      });
      const data = await responseJson(response);
      if (!data.article) throw new Error("save_failed");

      setArticles((current) => [
        data.article!,
        ...current.filter((article) => article.id !== data.article!.id),
      ]);
      setEditingId(data.article.id);
      setForm(toForm(data.article));
      setNotice(data.article.status === "published" ? t("publishedNotice") : t("draftSavedNotice"));
    } catch (saveError) {
      setError(errorMessage(saveError instanceof Error ? saveError.message : "save_failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-5 rounded-lg border border-white/10 bg-white/[0.03] p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-base font-bold text-zinc-100">{t("title")}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-400">
            {t("body")}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={startNewArticle}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-orange-300/20 bg-orange-500/10 px-3 py-2 text-sm font-semibold text-orange-200 transition hover:bg-orange-500/15"
          >
            <FilePlus2 className="h-4 w-4" aria-hidden="true" />
            {t("newArticle")}
          </button>
          <button
            type="button"
            onClick={() => void loadArticles()}
            disabled={loading}
            title={t("refresh")}
            aria-label={t("refresh")}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 text-zinc-300 transition hover:bg-white/5 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-red-400/15 bg-red-400/10 px-3 py-2 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="mt-4 rounded-lg border border-orange-300/20 bg-orange-500/10 px-3 py-2 text-sm text-orange-200">
          {notice}
        </p>
      )}

      <div className="mt-5 grid gap-6 border-t border-white/10 pt-5 lg:grid-cols-[minmax(15rem,0.72fr)_minmax(0,1.28fr)]">
        <aside className="min-w-0 lg:border-r lg:border-white/10 lg:pr-6">
          <label className="block text-xs font-semibold text-zinc-400">
            {t("articleType")}
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as ArticleKind | "all")}
              className="mt-2 h-10 w-full rounded-lg border border-white/10 bg-input px-3 text-sm text-zinc-100 outline-none transition focus:border-orange-300/30 focus:ring-2 focus:ring-orange-500/20"
            >
              <option value="all">{t("filterAll")}</option>
              <option value="blog">{t("kind.blog")}</option>
              <option value="vulnerability">{t("kind.vulnerability")}</option>
            </select>
          </label>

          <div className="mt-4 space-y-2">
            {loading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-zinc-500">
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                {t("loading")}
              </div>
            ) : visibleArticles.length === 0 ? (
              <p className="py-6 text-sm text-zinc-500">{t("empty")}</p>
            ) : (
              visibleArticles.map((article) => {
                const selected = article.id === editingId;
                const isVulnerability = article.kind === "vulnerability";
                const Icon = isVulnerability ? ShieldAlert : FileText;

                return (
                  <button
                    key={article.id}
                    type="button"
                    onClick={() => editArticle(article)}
                    title={t("editArticle", { slug: article.slug })}
                    className={`w-full rounded-lg border p-3 text-left transition ${
                      selected
                        ? "border-orange-300/30 bg-orange-500/10"
                        : "border-white/10 bg-[var(--surface-muted)] hover:bg-white/5"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <Icon
                        className={`mt-0.5 h-4 w-4 shrink-0 ${
                          selected ? "text-orange-200" : "text-zinc-500"
                        }`}
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="break-words text-sm font-semibold text-zinc-100">
                            {titleFor(article)}
                          </span>
                          <span className="rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                            {t(`status.${article.status}`)}
                          </span>
                        </div>
                        <p className="mt-1 break-all text-xs text-zinc-500">{article.slug}</p>
                        <p className="mt-2 text-[11px] text-zinc-500">
                          {article.status === "published"
                            ? formatDate(article.publishedAt)
                            : t("updatedAt", { date: formatDate(article.updatedAt) })}
                        </p>
                      </div>
                      <Pencil className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <form onSubmit={saveArticle} className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-zinc-100">
              {editingId ? t("editArticleHeading") : t("newArticleHeading")}
            </h3>
            {editingId && (
              <button
                type="button"
                onClick={startNewArticle}
                title={t("createNew")}
                aria-label={t("createNew")}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>

          <fieldset disabled={saving} className="mt-4 grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <span className="block text-xs font-semibold text-zinc-400">{t("contentType")}</span>
                <div className="mt-2 grid grid-cols-2 rounded-lg border border-white/10 p-1">
                  {(["blog", "vulnerability"] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setForm((current) => ({ ...current, kind }))}
                      className={`rounded-md px-3 py-2 text-sm font-semibold transition ${
                        form.kind === kind
                          ? "bg-orange-500/10 text-orange-200"
                          : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                      }`}
                    >
                      {t(`kind.${kind}`)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="block text-xs font-semibold text-zinc-400">{t("statusLabel")}</span>
                <div className="mt-2 grid grid-cols-2 rounded-lg border border-white/10 p-1">
                  {(["draft", "published"] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setForm((current) => ({ ...current, status }))}
                      className={`rounded-md px-3 py-2 text-sm font-semibold transition ${
                        form.status === status
                          ? "bg-orange-500/10 text-orange-200"
                          : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                      }`}
                    >
                      {t(`status.${status}`)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
              <label className="block text-xs font-semibold text-zinc-400">
                {t("slug")}
                <Input
                  value={form.slug}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, slug: event.target.value.toLowerCase() }))
                  }
                  placeholder={t("slugPlaceholder")}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  className="mt-2 border-white/10 bg-input text-zinc-100"
                />
              </label>
              <label className="block text-xs font-semibold text-zinc-400">
                {t("tags")}
                <Input
                  value={form.tags}
                  onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))}
                  placeholder={t("tagsPlaceholder")}
                  className="mt-2 border-white/10 bg-input text-zinc-100"
                />
              </label>
            </div>

            <div className="border-t border-white/10 pt-4">
              <h4 className="text-sm font-bold text-zinc-100">{t("localeZh")}</h4>
              <div className="mt-3 grid gap-4">
                <label className="block text-xs font-semibold text-zinc-400">
                  {t("fieldTitle")}
                  <Input
                    value={form.titleZh}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, titleZh: event.target.value }))
                    }
                    placeholder={t("zhTitlePlaceholder")}
                    className="mt-2 border-white/10 bg-input text-zinc-100"
                  />
                </label>
                <label className="block text-xs font-semibold text-zinc-400">
                  {t("summary")}
                  <textarea
                    value={form.descriptionZh}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, descriptionZh: event.target.value }))
                    }
                    rows={3}
                    placeholder={t("zhSummaryPlaceholder")}
                    className="mt-2 block w-full resize-y rounded-lg border border-white/10 bg-input px-3 py-2 text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-orange-300/30 focus:ring-2 focus:ring-orange-500/20"
                  />
                </label>
                <label className="block text-xs font-semibold text-zinc-400">
                  {t("markdownBody")}
                  <textarea
                    value={form.bodyZh}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, bodyZh: event.target.value }))
                    }
                    rows={12}
                    placeholder={t("zhBodyPlaceholder")}
                    className="mt-2 block min-h-52 w-full resize-y rounded-lg border border-white/10 bg-input px-3 py-2 font-mono text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-orange-300/30 focus:ring-2 focus:ring-orange-500/20"
                  />
                </label>
              </div>
            </div>

            <div className="border-t border-white/10 pt-4">
              <h4 className="text-sm font-bold text-zinc-100">{t("localeEn")}</h4>
              <div className="mt-3 grid gap-4">
                <label className="block text-xs font-semibold text-zinc-400">
                  {t("fieldTitle")}
                  <Input
                    value={form.titleEn}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, titleEn: event.target.value }))
                    }
                    placeholder={t("enTitlePlaceholder")}
                    className="mt-2 border-white/10 bg-input text-zinc-100"
                  />
                </label>
                <label className="block text-xs font-semibold text-zinc-400">
                  {t("summary")}
                  <textarea
                    value={form.descriptionEn}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, descriptionEn: event.target.value }))
                    }
                    rows={3}
                    placeholder={t("enSummaryPlaceholder")}
                    className="mt-2 block w-full resize-y rounded-lg border border-white/10 bg-input px-3 py-2 text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-orange-300/30 focus:ring-2 focus:ring-orange-500/20"
                  />
                </label>
                <label className="block text-xs font-semibold text-zinc-400">
                  {t("markdownBody")}
                  <textarea
                    value={form.bodyEn}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, bodyEn: event.target.value }))
                    }
                    rows={12}
                    placeholder={t("enBodyPlaceholder")}
                    className="mt-2 block min-h-52 w-full resize-y rounded-lg border border-white/10 bg-input px-3 py-2 font-mono text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-orange-300/30 focus:ring-2 focus:ring-orange-500/20"
                  />
                </label>
              </div>
            </div>
          </fieldset>

          <div className="mt-5 flex justify-end border-t border-white/10 pt-4">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-orange-300/20 bg-orange-500/10 px-4 py-2 text-sm font-semibold text-orange-200 transition hover:bg-orange-500/15 disabled:cursor-wait disabled:opacity-60"
            >
              {saving ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              {form.status === "published" ? t("publish") : t("saveDraft")}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
