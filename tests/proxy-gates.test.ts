import { describe, expect, it } from "vitest";
import { shouldReturnGone } from "@/proxy";

describe("proxy gone-path gates", () => {
  it("returns gone for phantom project docs paths", () => {
    expect(shouldReturnGone("/projects/foo/docs/readme")).toBe(true);
    expect(shouldReturnGone("/projects/foo/.github/workflows/ci.yml")).toBe(true);
    expect(shouldReturnGone("/projects/foo/README-install")).toBe(true);
  });

  it("returns gone for hostile scanner probe paths", () => {
    expect(shouldReturnGone("/.env")).toBe(true);
    expect(shouldReturnGone("/.env.production")).toBe(true);
    expect(shouldReturnGone("/.git/config")).toBe(true);
    expect(shouldReturnGone("/wp-admin/install.php")).toBe(true);
    expect(shouldReturnGone("/wp-login.php")).toBe(true);
    expect(shouldReturnGone("/xmlrpc.php")).toBe(true);
    expect(shouldReturnGone("/adminer.php")).toBe(true);
  });

  it("does not catch legitimate app routes", () => {
    expect(shouldReturnGone("/")).toBe(false);
    expect(shouldReturnGone("/browse")).toBe(false);
    expect(shouldReturnGone("/search")).toBe(false);
    expect(shouldReturnGone("/projects/jcodemunch-mcp")).toBe(false);
    expect(shouldReturnGone("/projects/foo.md")).toBe(false);
  });
});
