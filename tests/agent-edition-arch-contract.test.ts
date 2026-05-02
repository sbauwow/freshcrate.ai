import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("agent edition arch contract", () => {
  it("allows x86_64 and aarch64 in bootstrap script", () => {
    const script = fs.readFileSync(path.join(process.cwd(), "scripts", "bootstrap-agent-edition.sh"), "utf8");
    expect(script).toContain("x86_64|aarch64");
    expect(script).toContain("supports x86_64 and aarch64 only");
  });

  it("accepts x86_64 and aarch64 in verify script", () => {
    const script = fs.readFileSync(path.join(process.cwd(), "scripts", "verify-agent-edition.sh"), "utf8");
    expect(script).toContain('x86_64) pass "arch is x86_64"');
    expect(script).toContain('aarch64) pass "arch is aarch64"');
  });
});
