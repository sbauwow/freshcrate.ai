import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("discovery flow locale coverage", () => {
  it("stores bilingual copy for browse, search, tag, and project discovery surfaces", () => {
    const i18n = fs.readFileSync(path.join(process.cwd(), "lib", "i18n.ts"), "utf-8");

    expect(i18n).toContain('searchTipsExamples');
    expect(i18n).toContain('descriptionHeading');
    expect(i18n).toContain('releaseHistory');
    expect(i18n).toContain('dependencyAudit');
    expect(i18n).toContain('githubStats');
    expect(i18n).toContain('links');
    expect(i18n).toContain('欢迎联系 Freshcrate 团队');
    expect(i18n).toContain('发布历史');
    expect(i18n).toContain('依赖与许可证审计');
  });

  it("routes visible discovery-page labels through locale copy instead of hardcoded english", () => {
    const searchPage = fs.readFileSync(path.join(process.cwd(), "app", "search", "page.tsx"), "utf-8");
    const projectPage = fs.readFileSync(path.join(process.cwd(), "app", "projects", "[name]", "page.tsx"), "utf-8");

    expect(searchPage).toContain('const tips = t.searchTipsExamples;');
    expect(searchPage).toContain('tips.packageName');
    expect(searchPage).toContain('tips.tag');
    expect(searchPage).toContain('t.byAuthor');
    expect(searchPage).toContain('t.inCategory');

    expect(projectPage).toContain('t.home');
    expect(projectPage).toContain('t.descriptionHeading');
    expect(projectPage).toContain('t.releaseHistory');
    expect(projectPage).toContain('t.dependencyAudit');
    expect(projectPage).toContain('t.githubStats');
    expect(projectPage).toContain('t.links');
    expect(projectPage).toContain('t.sourceCode');
    expect(projectPage).toContain('t.homepage');
  });
});
