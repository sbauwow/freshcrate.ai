import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("iso image lane", () => {
  it("ships a github workflow to build, upload, and release the ISO artifact", () => {
    const workflowPath = path.join(process.cwd(), ".github", "workflows", "build-agent-edition-iso-image.yml");
    expect(fs.existsSync(workflowPath)).toBe(true);
    const workflow = fs.readFileSync(workflowPath, "utf8");
    expect(workflow).toContain("iso-autoinstall-headless");
    expect(workflow).toContain("build-agent-edition-iso.sh");
    expect(workflow).toContain("upload-artifact");
    expect(workflow).toContain("gh release create");
    expect(workflow).toContain("agent-edition-iso-latest");
    expect(workflow).toContain("freshcrate-solo-builder-core-stable.iso");
  });

  it("ships cloud-init/autoinstall seed files for the ISO lane", () => {
    expect(fs.existsSync(path.join(process.cwd(), "images", "cloud-init", "iso-autoinstall-headless", "meta-data"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "images", "cloud-init", "iso-autoinstall-headless", "user-data"))).toBe(true);
  });

  it("ships an ISO build script that remasters Ubuntu live-server media with autoinstall nocloud data", () => {
    const script = fs.readFileSync(path.join(process.cwd(), "scripts", "build-agent-edition-iso.sh"), "utf8");
    expect(script).toContain("ubuntu-24.04-live-server-amd64.iso");
    expect(script).toContain("nocloud");
    expect(script).toContain("xorriso");
    expect(script).toContain("freshcrate-solo-builder-core-stable.iso");
  });

  it("exposes package.json commands for the ISO image lane", () => {
    const packageJson = fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8");
    expect(packageJson).toContain("image:build:iso");
    expect(packageJson).toContain("image:smoke:iso");
    expect(packageJson).toContain("image:verify:iso");
  });

  it("initializes packer plugins and passes only lane-specific vars during template validation", () => {
    const scriptPath = path.join(process.cwd(), "scripts", "validate-agent-edition-templates.sh");
    expect(fs.existsSync(scriptPath)).toBe(true);
    const script = fs.readFileSync(scriptPath, "utf8");
    expect(script).toContain("command -v packer");
    expect(script).toContain('packer init "$template" >/dev/null');
    expect(script).toContain('if [[ "${template##*/}" == "aws-ami-builder.pkr.hcl" ]]; then');
    expect(script).toContain("PACKER_VALIDATE_ARGS+=( -var 'region=us-east-1' )");
    expect(script).toContain("packer validate");
  });

  it("ships a qemu smoke test script for BIOS and UEFI boot validation", () => {
    const scriptPath = path.join(process.cwd(), "scripts", "qemu-smoke-test-agent-edition-iso.sh");
    expect(fs.existsSync(scriptPath)).toBe(true);
    const script = fs.readFileSync(scriptPath, "utf8");
    expect(script).toContain("qemu-system-x86_64");
    expect(script).toContain("--firmware");
    expect(script).toContain("OVMF");
    expect(script).toContain("freshcrate-solo-builder-core-stable.iso");
  });

  it("ships an end-to-end qemu install verification script with disk inspection and ssh validation", () => {
    const scriptPath = path.join(process.cwd(), "scripts", "qemu-install-verify-agent-edition-iso.sh");
    expect(fs.existsSync(scriptPath)).toBe(true);
    const script = fs.readFileSync(scriptPath, "utf8");
    expect(script).toContain("losetup");
    expect(script).toContain("authorized_keys");
    expect(script).toContain("SSH verification: PASS");
    expect(script).toContain("freshcrate-solo-builder-core-stable.iso");
  });
});
