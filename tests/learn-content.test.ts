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
    // Landing-page copy is centralized in the i18n catalog.
    const i18n = fs.readFileSync(path.join(process.cwd(), "lib", "i18n.ts"), "utf8");
    expect(i18n).toContain("11 crates");
  });
});
