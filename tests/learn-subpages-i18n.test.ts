import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("learn subpage locale coverage", () => {
  it("stores bilingual copy for learn detail and glossary chrome", () => {
    const i18n = fs.readFileSync(path.join(process.cwd(), "lib", "i18n.ts"), "utf-8");

    expect(i18n).toContain("learnDetailPage");
    expect(i18n).toContain("glossaryPage");
    expect(i18n).toContain("Prerequisites");
    expect(i18n).toContain("先修内容");
  });

  it("routes learn detail and glossary ui labels through locale copy", () => {
    const cratePage = fs.readFileSync(path.join(process.cwd(), "app", "learn", "[slug]", "page.tsx"), "utf-8");
    const glossaryPage = fs.readFileSync(path.join(process.cwd(), "app", "learn", "glossary", "page.tsx"), "utf-8");

    expect(cratePage).toContain("getCopy(locale).learnDetailPage");
    expect(cratePage).toContain("t.prerequisites");
    expect(cratePage).toContain("t.thinkAboutIt");
    expect(cratePage).toContain("t.tryThis");
    expect(cratePage).toContain("t.goDeeper");
    expect(cratePage).toContain("t.funFact");

    expect(glossaryPage).toContain("getCopy(locale).glossaryPage");
    expect(glossaryPage).toContain("t.title");
    expect(glossaryPage).toContain("t.backToMiniCrates");
  });
});
