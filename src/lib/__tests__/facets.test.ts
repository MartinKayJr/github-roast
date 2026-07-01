import { describe, expect, it } from "vitest";
import { extractFacets } from "../facets";
import type { TopRepo } from "../types";

function repo(partial: Partial<TopRepo>): TopRepo {
  return {
    name: "r",
    stars: 0,
    forks: 0,
    open_issues: 0,
    size: 0,
    language: null,
    description: null,
    pushed_at: null,
    ...partial,
  };
}

const langs = (facets: ReturnType<typeof extractFacets>) =>
  facets.filter((f) => f.type === "language").map((f) => f.value);
const orgs = (facets: ReturnType<typeof extractFacets>) =>
  facets.filter((f) => f.type === "org").map((f) => f.value);

describe("extractFacets — languages", () => {
  it("ranks primary languages by byte share", () => {
    const facets = extractFacets({
      top_repos: [
        repo({ languages: [{ name: "Rust", size: 80 }, { name: "Go", size: 20 }] }),
      ],
    });
    expect(langs(facets)).toEqual(["Rust", "Go"]);
  });

  it("drops markup/build noise (HTML, CSS, Makefile, …) before ranking", () => {
    const facets = extractFacets({
      top_repos: [
        repo({
          languages: [
            { name: "TypeScript", size: 50 },
            { name: "HTML", size: 30 },
            { name: "CSS", size: 20 },
          ],
        }),
      ],
    });
    expect(langs(facets)).toEqual(["TypeScript"]);
  });

  it("caps at three languages", () => {
    const facets = extractFacets({
      top_repos: [
        repo({
          languages: [
            { name: "A", size: 40 },
            { name: "B", size: 30 },
            { name: "C", size: 20 },
            { name: "D", size: 10 },
          ],
        }),
      ],
    });
    expect(langs(facets)).toHaveLength(3);
  });

  it("keeps the single top language even below the share threshold", () => {
    // Real code is a thin slice; everything else is excluded markup.
    const facets = extractFacets({
      top_repos: [
        repo({
          languages: [
            { name: "HTML", size: 900 },
            { name: "Python", size: 100 },
          ],
        }),
      ],
    });
    // HTML excluded → Python is the only real language, re-normalized to 100%.
    expect(langs(facets)).toEqual(["Python"]);
    expect(facets.find((f) => f.value === "Python")?.weight).toBe(100);
  });

  it("re-normalizes weights over kept languages", () => {
    const facets = extractFacets({
      top_repos: [
        repo({
          languages: [
            { name: "Go", size: 60 },
            { name: "HTML", size: 40 }, // excluded — must not dilute Go's weight
          ],
        }),
      ],
    });
    expect(facets.find((f) => f.value === "Go")?.weight).toBe(100);
  });

  it("returns no language facets when there is no real-code signal", () => {
    const facets = extractFacets({
      top_repos: [repo({ languages: [{ name: "CSS", size: 100 }] })],
    });
    expect(langs(facets)).toEqual([]);
  });
});

describe("extractFacets — orgs", () => {
  it("maps organizations to facets, deduped case-insensitively", () => {
    const facets = extractFacets({
      organizations: ["huggingface", "HuggingFace", "pytorch", "  "],
    });
    expect(orgs(facets)).toEqual(["huggingface", "pytorch"]);
    expect(facets.filter((f) => f.type === "org").every((f) => f.weight === 1)).toBe(true);
  });

  it("caps at five orgs", () => {
    const facets = extractFacets({
      organizations: ["a", "b", "c", "d", "e", "f", "g"],
    });
    expect(orgs(facets)).toHaveLength(5);
  });
});

describe("extractFacets — combined", () => {
  it("returns [] for an empty snapshot", () => {
    expect(extractFacets({})).toEqual([]);
    expect(extractFacets({ top_repos: [], organizations: [] })).toEqual([]);
  });
});
