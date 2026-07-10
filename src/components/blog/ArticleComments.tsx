"use client";

import { type FormEvent, useMemo, useState } from "react";
import { Link } from "@/i18n/navigation";
import { LogIn, MessageCircle, Send, UserRound } from "lucide-react";
import {
  ARTICLE_COMMENT_MAX_LENGTH,
  normalizeArticleCommentText,
  type ArticleComment,
} from "@/lib/articles";

type CommentLocale = "zh" | "en";
type SubmissionError = "authentication_required" | "request_failed" | null;

interface CommentLabels {
  heading: string;
  noComments: string;
  placeholder: string;
  characterCount: (count: number, max: number) => string;
  submit: string;
  submitting: string;
  signInPrompt: string;
  signInAction: string;
  authUnavailable: string;
  authenticationRequired: string;
  requestFailed: string;
}

const LABELS: Record<CommentLocale, CommentLabels> = {
  zh: {
    heading: "评论",
    noComments: "暂无评论",
    placeholder: "写下你的看法",
    characterCount: (count, max) => `${count}/${max}`,
    submit: "发布评论",
    submitting: "发布中",
    signInPrompt: "登录后发表评论",
    signInAction: "使用 GitHub 登录",
    authUnavailable: "评论登录暂不可用",
    authenticationRequired: "登录状态已失效，请重新登录。",
    requestFailed: "评论未能发布，请稍后重试。",
  },
  en: {
    heading: "Comments",
    noComments: "No comments yet.",
    placeholder: "Share your thoughts",
    characterCount: (count, max) => `${count}/${max}`,
    submit: "Post comment",
    submitting: "Posting",
    signInPrompt: "Sign in to join the discussion",
    signInAction: "Sign in with GitHub",
    authUnavailable: "Comment sign-in is currently unavailable.",
    authenticationRequired: "Your session has expired. Please sign in again.",
    requestFailed: "Your comment could not be posted. Please try again.",
  },
};

function resolvedLocale(locale: string): CommentLocale {
  return locale.startsWith("zh") ? "zh" : "en";
}

function commentDate(createdAt: number, locale: CommentLocale): string {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(createdAt));
}

function avatarUrl(comment: ArticleComment): string {
  return (
    comment.author.avatarUrl ??
    `https://github.com/${encodeURIComponent(comment.author.login)}.png?size=64`
  );
}

function ArticleCommentItem({
  comment,
  locale,
}: {
  comment: ArticleComment;
  locale: CommentLocale;
}) {
  const timestamp = new Date(comment.createdAt);

  return (
    <li className="flex gap-3 py-5 first:pt-0">
      <span
        aria-hidden="true"
        className="h-9 w-9 shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-muted)] bg-cover bg-center"
        style={{ backgroundImage: `url(${avatarUrl(comment)})` }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Link
            href={`/u/${comment.author.login}`}
            prefetch={false}
            className="min-w-0 truncate text-sm font-semibold text-[var(--foreground)] underline-offset-2 hover:text-[var(--primary)] hover:underline"
          >
            @{comment.author.login}
          </Link>
          <time
            dateTime={Number.isNaN(timestamp.getTime()) ? undefined : timestamp.toISOString()}
            className="text-xs text-[var(--muted-foreground)]"
          >
            {commentDate(comment.createdAt, locale)}
          </time>
        </div>
        <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--foreground)] [overflow-wrap:anywhere]">
          {comment.body}
        </p>
      </div>
    </li>
  );
}

export function ArticleComments({
  articleId,
  initialComments,
  authenticated,
  authAvailable,
  locale,
  signInAction,
}: {
  articleId: string;
  initialComments: ArticleComment[];
  authenticated: boolean;
  authAvailable: boolean;
  locale: string;
  signInAction: () => Promise<void>;
}) {
  const commentLocale = resolvedLocale(locale);
  const labels = LABELS[commentLocale];
  const [comments, setComments] = useState(initialComments);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<SubmissionError>(null);
  const normalizedDraft = useMemo(() => normalizeArticleCommentText(draft), [draft]);
  const canSubmit = Boolean(normalizedDraft) && !submitting;
  const draftLength = Array.from(draft).length;

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!normalizedDraft || submitting) return;

    setSubmitting(true);
    setSubmissionError(null);

    try {
      const response = await fetch(
        `/api/articles/${encodeURIComponent(articleId)}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: normalizedDraft }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { comment?: ArticleComment; error?: string }
        | null;

      if (!response.ok || !payload?.comment) {
        setSubmissionError(
          response.status === 401 || payload?.error === "authentication_required"
            ? "authentication_required"
            : "request_failed",
        );
        return;
      }

      setComments((current) => [...current, payload.comment as ArticleComment]);
      setDraft("");
    } catch {
      setSubmissionError("request_failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      aria-labelledby="article-comments-heading"
      className="mt-12 border-t border-[var(--border)] pt-8 sm:mt-16"
    >
      <div className="flex items-center gap-2">
        <MessageCircle aria-hidden="true" className="h-5 w-5 text-[var(--primary)]" />
        <h2 id="article-comments-heading" className="text-xl font-bold text-[var(--foreground)]">
          {labels.heading}
        </h2>
        <span className="text-sm tabular-nums text-[var(--muted-foreground)]">
          {comments.length}
        </span>
      </div>

      {authenticated ? (
        <form
          onSubmit={submitComment}
          className="mt-5 border border-[var(--border)] bg-[var(--surface)] p-3 sm:p-4"
        >
          <label htmlFor={`article-comment-${articleId}`} className="sr-only">
            {labels.placeholder}
          </label>
          <textarea
            id={`article-comment-${articleId}`}
            value={draft}
            onChange={(event) => {
              setDraft(
                Array.from(event.target.value)
                  .slice(0, ARTICLE_COMMENT_MAX_LENGTH)
                  .join(""),
              );
              setSubmissionError(null);
            }}
            rows={4}
            maxLength={ARTICLE_COMMENT_MAX_LENGTH}
            placeholder={labels.placeholder}
            disabled={submitting}
            className="block w-full resize-y border-0 bg-transparent px-0 py-1 text-sm leading-6 text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] disabled:cursor-wait disabled:opacity-70"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-soft)] pt-3">
            <div className="min-h-5 text-xs text-[var(--muted-foreground)]">
              {submissionError ? (
                <span role="alert" className="text-red-500">
                  {submissionError === "authentication_required"
                    ? labels.authenticationRequired
                    : labels.requestFailed}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs tabular-nums text-[var(--muted-foreground)]">
                {labels.characterCount(draftLength, ARTICLE_COMMENT_MAX_LENGTH)}
              </span>
              <button
                type="submit"
                disabled={!canSubmit}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Send aria-hidden="true" className="h-4 w-4" />
                {submitting ? labels.submitting : labels.submit}
              </button>
            </div>
          </div>
        </form>
      ) : (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-y border-[var(--border)] py-4">
          <p className="text-sm text-[var(--muted-foreground)]">
            {submissionError === "authentication_required"
              ? labels.authenticationRequired
              : authAvailable
                ? labels.signInPrompt
                : labels.authUnavailable}
          </p>
          {authAvailable ? (
            <form action={signInAction}>
              <button
                type="submit"
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
              >
                <LogIn aria-hidden="true" className="h-4 w-4" />
                {labels.signInAction}
              </button>
            </form>
          ) : (
            <UserRound aria-hidden="true" className="h-5 w-5 text-[var(--muted-foreground)]" />
          )}
        </div>
      )}

      {submissionError === "authentication_required" && authenticated && authAvailable ? (
        <form action={signInAction} className="mt-3">
          <button
            type="submit"
            className="inline-flex h-8 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <LogIn aria-hidden="true" className="h-3.5 w-3.5" />
            {labels.signInAction}
          </button>
        </form>
      ) : null}

      {comments.length > 0 ? (
        <ol className="mt-7 divide-y divide-[var(--border)]">
          {comments.map((comment) => (
            <ArticleCommentItem key={comment.id} comment={comment} locale={commentLocale} />
          ))}
        </ol>
      ) : (
        <p className="mt-7 text-sm text-[var(--muted-foreground)]">{labels.noComments}</p>
      )}
    </section>
  );
}
