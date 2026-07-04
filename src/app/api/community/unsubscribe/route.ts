import { NextRequest, NextResponse } from "next/server";
import { unsubscribeByToken } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const confirmHtml = (token: string) => `<!DOCTYPE html>
<html lang="zh">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>取消订阅</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:60px auto;padding:0 20px;color:#111827}
h2{font-size:1.25rem;margin-bottom:1rem}p{color:#374151;line-height:1.6}
button{background:#dc2626;color:#fff;border:none;padding:10px 24px;border-radius:6px;font-size:1rem;cursor:pointer}
button:hover{background:#b91c1c}</style></head>
<body>
<h2>取消订阅 ghsphere 圈子推荐</h2>
<p>点击下方按钮后，你将不再收到来自 ghsphere 的圈子推荐邮件。</p>
<form method="POST" action="/api/community/unsubscribe?token=${encodeURIComponent(token)}">
  <button type="submit">确认取消订阅</button>
</form>
</body></html>`;

const doneHtml = `<!DOCTYPE html>
<html lang="zh">
<head><meta charset="utf-8"><title>已取消订阅</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:60px auto;padding:0 20px;color:#111827}
h2{font-size:1.25rem}p{color:#374151;line-height:1.6}</style></head>
<body><h2>已取消订阅</h2><p>你将不再收到来自 ghsphere 圈子的推荐邮件。</p></body></html>`;

const errorHtml = (msg: string) => `<!DOCTYPE html>
<html lang="zh">
<head><meta charset="utf-8"><title>错误</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:60px auto;padding:0 20px;color:#111827}
p{color:#374151}</style></head>
<body><p>${msg}</p></body></html>`;

const HTML = "text/html; charset=utf-8";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!token) {
    return new NextResponse(errorHtml("无效的取消订阅链接。"), { status: 400, headers: { "Content-Type": HTML } });
  }
  return new NextResponse(confirmHtml(token), { status: 200, headers: { "Content-Type": HTML } });
}

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!token) {
    return new NextResponse(errorHtml("无效的取消订阅链接。"), { status: 400, headers: { "Content-Type": HTML } });
  }
  const ok = await unsubscribeByToken(token);
  if (!ok) {
    return new NextResponse(errorHtml("链接无效或已取消订阅。"), { status: 404, headers: { "Content-Type": HTML } });
  }
  return new NextResponse(doneHtml, { status: 200, headers: { "Content-Type": HTML } });
}
