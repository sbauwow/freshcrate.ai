import { describe, expect, it } from "vitest";
import { resolveReadmeLinks } from "@/lib/readme-links";

const REPO = "https://github.com/acme/widget";

describe("readme relative link resolution", () => {
  it("rewrites repo-relative hrefs to github blob URLs", () => {
    expect(resolveReadmeLinks('<a href="BENCHMARK.md">bench</a>', REPO)).toBe(
      '<a href="https://github.com/acme/widget/blob/HEAD/BENCHMARK.md">bench</a>',
    );
    expect(resolveReadmeLinks('<a href="./docs/setup.md">setup</a>', REPO)).toContain(
      "blob/HEAD/docs/setup.md",
    );
    expect(resolveReadmeLinks('<a href="/CONTRIBUTING.md">contrib</a>', REPO)).toContain(
      "blob/HEAD/CONTRIBUTING.md",
    );
  });

  it("rewrites relative image srcs to raw.githubusercontent URLs", () => {
    expect(resolveReadmeLinks('<img src="assets/logo.png">', REPO)).toBe(
      '<img src="https://raw.githubusercontent.com/acme/widget/HEAD/assets/logo.png">',
    );
  });

  it("leaves absolute URLs, anchors, and mailto untouched", () => {
    const cases = [
      '<a href="https://example.com/x">x</a>',
      '<a href="//cdn.example.com/x">x</a>',
      '<a href="#usage">usage</a>',
      '<a href="mailto:a@b.c">mail</a>',
    ];
    for (const html of cases) {
      expect(resolveReadmeLinks(html, REPO)).toBe(html);
    }
  });

  it("passes through unchanged when the repo is not on github", () => {
    const html = '<a href="docs/x.md">x</a>';
    expect(resolveReadmeLinks(html, "https://gitlab.com/acme/widget")).toBe(html);
    expect(resolveReadmeLinks(html, "")).toBe(html);
    expect(resolveReadmeLinks(html, null)).toBe(html);
  });

  it("strips .git suffix from the repo url", () => {
    expect(resolveReadmeLinks('<a href="x.md">x</a>', "https://github.com/acme/widget.git")).toContain(
      "github.com/acme/widget/blob/HEAD/x.md",
    );
  });
});
