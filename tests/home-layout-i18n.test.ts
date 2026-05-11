import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("home + layout locale coverage", () => {
  it("stores bilingual copy for homepage controls and footer labels", () => {
    const i18n = fs.readFileSync(path.join(process.cwd(), "lib", "i18n.ts"), "utf-8");

    expect(i18n).toContain("latestReleases");
    expect(i18n).toContain("packagesIndexed");
    expect(i18n).toContain("sortRecommended");
    expect(i18n).toContain("showingResults");
    expect(i18n).toContain("footerBadge");
    expect(i18n).toContain("footerPrivacy");
    expect(i18n).toContain("最新发布");
    expect(i18n).toContain("freshmeat 已死");
  });

  it("routes homepage filters and shared footer through locale copy", () => {
    const homePage = fs.readFileSync(path.join(process.cwd(), "app", "page.tsx"), "utf-8");
    const layout = fs.readFileSync(path.join(process.cwd(), "app", "layout.tsx"), "utf-8");

    expect(homePage).toContain("const homeT = t.home;");
    expect(homePage).toContain("homeT.latestReleases");
    expect(homePage).toContain("homeT.sortRecommended");
    expect(homePage).toContain("homeT.showingResults.replace");
    expect(homePage).toContain("homeT.noReleases");

    expect(layout).toContain("t.footerBadge");
    expect(layout).toContain("t.footerSubmit");
    expect(layout).toContain("t.footerLearn");
    expect(layout).toContain("t.footerPrivacy");
    expect(layout).toContain("t.footerTerms");
  });
});
