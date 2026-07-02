/**
 * Shared GitHub-handle validation + normalization.
 *
 * Extracted from the scan route so the omnibox parser, the /vs page, and the
 * card routes all validate handles identically. GitHub logins are 1-39 chars,
 * alphanumeric or single hyphens (no leading/trailing/double hyphen).
 */

export const USERNAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

/** Extract a bare handle from a raw username, `@handle`, or profile URL.
 * Returns the normalized handle, or `null` if it isn't a valid GitHub login. */
export function normalizeUsername(input: string): string | null {
  let s = input.trim();
  const m = s.match(/github\.com\/([^/?#]+)/i);
  if (m) s = m[1];
  s = s.replace(/^@/, "");
  return USERNAME_RE.test(s) ? s : null;
}

/** True when `input` (after normalization) is a valid GitHub handle. */
export function isValidUsername(input: string): boolean {
  return normalizeUsername(input) !== null;
}
