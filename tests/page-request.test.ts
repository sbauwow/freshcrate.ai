import { describe, expect, it } from "vitest";
import { shouldRecordPageStatus } from "@/lib/page-request";

describe("shouldRecordPageStatus", () => {
  it("skips HEAD 404 page status rows", () => {
    expect(shouldRecordPageStatus("HEAD", 404)).toBe(false);
  });

  it("keeps GET 404 page status rows from the layout path", () => {
    expect(shouldRecordPageStatus("GET", 404)).toBe(true);
  });

  it("keeps HEAD 200 baseline page rows", () => {
    expect(shouldRecordPageStatus("HEAD", 200)).toBe(true);
  });

  it("skips not-found server rows to avoid bogus page-route 4xx inflation", () => {
    expect(shouldRecordPageStatus("GET", 404, "not-found")).toBe(false);
  });
});
