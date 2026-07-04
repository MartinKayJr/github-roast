/**
 * Renders the research-article charts as static SVGs from
 * content/blog/we-scored-19000-github-accounts/data.json into
 * public/blog/we-scored-19000-github-accounts/. Zero deps, dark palette
 * matching the site (#0a0a0b bg, #ea580c accent).
 *
 * Usage: npx tsx scripts/blog-charts.mts
 */
import fs from "node:fs";

const SLUG = "we-scored-19000-github-accounts";
const DATA = `/Users/rqq/github-roast/content/blog/${SLUG}/data.json`;
const OUT_DIR = `/Users/rqq/github-roast/public/blog/${SLUG}`;

const d = JSON.parse(fs.readFileSync(DATA, "utf8"));

const BG = "#0a0a0b";
const FG = "#fafafa";
const MUTED = "#a1a1aa";
const FAINT = "#3f3f46";
const ACCENT = "#ea580c";
const FONT = `ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif`;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
const pct = (num: number, den: number, digits = 1) =>
  `${((num / den) * 100).toFixed(digits)}%`;

function svgDoc(w: number, h: number, title: string, note: string, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}">
<rect width="${w}" height="${h}" fill="${BG}"/>
<text x="36" y="46" fill="${FG}" font-size="26" font-weight="700">${esc(title)}</text>
${body}
<text x="36" y="${h - 20}" fill="${FAINT}" font-size="14">${esc(note)} · ghsphere.com</text>
</svg>`;
}

function write(name: string, svg: string) {
  fs.writeFileSync(`${OUT_DIR}/${name}`, svg);
  console.error(`wrote ${name}`);
}

// ---------- 1. score distribution ----------
{
  const hist: Record<string, number> = d.score_histogram_bucket5;
  const buckets = Array.from({ length: 20 }, (_, i) => i * 5);
  const values = buckets.map((b) => hist[b] ?? 0);
  const maxV = Math.max(...values);
  const W = 1160, H = 560, mL = 66, mR = 30, mT = 84, mB = 78;
  const plotW = W - mL - mR, plotH = H - mT - mB;
  const bw = plotW / buckets.length;
  // tier bands: <40 拉完了, 40-70 NPC, 70-80, 80-90, 90+
  const tierColor = (b: number) =>
    b >= 90 ? ACCENT : b >= 80 ? "#f97316" : b >= 70 ? "#fb923c" : b >= 40 ? "#71717a" : "#52525b";
  let bars = "";
  values.forEach((v, i) => {
    const h = maxV ? (v / maxV) * plotH : 0;
    const x = mL + i * bw + 2;
    const y = mT + plotH - h;
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${tierColor(buckets[i])}"/>`;
    if (v > 0 && v / maxV > 0.03)
      bars += `<text x="${(x + (bw - 4) / 2).toFixed(1)}" y="${(y - 8).toFixed(1)}" fill="${MUTED}" font-size="13" text-anchor="middle">${fmt(v)}</text>`;
  });
  let axis = "";
  for (const b of [0, 20, 40, 60, 80, 100]) {
    const x = mL + (b / 5) * bw;
    axis += `<text x="${x}" y="${mT + plotH + 26}" fill="${MUTED}" font-size="15" text-anchor="middle">${b}</text>`;
    axis += `<line x1="${x}" y1="${mT}" x2="${x}" y2="${mT + plotH}" stroke="${FAINT}" stroke-width="1" stroke-dasharray="3 5"/>`;
  }
  const n = d.totals.scored_accounts_visible;
  write("score-distribution.svg", svgDoc(W, H, `Final score distribution (${fmt(n)} accounts)`, `n = ${n.toLocaleString()} scored public accounts, 5-point buckets`, bars + axis +
    `<text x="${W - mR}" y="${mT + plotH + 52}" fill="${MUTED}" font-size="15" text-anchor="end">score →</text>`));
}

// ---------- 2. red flags prevalence ----------
{
  const flags: Record<string, number> = d.red_flags.by_flag;
  const of = d.red_flags.of;
  const rows = Object.entries(flags).sort((a, b) => b[1] - a[1]);
  const W = 1160, rowH = 40, mT = 84, mB = 60, mL = 320, mR = 130;
  const H = mT + rows.length * rowH + mB;
  const plotW = W - mL - mR;
  const maxV = rows[0]?.[1] ?? 1;
  let body = "";
  rows.forEach(([flag, count], i) => {
    const y = mT + i * rowH;
    const w = (count / maxV) * plotW;
    body += `<text x="${mL - 14}" y="${y + 22}" fill="${FG}" font-size="16" text-anchor="end" font-family="${FONT}">${esc(flag)}</text>`;
    body += `<rect x="${mL}" y="${y + 6}" width="${w.toFixed(1)}" height="24" rx="4" fill="${i < 3 ? ACCENT : "#71717a"}"/>`;
    body += `<text x="${mL + w + 10}" y="${y + 23}" fill="${MUTED}" font-size="15">${fmt(count)} (${pct(count, of)})</text>`;
  });
  write("red-flags.svg", svgDoc(W, H, `Red-flag prevalence across ${fmt(of)} accounts`, `share of accounts triggering each deterministic red flag; one account can trigger several`, body));
}

// ---------- 3. account age vs score ----------
{
  const rows: { age: number; n: number; median: number }[] = d.age_vs_score;
  const W = 1160, H = 540, mL = 66, mR = 30, mT = 84, mB = 78;
  const plotW = W - mL - mR, plotH = H - mT - mB;
  const bw = plotW / rows.length;
  let body = "";
  for (const g of [20, 40, 60, 80]) {
    const y = mT + plotH - (g / 100) * plotH;
    body += `<line x1="${mL}" y1="${y}" x2="${W - mR}" y2="${y}" stroke="${FAINT}" stroke-width="1" stroke-dasharray="3 5"/>`;
    body += `<text x="${mL - 10}" y="${y + 5}" fill="${MUTED}" font-size="14" text-anchor="end">${g}</text>`;
  }
  rows.forEach((r, i) => {
    const h = (r.median / 100) * plotH;
    const x = mL + i * bw + 6;
    body += `<rect x="${x.toFixed(1)}" y="${(mT + plotH - h).toFixed(1)}" width="${(bw - 12).toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${ACCENT}" opacity="${0.45 + 0.055 * i}"/>`;
    body += `<text x="${(x + (bw - 12) / 2).toFixed(1)}" y="${(mT + plotH - h - 10).toFixed(1)}" fill="${FG}" font-size="15" text-anchor="middle">${r.median.toFixed(0)}</text>`;
    body += `<text x="${(x + (bw - 12) / 2).toFixed(1)}" y="${mT + plotH + 26}" fill="${MUTED}" font-size="14" text-anchor="middle">${r.age === 10 ? "10+" : r.age}</text>`;
  });
  body += `<text x="${W - mR}" y="${mT + plotH + 52}" fill="${MUTED}" font-size="15" text-anchor="end">account age (years) →</text>`;
  write("age-vs-score.svg", svgDoc(W, H, "Median score by account age", `median final score per account-age bucket`, body));
}

// ---------- 4. languages of high scorers ----------
{
  const rows: { language: string; devs: number }[] = d.languages_top_score_gte60.slice(0, 12);
  const W = 1160, rowH = 40, mT = 84, mB = 60, mL = 200, mR = 110;
  const H = mT + rows.length * rowH + mB;
  const plotW = W - mL - mR;
  const maxV = rows[0]?.devs ?? 1;
  let body = "";
  rows.forEach((r, i) => {
    const y = mT + i * rowH;
    const w = (r.devs / maxV) * plotW;
    body += `<text x="${mL - 14}" y="${y + 22}" fill="${FG}" font-size="16" text-anchor="end">${esc(r.language)}</text>`;
    body += `<rect x="${mL}" y="${y + 6}" width="${w.toFixed(1)}" height="24" rx="4" fill="${i === 0 ? ACCENT : "#f97316"}" opacity="${1 - i * 0.055}"/>`;
    body += `<text x="${mL + w + 10}" y="${y + 23}" fill="${MUTED}" font-size="15">${fmt(r.devs)}</text>`;
  });
  write("languages.svg", svgDoc(W, H, "What high scorers write (score ≥ 60)", `primary languages among accounts scoring 60+; one dev can count toward several`, body));
}

// ---------- 5. spam score histogram ----------
{
  const hist: Record<string, number> = d.stored_bot_score.histogram_bucket1;
  const of = d.stored_bot_score.with_value;
  const buckets = Array.from({ length: 10 }, (_, i) => i);
  const values = buckets.map((b) => hist[b] ?? 0);
  const maxV = Math.max(...values, 1);
  const W = 1160, H = 560, mL = 66, mR = 30, mT = 84, mB = 78;
  const plotW = W - mL - mR, plotH = H - mT - mB;
  const bw = plotW / buckets.length;
  // log scale: the 0-bucket dwarfs everything and the story is in the tail.
  const scale = (v: number) => (v <= 0 ? 0 : Math.log10(v + 1) / Math.log10(maxV + 1));
  let body = "";
  values.forEach((v, i) => {
    const h = scale(v) * plotH;
    const x = mL + i * bw + 4;
    const col = i >= 7 ? "#dc2626" : i >= 3 ? ACCENT : "#71717a";
    body += `<rect x="${x.toFixed(1)}" y="${(mT + plotH - h).toFixed(1)}" width="${(bw - 8).toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${col}"/>`;
    body += `<text x="${(x + (bw - 8) / 2).toFixed(1)}" y="${(mT + plotH - h - 8).toFixed(1)}" fill="${MUTED}" font-size="14" text-anchor="middle">${fmt(v)}</text>`;
    body += `<text x="${(x + (bw - 8) / 2).toFixed(1)}" y="${mT + plotH + 26}" fill="${MUTED}" font-size="15" text-anchor="middle">${i}</text>`;
  });
  body += `<text x="${W - mR}" y="${mT + plotH + 52}" fill="${MUTED}" font-size="15" text-anchor="end">hidden spam score (0 = clean, 10 = heavy farming) →</text>`;
  write("spam-score.svg", svgDoc(W, H, `The hidden spam score we never show anyone`, `n = ${of.toLocaleString()} accounts; log-scale y axis — the tail is the story`, body));
}

console.error("done");
process.exit(0);
