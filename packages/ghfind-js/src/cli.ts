/**
 * ghfind CLI — a thin command-line wrapper over the {@link GhFind} SDK.
 *
 * Design goals (in priority order):
 *  1. Useful with zero setup: `score` hits the public GET /api/score endpoint,
 *     which needs no auth and is cached + rate-limited on the server.
 *  2. Kind to the ghfind server: `--local` moves the heavy GitHub crawl onto the
 *     caller's own token/machine (see `ghfind/local`); nothing touches ghfind.
 *  3. Drives traffic back: human-facing output ends with a profile link, and
 *     `badge --markdown` prints a README-ready snippet that links to ghfind.com.
 *
 * No LLM is ever bundled. `roast` uses the server's model by default (protected
 * by caching + rate limits); pass `--byo-*` to run it through your own provider.
 */
import { GhFind, GhFindError } from "./client.js";
import type { ByoKey, ScanResult } from "./types.js";
import { catalog, DEFAULT_HOST } from "./catalog.js";

const VERSION = "0.1.0";
const VALID_OUTPUTS = new Set(["json", "pretty", "markdown"]);
const SUB_SCORE_ORDER = [
  "account_maturity",
  "original_project_quality",
  "contribution_quality",
  "ecosystem_impact",
  "community_influence",
  "activity_authenticity",
] as const;

export interface Flags {
  json?: boolean;
  output?: string;
  host?: string;
  apiKey?: string;
  lang?: string;
  view?: string;
  window?: string;
  type?: string;
  value?: string;
  local?: boolean;
  githubToken?: string;
  byoBaseUrl?: string;
  byoApiKey?: string;
  byoModel?: string;
  markdown?: boolean;
  includeScan?: boolean;
  verifyExists?: boolean;
  help?: boolean;
  version?: boolean;
}

function out(value: string): void {
  process.stdout.write(`${value}\n`);
}
function outJson(value: unknown): void {
  out(JSON.stringify(value, null, 2));
}
function fail(message: string, code = 1): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

export function parseArgs(argv: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = {};
  const takesValue: Record<string, keyof Flags> = {
    "-o": "output",
    "--output": "output",
    "--host": "host",
    "--api-key": "apiKey",
    "--lang": "lang",
    "--view": "view",
    "--window": "window",
    "--type": "type",
    "--value": "value",
    "--github-token": "githubToken",
    "--byo-base-url": "byoBaseUrl",
    "--byo-api-key": "byoApiKey",
    "--byo-model": "byoModel",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") flags.json = true;
    else if (arg === "--local") flags.local = true;
    else if (arg === "--markdown" || arg === "--md") flags.markdown = true;
    else if (arg === "--include-scan") flags.includeScan = true;
    else if (arg === "--verify-exists") flags.verifyExists = true;
    else if (arg === "-h" || arg === "--help") flags.help = true;
    else if (arg === "--version") flags.version = true;
    else if (arg in takesValue) {
      const key = takesValue[arg];
      const next = argv[++i];
      if (next === undefined) fail(`${arg} requires a value`);
      (flags as Record<string, unknown>)[key] = next;
    } else positional.push(arg);
  }
  return { positional, flags };
}

function outputMode(flags: Flags, fallback = "pretty"): string {
  const mode = flags.json ? "json" : (flags.output ?? fallback);
  if (!VALID_OUTPUTS.has(mode)) fail(`Invalid output format: ${mode}`);
  return mode;
}

function langMode(flags: Flags): "zh" | "en" {
  const lang = flags.lang ?? "zh";
  if (lang !== "zh" && lang !== "en") fail(`Invalid language: ${lang}`);
  return lang;
}

function client(flags: Flags): GhFind {
  return new GhFind({
    host: flags.host,
    apiKey: flags.apiKey ?? process.env.GHFIND_API_KEY ?? process.env.GITHUB_ROAST_API_KEY,
    githubToken: flags.githubToken ?? process.env.GITHUB_TOKEN,
  });
}

function resolveHost(flags: Flags): string {
  const raw = (
    flags.host ||
    process.env.GHFIND_HOST ||
    process.env.GITHUB_ROAST_HOST ||
    DEFAULT_HOST
  ).trim();
  return raw.replace(/\/+$/, "");
}

export function byoKey(flags: Flags): ByoKey | undefined {
  const baseURL = flags.byoBaseUrl ?? process.env.GHFIND_BYO_BASE_URL;
  const apiKey = flags.byoApiKey ?? process.env.GHFIND_BYO_API_KEY;
  const model = flags.byoModel ?? process.env.GHFIND_BYO_MODEL;
  if (baseURL && apiKey && model) return { baseURL, apiKey, model };
  if (baseURL || apiKey || model) {
    fail("Incomplete BYO key: need --byo-base-url, --byo-api-key and --byo-model together.");
  }
  return undefined;
}

function githubToken(flags: Flags): string | undefined {
  return flags.githubToken ?? process.env.GITHUB_TOKEN;
}

function usernameArg(positional: string[], index = 1): string {
  const username = positional[index];
  if (!username) fail("Missing username.");
  return username;
}

function profileLink(host: string, username: string): string {
  return `\n→ ${host}/u/${encodeURIComponent(username)}`;
}

function printSubScores(subScores: Record<string, number> | undefined): void {
  if (!subScores) return;
  for (const key of SUB_SCORE_ORDER) {
    if (key in subScores) out(`- ${key}: ${subScores[key]}`);
  }
}

async function localScan(flags: Flags, username: string): Promise<ScanResult> {
  const token = githubToken(flags);
  if (!token) {
    fail(
      "--local needs a GitHub token: pass --github-token or set GITHUB_TOKEN.\n" +
        "Local scoring crawls GitHub on your own machine and quota (ghfind is never called).",
    );
  }
  // Loaded lazily so the common remote path never pulls in the heavy engine.
  const { collectAndScore } = await import("./local.js");
  return collectAndScore(username, { token });
}

// ---- commands --------------------------------------------------------------

async function cmdScore(positional: string[], flags: Flags): Promise<void> {
  const username = usernameArg(positional);
  const host = resolveHost(flags);
  const mode = outputMode(flags);

  if (flags.local) {
    const scan = await localScan(flags, username);
    const s = scan.scoring;
    if (mode === "json") {
      outJson({ source: "local", username: scan.metrics.username, ...s });
      return;
    }
    out(`${scan.metrics.username}: ${s.final_score}/100 ${s.tier} (${s.tier_label})`);
    printSubScores(s.sub_scores);
    if (s.red_flags?.length) {
      out("red_flags:");
      for (const f of s.red_flags) out(`- ${f.flag}: -${f.penalty} ${f.detail}`);
    }
    out(profileLink(host, scan.metrics.username));
    return;
  }

  const payload = await client(flags).getScore(username, { verifyExists: flags.verifyExists });
  if (mode === "json") {
    outJson(payload);
    return;
  }
  out(`${payload.username}: ${payload.final_score}/100 ${payload.tier} (${payload.tier_key})`);
  printSubScores(payload.sub_scores);
  if (payload.red_flags?.length) {
    out("red_flags:");
    for (const f of payload.red_flags) out(`- ${f.flag}: -${f.penalty} ${f.detail}`);
  }
  if (payload.percentile?.beat != null) {
    out(`beats ${payload.percentile.beat}% of ${payload.percentile.total} scored accounts`);
  }
  out(profileLink(host, payload.username));
}

async function cmdScan(positional: string[], flags: Flags): Promise<void> {
  const username = usernameArg(positional);
  const scan = flags.local
    ? await localScan(flags, username)
    : await client(flags).scan(username, { verifyExists: flags.verifyExists });
  outJson(scan);
}

async function cmdRoast(positional: string[], flags: Flags): Promise<void> {
  const username = usernameArg(positional);
  const host = resolveHost(flags);
  const lang = langMode(flags);
  const mode = outputMode(flags, "markdown");
  const gh = client(flags);
  // --local crawls + scores on the caller's machine, then sends only the scan to
  // the server for the prose (which still needs a model — the server's or BYO).
  const scan = flags.local ? await localScan(flags, username) : undefined;
  const roast = await gh.roast({ username: scan ? undefined : username, scan, lang, byoKey: byoKey(flags) });

  if (mode === "json") {
    const body: Record<string, unknown> = {
      username,
      lang,
      meta: roast.meta,
      report: roast.report,
    };
    if (flags.includeScan && scan) body.scan = scan;
    outJson(body);
    return;
  }
  if (mode === "markdown") {
    out(roast.report);
    out(profileLink(host, username));
    return;
  }
  out(`${username}: ${roast.meta?.final_score}/100 ${roast.meta?.tier} (${roast.meta?.tier_label})`);
  const line = roast.meta?.roast_line?.[lang] || roast.meta?.roast_line?.zh || roast.meta?.roast_line?.en;
  if (line) out(line);
  out("");
  out(roast.report);
  out(profileLink(host, username));
}

async function cmdVs(positional: string[], flags: Flags): Promise<void> {
  const a = usernameArg(positional, 1);
  const b = usernameArg(positional, 2);
  const host = resolveHost(flags);
  const result = await client(flags).vs(a, b);
  if (outputMode(flags) === "json") {
    outJson(result);
    return;
  }
  if (result.winner) out(`winner: ${result.winner}${result.bucket ? ` (${result.bucket})` : ""}`);
  else out(`result: tie${result.reason ? ` (${result.reason})` : ""}`);
  const verdict = result.verdict?.[flags.lang === "en" ? "en" : "zh"];
  if (verdict) out(verdict);
  out(`\n→ ${host}/vs/${encodeURIComponent(a)}/${encodeURIComponent(b)}`);
}

async function cmdExists(positional: string[], flags: Flags): Promise<void> {
  const username = usernameArg(positional);
  const user = await client(flags).getGitHubUser(username, { token: githubToken(flags) });
  if (outputMode(flags) === "json") {
    outJson({ username, exists: user !== null, user });
    return;
  }
  out(user ? `${username}: exists` : `${username}: does not exist`);
}

async function cmdSearch(positional: string[], flags: Flags): Promise<void> {
  const q = usernameArg(positional);
  const result = await client(flags).searchUsers(q);
  if (outputMode(flags) === "json") {
    outJson(result);
    return;
  }
  for (const u of result.users ?? []) {
    out(`${u.username}\t${u.final_score}/100 ${u.tier}`);
  }
}

async function cmdLeaderboard(flags: Flags): Promise<void> {
  const view = flags.view as never;
  const window = flags.window as never;
  if (flags.view && !["trending", "score", "heat", "progress"].includes(flags.view)) {
    fail(`Invalid leaderboard view: ${flags.view}`);
  }
  if (flags.window && !["all", "24h", "7d", "30d"].includes(flags.window)) {
    fail(`Invalid leaderboard window: ${flags.window}`);
  }
  const result = await client(flags).leaderboard({ view, window });
  outJson(result);
}

async function cmdDevelopers(flags: Flags): Promise<void> {
  if (!flags.type || !["language", "org", "repo"].includes(flags.type)) {
    fail(`Invalid developers type: ${flags.type ?? ""} (use --type language|org|repo)`);
  }
  const result = await client(flags).developers({ type: flags.type as never, value: flags.value });
  outJson(result);
}

async function cmdStats(flags: Flags): Promise<void> {
  outJson(await client(flags).stats());
}

function cmdBadge(positional: string[], flags: Flags): void {
  const username = usernameArg(positional);
  const gh = client(flags);
  const badge = gh.badgeUrl(username, { lang: flags.lang === "en" ? "en" : undefined });
  const profile = `${resolveHost(flags)}/u/${encodeURIComponent(username)}`;
  if (flags.markdown) {
    out(`[![ghfind score](${badge})](${profile})`);
    return;
  }
  if (outputMode(flags) === "json") {
    outJson({ badge_url: badge, card_url: gh.cardUrl(username), profile });
    return;
  }
  out(badge);
}

function cmdCard(positional: string[], flags: Flags): void {
  const username = usernameArg(positional);
  out(client(flags).cardUrl(username));
}

function cmdCommands(positional: string[], flags: Flags): void {
  if (positional[1] === "show") {
    const name = positional.slice(2).join(" ");
    const cap = catalog.find((c) => c.method === name || c.method.split(" / ").includes(name));
    if (!cap) fail(`Unknown capability: ${name}`);
    outJson(cap);
    return;
  }
  if (flags.json) {
    outJson({ default_host: DEFAULT_HOST, capabilities: catalog });
    return;
  }
  for (const c of catalog) out(`${c.method}\t${c.summary}`);
}

function cmdAuthStatus(flags: Flags): void {
  const apiKey = flags.apiKey ?? process.env.GHFIND_API_KEY ?? process.env.GITHUB_ROAST_API_KEY;
  const body = {
    host: resolveHost(flags),
    default_host: DEFAULT_HOST,
    has_api_key: Boolean(apiKey),
    has_github_token: Boolean(githubToken(flags)),
    has_byo_key: Boolean(byoKeyConfigured(flags)),
    env: {
      primary: ["GHFIND_HOST", "GHFIND_API_KEY", "GITHUB_TOKEN", "GHFIND_BYO_BASE_URL", "GHFIND_BYO_API_KEY", "GHFIND_BYO_MODEL"],
      compatible: ["GITHUB_ROAST_HOST", "GITHUB_ROAST_API_KEY"],
    },
  };
  if (outputMode(flags) === "json") {
    outJson(body);
    return;
  }
  out(`host: ${body.host}`);
  out(`api key: ${body.has_api_key ? "configured" : "missing"}`);
  out(`github token (for --local / exists): ${body.has_github_token ? "configured" : "missing"}`);
  out(`byo llm key (for roast): ${body.has_byo_key ? "configured" : "missing"}`);
}

function byoKeyConfigured(flags: Flags): boolean {
  return Boolean(
    (flags.byoBaseUrl ?? process.env.GHFIND_BYO_BASE_URL) &&
      (flags.byoApiKey ?? process.env.GHFIND_BYO_API_KEY) &&
      (flags.byoModel ?? process.env.GHFIND_BYO_MODEL),
  );
}

function printHelp(): void {
  out("ghfind — score any GitHub account 0-100 (deterministic, no LLM) + roasts, battles, leaderboards.");
  out("");
  out("Usage: ghfind <command> [options]");
  out("");
  out("Commands:");
  out("  score <user>          Deterministic score via GET /api/score (no auth, cached). --local to score offline.");
  out("  scan <user>           Full evidence payload via POST /api/scan (heavy; needs --api-key in prod). --local supported.");
  out("  roast <user>          Human-facing roast report (LLM). --byo-* to use your own model.");
  out("  vs <a> <b>            Head-to-head verdict (winner deterministic).");
  out("  exists <user>         Check a GitHub login exists (client-side; never touches ghfind).");
  out("  search <query>        Prefix autocomplete over scored accounts.");
  out("  leaderboard           Ranked profiles. --view trending|score|heat|progress --window all|24h|7d|30d");
  out("  developers --type T   Discover developers by language|org|repo [--value V].");
  out("  stats                 Platform totals.");
  out("  badge <user>          Print the score badge URL. --markdown for a README snippet.");
  out("  card <user>           Print the OG share-card URL.");
  out("  commands [show <c>]    List agent-callable capabilities (self-describing).");
  out("  auth status           Show host + which credentials are configured.");
  out("");
  out("Common options: --host, --api-key, --json, -o/--output, --lang zh|en");
  out("Local scoring:  --local (score/scan/roast) uses your GITHUB_TOKEN, entirely on your machine.");
  out("Bring your own model: --byo-base-url --byo-api-key --byo-model (roast only).");
}

export async function run(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { positional, flags } = parseArgs(argv);
  const command = positional[0];

  if (flags.version || command === "version") {
    out(`ghfind ${VERSION}`);
    return;
  }
  if (!command || flags.help) {
    printHelp();
    return;
  }

  try {
    switch (command) {
      case "score":
        return await cmdScore(positional, flags);
      case "scan":
        return await cmdScan(positional, flags);
      case "roast":
        return await cmdRoast(positional, flags);
      case "vs":
        return await cmdVs(positional, flags);
      case "exists":
        return await cmdExists(positional, flags);
      case "search":
        return await cmdSearch(positional, flags);
      case "leaderboard":
        return await cmdLeaderboard(flags);
      case "developers":
        return await cmdDevelopers(flags);
      case "stats":
        return await cmdStats(flags);
      case "badge":
        return cmdBadge(positional, flags);
      case "card":
        return cmdCard(positional, flags);
      case "commands":
        return cmdCommands(positional, flags);
      case "auth":
        if (positional[1] === "status") return cmdAuthStatus(flags);
        return fail("Unknown auth command. Try: ghfind auth status");
      default:
        return fail(`Unknown command: ${command}. Run 'ghfind --help'.`);
    }
  } catch (e) {
    if (e instanceof GhFindError) {
      const suffix = e.code ? ` (${e.code})` : "";
      fail(`${e.message}${suffix}`, e.status === 429 ? 2 : 1);
    }
    if (e instanceof Error) fail(e.message);
    throw e;
  }
}
