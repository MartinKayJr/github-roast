import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArticleComment } from "@/lib/articles";

type CreateArticleCommentInput = {
  articleId: string;
  authorGithubId: number;
  authorLogin: string;
  authorAvatarUrl: string | null;
  body: string;
};

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  authConfigured: vi.fn(() => true),
  createArticleComment: vi.fn(),
  getArticleComments: vi.fn(),
  getPublishedArticleById: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
  authConfigured: mocks.authConfigured,
}));

vi.mock("@/lib/db", () => ({
  createArticleComment: mocks.createArticleComment,
  getArticleComments: mocks.getArticleComments,
  getPublishedArticleById: mocks.getPublishedArticleById,
}));

import { GET, POST } from "./route";

const articleId = "8a9b0c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d";
const context = { params: Promise.resolve({ articleId }) };

const storedComment: ArticleComment = {
  id: "comment-1",
  articleId,
  author: {
    githubId: 42,
    login: "serverauthor",
    avatarUrl: "https://avatars.githubusercontent.com/u/42",
  },
  body: "Useful evidence",
  createdAt: 1_700_000_000_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authConfigured.mockReturnValue(true);
  mocks.auth.mockResolvedValue({
    user: {
      githubId: 42,
      image: "https://avatars.githubusercontent.com/u/42",
      login: "ServerAuthor",
    },
  });
  mocks.createArticleComment.mockImplementation(async (input: CreateArticleCommentInput) => ({
    ...storedComment,
    articleId: input.articleId,
    author: {
      githubId: input.authorGithubId,
      login: input.authorLogin,
      avatarUrl: input.authorAvatarUrl,
    },
    body: input.body,
  }));
  mocks.getArticleComments.mockResolvedValue([storedComment]);
  mocks.getPublishedArticleById.mockResolvedValue({ id: articleId });
});

describe("article comments API", () => {
  it("stores an authenticated comment with identity derived from the server session", async () => {
    const response = await POST(
      new NextRequest(`https://example.test/api/articles/${articleId}/comments`, {
        method: "POST",
        body: JSON.stringify({
          body: "  Useful\n evidence  ",
          authorGithubId: 999,
          authorLogin: "forged-author",
        }),
      }),
      context,
    );

    expect(response.status).toBe(201);
    expect(mocks.createArticleComment).toHaveBeenCalledWith({
      articleId,
      authorGithubId: 42,
      authorLogin: "serverauthor",
      authorAvatarUrl: "https://avatars.githubusercontent.com/u/42",
      body: "Useful evidence",
    });
    await expect(response.json()).resolves.toEqual({ comment: storedComment });
  });

  it("requires an authenticated GitHub session before creating a comment", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await POST(
      new NextRequest(`https://example.test/api/articles/${articleId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: "Needs a login" }),
      }),
      context,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "authentication_required" });
    expect(mocks.createArticleComment).not.toHaveBeenCalled();
  });

  it("rejects malformed request JSON", async () => {
    const response = await POST(
      new NextRequest(`https://example.test/api/articles/${articleId}/comments`, {
        method: "POST",
        body: "{",
      }),
      context,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_body" });
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.createArticleComment).not.toHaveBeenCalled();
  });

  it("returns not found when comments are submitted to a no-longer-public article", async () => {
    mocks.createArticleComment.mockResolvedValue(null);
    mocks.getPublishedArticleById.mockResolvedValue(null);

    const response = await POST(
      new NextRequest(`https://example.test/api/articles/${articleId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: "Race with article removal" }),
      }),
      context,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
  });

  it("reports comment persistence unavailability for an existing public article", async () => {
    mocks.createArticleComment.mockResolvedValue(null);

    const response = await POST(
      new NextRequest(`https://example.test/api/articles/${articleId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: "Persistence is unavailable" }),
      }),
      context,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "comments_unavailable" });
  });

  it("returns comments for a public article", async () => {
    const response = await GET(
      new NextRequest(`https://example.test/api/articles/${articleId}/comments`),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.getPublishedArticleById).toHaveBeenCalledWith(articleId);
    expect(mocks.getArticleComments).toHaveBeenCalledWith(articleId);
    await expect(response.json()).resolves.toEqual({ comments: [storedComment] });
  });

  it("does not expose comments for a missing public article", async () => {
    mocks.getPublishedArticleById.mockResolvedValue(null);

    const response = await GET(
      new NextRequest(`https://example.test/api/articles/${articleId}/comments`),
      context,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
    expect(mocks.getArticleComments).not.toHaveBeenCalled();
  });
});
