import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("search / browse / author engagement slice", () => {
  it("adds stronger search continuation modules and tracked pivots", () => {
    const page = fs.readFileSync(path.join(process.cwd(), "app", "search", "page.tsx"), "utf8");

    expect(page).toContain("Suggested paths");
    expect(page).toContain("Continue exploring");
    expect(page).toContain("search:continue:tag:");
    expect(page).toContain("search:continue:author:");
    expect(page).toContain("search:continue:category:");
    expect(page).toContain("/learn/best-mcp-servers-for-claude-code");
    expect(page).toContain("/compare/langgraph-vs-crewai-vs-autogen");
  });

  it("turns browse into a tracked hub with guide rails and pivot links", () => {
    const page = fs.readFileSync(path.join(process.cwd(), "app", "browse", "page.tsx"), "utf8");

    expect(page).toContain("Popular categories for first-time visitors");
    expect(page).toContain("Guide for this category");
    expect(page).toContain("browse:category:");
    expect(page).toContain("browse:project:");
    expect(page).toContain("browse:tag:");
    expect(page).toContain("browse:guide:");
    expect(page).toContain("TrackedLink");
  });

  it("upgrades author pages with tracked related pivots and next-click modules", () => {
    const page = fs.readFileSync(path.join(process.cwd(), "app", "author", "[name]", "page.tsx"), "utf8");

    expect(page).toContain("Related paths");
    expect(page).toContain("Top tags");
    expect(page).toContain("Top categories");
    expect(page).toContain("author:");
    expect(page).toContain("->tag:");
    expect(page).toContain("->category:");
    expect(page).toContain("TrackedLink");
  });
});
