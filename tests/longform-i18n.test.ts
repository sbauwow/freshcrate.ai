import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("long-form locale coverage", () => {
  it("stores bilingual copy for research, learn, agent edition, orchestra, and legislation pages", () => {
    const i18n = fs.readFileSync(path.join(process.cwd(), "lib", "i18n.ts"), "utf-8");

    expect(i18n).toContain("researchPage");
    expect(i18n).toContain("agentEditionPage");
    expect(i18n).toContain("orchestraPage");
    expect(i18n).toContain("legislationPage");
    expect(i18n).toContain("learnPage");
    expect(i18n).toContain("欢迎来自全球 AI 团队");
    expect(i18n).toContain("AI 法规与治理");
  });

  it("routes visible long-form page labels through locale copy", () => {
    const researchPage = fs.readFileSync(path.join(process.cwd(), "app", "research", "page.tsx"), "utf-8");
    const agentEditionPage = fs.readFileSync(path.join(process.cwd(), "app", "agent-edition", "page.tsx"), "utf-8");
    const orchestraPage = fs.readFileSync(path.join(process.cwd(), "app", "orchestra", "page.tsx"), "utf-8");
    const legislationPage = fs.readFileSync(path.join(process.cwd(), "app", "legislation", "page.tsx"), "utf-8");
    const learnPage = fs.readFileSync(path.join(process.cwd(), "app", "learn", "page.tsx"), "utf-8");

    expect(researchPage).toContain("getCopy(locale).researchPage");
    expect(agentEditionPage).toContain("getCopy(locale).agentEditionPage");
    expect(orchestraPage).toContain("getCopy(locale).orchestraPage");
    expect(legislationPage).toContain("getCopy(locale).legislationPage");
    expect(learnPage).toContain("getCopy(locale).learnPage");
  });
});
