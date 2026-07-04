import {
  getCircleEmailTargetsForMember,
  getCircleEmailTargetsForSubscriber,
  getUnsubscribeToken,
  markCircleEmailRecommendationSent,
  type CircleEmailRecommendationTarget,
} from "@/lib/db";
import { SITE_URL } from "@/lib/site";

interface CircleEmailMatch {
  login: string;
  matchedFacets: string[];
}

function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

function subject(matchCount: number): string {
  return matchCount > 1
    ? `ghsphere 找到 ${matchCount} 个可能适合你的圈子成员`
    : "ghsphere 找到一个可能适合你的圈子成员";
}

function textBody(matches: CircleEmailMatch[], unsubscribeUrl: string): string {
  const lines = matches.map((match) => {
    const facets = match.matchedFacets.length > 0 ? `（共同标签：${match.matchedFacets.join(", ")}）` : "";
    return `- @${match.login} ${SITE_URL}/u/${match.login} ${facets}`;
  });
  return [
    "你在 ghsphere 锐评时授权参与圈子关联，我们找到了可能适合你认识的开发者：",
    "",
    ...lines,
    "",
    `取消订阅：${unsubscribeUrl}`,
  ].join("\n");
}

function htmlBody(matches: CircleEmailMatch[], unsubscribeUrl: string): string {
  const items = matches
    .map((match) => {
      const facets =
        match.matchedFacets.length > 0
          ? `<div style="color:#64748b;font-size:13px;">共同标签：${match.matchedFacets.join(", ")}</div>`
          : "";
      return `<li style="margin:12px 0;"><a href="${SITE_URL}/u/${match.login}" style="color:#059669;font-weight:700;">@${match.login}</a>${facets}</li>`;
    })
    .join("");
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.6;color:#111827;">
    <p>你在 ghsphere 锐评时授权参与圈子关联，我们找到了可能适合你认识的开发者：</p>
    <ul>${items}</ul>
    <p style="color:#64748b;font-size:13px;"><a href="${unsubscribeUrl}" style="color:#64748b;">取消订阅</a></p>
  </div>`;
}

async function sendRecommendationEmail(
  to: string,
  matches: CircleEmailMatch[],
  unsubscribeUrl: string,
): Promise<boolean> {
  if (!emailConfigured() || matches.length === 0) return false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to,
        subject: subject(matches.length),
        text: textBody(matches, unsubscribeUrl),
        html: htmlBody(matches, unsubscribeUrl),
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    });
    if (!response.ok) {
      console.error("circle recommendation email failed:", response.status);
      return false;
    }
    return true;
  } catch (e) {
    console.error("circle recommendation email failed:", e);
    return false;
  }
}

function groupTargets(targets: CircleEmailRecommendationTarget[]) {
  const grouped = new Map<string, { emailHash: string; email: string; matches: CircleEmailMatch[] }>();
  for (const target of targets) {
    const existing =
      grouped.get(target.emailHash) ??
      { emailHash: target.emailHash, email: target.email, matches: [] };
    existing.matches.push({
      login: target.username,
      matchedFacets: target.matchedFacets.slice(0, 5),
    });
    grouped.set(target.emailHash, existing);
  }
  return [...grouped.values()];
}

async function sendGroupedTargets(targets: CircleEmailRecommendationTarget[]) {
  if (!emailConfigured()) return;
  for (const group of groupTargets(targets)) {
    const token = await getUnsubscribeToken(group.emailHash);
    const unsubscribeUrl = token
      ? `${SITE_URL}/api/community/unsubscribe?token=${token}`
      : `${SITE_URL}/api/community/unsubscribe`;
    const sent = await sendRecommendationEmail(group.email, group.matches.slice(0, 6), unsubscribeUrl);
    if (!sent) continue;
    for (const match of group.matches) {
      await markCircleEmailRecommendationSent(group.emailHash, match.login);
    }
  }
}

/** Notify email subscribers when a public community member appears. */
export async function notifyCircleSubscribersForMember(memberLogin: string): Promise<void> {
  const targets = await getCircleEmailTargetsForMember(memberLogin, 25);
  await sendGroupedTargets(targets);
}

/** Notify the just-subscribed email owner about existing public members. */
export async function notifyCircleSubscriber(username: string): Promise<void> {
  const targets = await getCircleEmailTargetsForSubscriber(username, 6);
  await sendGroupedTargets(targets);
}
