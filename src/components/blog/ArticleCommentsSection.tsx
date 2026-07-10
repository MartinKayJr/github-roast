import { auth, authConfigured, signIn } from "@/lib/auth";
import { getArticleComments } from "@/lib/db";
import { ArticleComments } from "./ArticleComments";

function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), 750);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Resolves server-only article comments and the viewer's sign-in state. */
export async function ArticleCommentsSection({
  articleId,
  redirectTo,
  locale,
}: {
  articleId: string;
  redirectTo: string;
  locale: string;
}) {
  const authAvailable = authConfigured();
  const [initialComments, session] = await Promise.all([
    withTimeout(getArticleComments(articleId), []),
    authAvailable ? auth() : Promise.resolve(null),
  ]);

  async function signInForComment() {
    "use server";
    await signIn("github", { redirectTo });
  }

  return (
    <ArticleComments
      articleId={articleId}
      initialComments={initialComments}
      authenticated={Boolean(session?.user.githubId)}
      authAvailable={authAvailable}
      locale={locale}
      signInAction={signInForComment}
    />
  );
}
