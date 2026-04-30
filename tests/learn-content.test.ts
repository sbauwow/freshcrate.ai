import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { getAllCrates, getCrate } from "@/lib/learn-content";

describe("learn content", () => {
  it("adds a crate about long-context and when RAG still matters", () => {
    const crate = getCrate("rag-vs-long-context");
    expect(crate).toBeDefined();
    expect(crate?.title).toMatch(/RAG/i);
    expect(crate?.tags).toContain("rag");
    expect(crate?.tags).toContain("long-context");
    expect(crate?.goDeeper.some((item) => /prompt caching/i.test(item.title))).toBe(true);
  });

  it("updates the learn landing page copy for the new crate count", () => {
    expect(getAllCrates()).toHaveLength(11);
    const learnPage = fs.readFileSync(path.join(process.cwd(), "app", "learn", "page.tsx"), "utf8");
    expect(learnPage).toContain("11 crates");
  });
});
