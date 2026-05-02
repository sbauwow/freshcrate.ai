import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import nextConfig from "../next.config";

describe("next config hygiene", () => {
  it("pins turbopack root to this repo", () => {
    expect(nextConfig.turbopack?.root).toBe(path.join(process.cwd()));
  });

  it("uses proxy.ts instead of middleware.ts", () => {
    expect(fs.existsSync(path.join(process.cwd(), "proxy.ts"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "middleware.ts"))).toBe(false);
  });

  it("ignores heavyweight build output so Tailwind/Turbopack do not scan generated rootfs artifacts", () => {
    const gitignore = fs.readFileSync(path.join(process.cwd(), ".gitignore"), "utf8");
    expect(gitignore).toContain("/output/");
  });

  it("excludes generated output from TypeScript input discovery", () => {
    const tsconfig = fs.readFileSync(path.join(process.cwd(), "tsconfig.json"), "utf8");
    expect(tsconfig).toContain('"exclude": ["node_modules", "output"]');
  });

  it("excludes generated output from Vitest discovery", () => {
    const vitestConfig = fs.readFileSync(path.join(process.cwd(), "vitest.config.ts"), "utf8");
    expect(vitestConfig).toContain('exclude: [...configDefaults.exclude, "output/**"]');
  });

  it("serves the beacon pixel from a web-safe Uint8Array body instead of a Node Buffer", () => {
    const route = fs.readFileSync(path.join(process.cwd(), "app", "api", "beacon", "route.ts"), "utf8");
    expect(route).toContain("const PIXEL = Uint8Array.from(Buffer.from(");
    expect(route).toContain('"Content-Type": "image/gif"');
  });
});
