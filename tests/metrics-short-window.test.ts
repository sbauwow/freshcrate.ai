import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("metrics short-window analytics", () => {
  it("exposes traffic_1h and traffic_since_boot windows in the metrics route", () => {
    const routePath = path.join(process.cwd(), "app", "api", "metrics", "route.ts");
    const route = fs.readFileSync(routePath, "utf8");

    expect(route).toContain("traffic_1h");
    expect(route).toContain("traffic_since_boot");
    expect(route).toContain("getTrafficWindowSummary(db, 1 / 24)");
    expect(route).toContain("getTrafficWindowSummary(db, uptimeSeconds / 86400)");
  });
});
