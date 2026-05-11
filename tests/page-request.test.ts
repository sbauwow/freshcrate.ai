import { describe, expect, it } from "vitest";
import { shouldRecordPageStatus } from "@/lib/page-request";

describe("shouldRecordPageStatus", () => {
  it("skips HEAD 404 page status rows", () => {
    expect(shouldRecordPageStatus("HEAD", 404)).toBe(false);
  });

  it("keeps GET 404 page status rows", () => {
    expect(shouldRecordPageStatus("GET", 404)).toBe(true);
  });

  it("keeps HEAD 200 baseline page rows", () => {
    expect(shouldRecordPageStatus("HEAD", 200)).toBe(true);
  });
});
