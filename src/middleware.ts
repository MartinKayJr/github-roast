import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Run on everything EXCEPT API routes, Next internals, and static files (any
  // path containing a dot). This keeps `/api/badge`, `/api/card`, etc. — the
  // README-embedded endpoints — prefix-free and untouched.
  //
  // BUT arXiv ids contain a dot (e.g. /arxiv/2501.17183), so the dot-exclusion
  // would wrongly skip them and 404 the detail page. Add explicit matchers so
  // the i18n middleware still resolves the locale for /arxiv/* paths.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)", "/arxiv/:path*", "/en/arxiv/:path*"],
};
