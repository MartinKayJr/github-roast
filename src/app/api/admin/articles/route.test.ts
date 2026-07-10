import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type SaveArticleInput = {
  kind: "blog" | "vulnerability";
  slug: string;
  status: "draft" | "published";
  tags: string[];
  authorLogin: string;
  titleZh: string;
  descriptionZh: string;
  bodyZh: string;
  titleEn: string;
  descriptionEn: string;
  bodyEn: string;
};

const mocks = vi.hoisted(() => ({
  createAdminArticle: vi.fn(),
  getAdminAccess: vi.fn(),
  listAdminArticles: vi.fn(),
  updateAdminArticle: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({
  getAdminAccess: mocks.getAdminAccess,
}));

vi.mock("@/lib/db", () => ({
  createAdminArticle: mocks.createAdminArticle,
  listAdminArticles: mocks.listAdminArticles,
  updateAdminArticle: mocks.updateAdminArticle,
}));

import { POST } from "./route";

const payload: Omit<SaveArticleInput, "authorLogin"> & { authorLogin?: string } = {
  kind: "blog",
  slug: "research-note",
  status: "published",
  tags: ["security", "research"],
  titleZh: "研究笔记",
  descriptionZh: "中文摘要",
  bodyZh: "中文正文",
  titleEn: "Research note",
  descriptionEn: "English summary",
  bodyEn: "English body",
};

function postRequest(body: string) {
  return new NextRequest("https://example.test/api/admin/articles", {
    method: "POST",
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAdminAccess.mockResolvedValue({
    ok: true,
    session: { user: { login: "AdminEditor" } },
  });
  mocks.listAdminArticles.mockResolvedValue([]);
  mocks.createAdminArticle.mockImplementation(async (input: SaveArticleInput) => ({
    id: "article-1",
    ...input,
  }));
});

describe("admin articles API", () => {
  it("returns 401 when no administrator session is available", async () => {
    mocks.getAdminAccess.mockResolvedValue({ ok: false, reason: "unauthorized" });

    const response = await POST(postRequest(JSON.stringify(payload)));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(mocks.listAdminArticles).not.toHaveBeenCalled();
    expect(mocks.createAdminArticle).not.toHaveBeenCalled();
  });

  it("returns 403 for a signed-in user without administrator access", async () => {
    mocks.getAdminAccess.mockResolvedValue({ ok: false, reason: "forbidden" });

    const response = await POST(postRequest(JSON.stringify(payload)));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "forbidden" });
    expect(mocks.createAdminArticle).not.toHaveBeenCalled();
  });

  it("uses the administrator session identity instead of a client supplied author", async () => {
    const response = await POST(
      postRequest(JSON.stringify({ ...payload, authorLogin: "forged-author" })),
    );

    expect(response.status).toBe(200);
    expect(mocks.listAdminArticles).toHaveBeenCalledWith();
    expect(mocks.createAdminArticle).toHaveBeenCalledWith({
      ...payload,
      authorLogin: "AdminEditor",
    });
  });

  it("rejects malformed request JSON before attempting an article write", async () => {
    const response = await POST(postRequest("{"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_request" });
    expect(mocks.listAdminArticles).not.toHaveBeenCalled();
    expect(mocks.createAdminArticle).not.toHaveBeenCalled();
  });

  it("rejects a duplicate slug during the preflight check", async () => {
    mocks.listAdminArticles.mockResolvedValue([{ id: "existing", slug: payload.slug }]);

    const response = await POST(postRequest(JSON.stringify(payload)));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "duplicate_slug" });
    expect(mocks.createAdminArticle).not.toHaveBeenCalled();
  });
});
