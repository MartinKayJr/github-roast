# ghfind

Official JavaScript/TypeScript SDK **and CLI** for **[ghfind.com](https://ghfind.com)** —
score any GitHub account **0–100** for value and trustworthiness, with roasts,
head-to-head battles, leaderboards, and developer discovery.

- **Deterministic scoring, no LLM.** `score`, `scan`, `getScore`, and the battle
  winner are pure computation over GitHub data.
- **Bring your own model.** The only LLM parts are the *roast prose* and *battle
  commentary*. `roast(..., { byoKey })` runs the LLM through your own
  OpenAI-compatible provider — or just take the structured `scan()` output and
  feed your own model.
- **Score anywhere.** No token → the ghfind server crawls + scores for you. Have a
  token → `ghfind/local` runs the *same* open-source engine entirely on your
  machine (see below). Same numbers either way.
- **Zero runtime dependencies.** Uses the global `fetch` (Node 18+, browsers, edge).

```bash
npm install ghfind      # library
npm install -g ghfind   # or global CLI
```

---

## CLI

```bash
npx ghfind score torvalds          # deterministic score (no auth, cached)
npx ghfind roast torvalds --lang en
npx ghfind vs torvalds octocat
npx ghfind badge torvalds --markdown   # a README badge that links back to ghfind
```

`score` hits the public **`GET /api/score`** endpoint: no auth, edge-cached and
rate-limited on the server, and it scores never-seen accounts live (still
deterministic, no LLM). It's the cheapest path for you *and* for ghfind.

| Command | What it does | Endpoint | LLM? |
| --- | --- | --- | --- |
| `score <user>` | Deterministic score; prints tier, sub-scores, percentile. | `GET /api/score/{u}` | no |
| `scan <user>` | Full evidence payload (metrics, signals, red flags). Heavy — needs `--api-key` in prod. | `POST /api/scan` | no |
| `roast <user>` | Human-facing roast report + AI-adjusted score. | `POST /api/scan` + `/api/roast` | yes\* |
| `vs <a> <b>` | Head-to-head verdict (winner deterministic). | `POST /api/vs-verdict` | yes\* |
| `exists <user>` | Does this GitHub login exist? Runs on **your** IP, never touches ghfind. | `api.github.com` | no |
| `search <query>` | Prefix autocomplete over scored accounts. | `GET /api/search-users` | no |
| `leaderboard` | Ranked profiles. `--view` / `--window`. | `GET /api/leaderboard` | no |
| `developers --type language\|org\|repo` | Discover developers by facet. | `GET /api/developers` | no |
| `stats` | Platform totals. | `GET /api/stats` | no |
| `badge <user>` | Badge URL, or `--markdown` for a README snippet linking to the profile. | — | no |
| `card <user>` | OG share-card PNG URL. | — | no |
| `commands [show <c>]` | Self-describing capability catalog (for agents). | — | no |
| `auth status` | Show host + which credentials are configured. | — | no |

`*` `roast`/`vs` prose is the only LLM part. Pass `--byo-base-url --byo-api-key
--byo-model` (or `GHFIND_BYO_*` env vars) to run `roast` through your own model
instead of ghfind's.

### Score locally, offline, on your own token

`--local` runs the crawl **and** scoring on your machine with your `GITHUB_TOKEN`
— the ghfind server is never called, so it scales infinitely and never adds load:

```bash
export GITHUB_TOKEN=ghp_xxx
ghfind score torvalds --local     # crawl + score entirely on your machine
ghfind scan torvalds  --local
```

Rule of thumb: **have a token → `--local`** (offline, unlimited); **no token →
plain `score`** (ghfind scores it for you). Output is identical.

### Options & environment

```
--host <url>          default https://ghfind.com (or GHFIND_HOST)
--api-key <key>       Authorization: Bearer — bypasses Turnstile on POST /api/scan
                      (or GHFIND_API_KEY)
--github-token <t>    for --local and exists (or GITHUB_TOKEN)
--byo-base-url/-api-key/-model   your OpenAI-compatible provider for roast
--json | -o json|pretty|markdown
--lang zh|en
```

---

## Library

```ts
import { GhFind } from "ghfind";

const gh = new GhFind(); // defaults to https://ghfind.com

// Cheapest: deterministic score (no LLM), works for ANY account.
const s = await gh.getScore("torvalds");
console.log(s.final_score, s.tier, s.percentile, s.source); // "indexed" | "live"

// Full evidence payload:
const scan = await gh.scan("torvalds");
console.log(scan.scoring.final_score, scan.scoring.red_flags);

// Confirm a handle exists first (on your IP, not ghfind's):
if (await gh.userExists("torvalds")) { /* ... */ }

// Roast with your own model (no ghfind LLM spend):
const roast = await gh.roast({
  username: "torvalds",
  byoKey: { baseURL: "https://api.openai.com/v1", apiKey: process.env.OPENAI_API_KEY!, model: "gpt-4o" },
});
```

Every method is one atomic capability; introspect them at runtime via
`import { catalog } from "ghfind"`.

### Local scoring (`ghfind/local`)

```ts
import { collectAndScore } from "ghfind/local";
const scan = await collectAndScore("torvalds", { token: process.env.GITHUB_TOKEN });
console.log(scan.scoring.final_score);
```

`ghfind/local` bundles the *actual* open-source scoring core from the website —
not a copy — so results are byte-for-byte identical and can never drift. Import it
only when you want local scoring; the main `ghfind` entry stays a tiny
dependency-free remote client and never pulls it in.

---

Machine-readable API spec: <https://ghfind.com/openapi.json> · Agent notes:
<https://ghfind.com/llms.txt>

Python SDK/CLI: [`ghfind` on PyPI](https://pypi.org/project/ghfind/). License: AGPL-3.0-or-later.
