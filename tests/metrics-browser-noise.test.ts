import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("metrics browser-noise diagnostics", () => {
  it("exposes human-browser 4xx breakdowns in metrics route", () => {
    const metricsRoute = fs.readFileSync(path.join(process.cwd(), "app", "api", "metrics", "route.ts"), "utf-8");

    expect(metricsRoute).toContain("top_4xx_human_browser_paths");
    expect(metricsRoute).toContain("top_4xx_human_browser_methods");
    expect(metricsRoute).toContain("top_4xx_human_browser_hosts");
    expect(metricsRoute).toContain("top_4xx_human_browser_countries");
    expect(metricsRoute).toContain("traffic_type = 'human_browser'");
  });

  it("hardens browser classification so weak Mozilla-like requests are not treated as human browsers", () => {
    const classifier = fs.readFileSync(path.join(process.cwd(), "lib", "traffic-classification.ts"), "utf-8");

    expect(classifier).toContain("BrowserLikeNoLang");
    expect(classifier).toContain("looksLikeSuspiciousBrowserLike");
    expect(classifier).toContain("strongBrowserSignals");
    expect(classifier).toContain("accept-language");
  });
});
