import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("minimal Ubuntu rootfs lane", () => {
  it("exposes a package.json command for building the minimal rootfs", () => {
    const packageJson = fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8");
    expect(packageJson).toContain("image:build:rootfs");
    expect(packageJson).toContain("build-agent-edition-rootfs.sh");
  });

  it("ships a rootfs builder script that targets Ubuntu Noble with mmdebstrap or debootstrap", () => {
    const script = fs.readFileSync(path.join(process.cwd(), "scripts", "build-agent-edition-rootfs.sh"), "utf8");
    expect(script).toContain("ubuntu-24.04-rootfs");
    expect(script).toContain("noble");
    expect(script).toContain("main universe");
    expect(script).toMatch(/mmdebstrap|debootstrap/);
    expect(script).toContain("package-manifest.txt");
    expect(script).toContain("image-build-receipt.txt");
    expect(script).toContain("prepare_output_dir()");
    expect(script).toContain("output dir is not writable");
    expect(script).toContain("rootfs dir is not writable");
    expect(script).toContain('"${SUDO_PREFIX[@]}" rm -f "$MANIFEST_PATH" "$RECEIPT_PATH" "$ROOTFS_TARBALL"');
    expect(script).toContain('"${SUDO_PREFIX[@]}" rm -rf "$ROOTFS_DIR"');
    expect(script).toContain('SUDO_PREFIX=(sudo)');
    expect(script).toContain('MMDEBSTRAP_MODE=(--mode=unshare)');
    expect(script).toContain('ROOTFS_TARBALL="${OUTPUT_DIR}/rootfs.tar"');
    expect(script).toContain('tar --exclude=\'./dev/*\' -xf "$ROOTFS_TARBALL" -C "$ROOTFS_DIR"');
    expect(script).toContain('if command -v uv >/dev/null 2>&1; then');
    expect(script).toContain('cp "$(command -v uv)" "$ROOTFS_DIR/usr/local/bin/uv"');
  });

  it("ships a shared helper for rootfs package tiers and manifest generation", () => {
    const helper = fs.readFileSync(path.join(process.cwd(), "scripts", "lib", "rootfs-common.sh"), "utf8");
    expect(helper).toContain("rootfs_base_packages");
    expect(helper).toContain("udev");
    expect(helper).toContain("kmod");
    expect(helper).toContain("rootfs_overlay_packages");
    expect(helper).toContain("package-manifest.txt");
  });

  it("splits required core packages from optional overlay packages in bootstrap-common", () => {
    const helper = fs.readFileSync(path.join(process.cwd(), "scripts", "lib", "bootstrap-common.sh"), "utf8");
    expect(helper).toContain("bundle_core_packages()");
    expect(helper).toContain("bundle_overlay_packages()");
    expect(helper).toContain("docker");
  });

  it("skips redundant apt installs during bootstrap when the rootfs already contains the core toolchain", () => {
    const script = fs.readFileSync(path.join(process.cwd(), "scripts", "bootstrap-agent-edition.sh"), "utf8");
    expect(script).toContain("core_stack_ready=1");
    expect(script).toContain("skipping apt package installation");
    expect(script).toContain("installing uv");
  });
});
