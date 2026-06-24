import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("salt local-state lane", () => {
  it("ships a local salt bootstrap script and salt tree scaffolding", () => {
    const scriptPath = path.join(process.cwd(), "scripts", "bootstrap-salt-local.sh");
    expect(fs.existsSync(scriptPath)).toBe(true);
    const script = fs.readFileSync(scriptPath, "utf8");
    expect(script).toContain("salt-call --local");
    expect(script).toContain("/opt/freshcrate/salt");
    expect(fs.existsSync(path.join(process.cwd(), "salt", "top.sls"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "salt", "states", "base", "init.sls"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "salt", "states", "freshcrate", "init.sls"))).toBe(true);
  });

  it("wires salt bootstrap into the shared image provisioning path", () => {
    const provision = fs.readFileSync(path.join(process.cwd(), "scripts", "provision-agent-edition-image.sh"), "utf8");
    const awsTemplate = fs.readFileSync(path.join(process.cwd(), "images", "aws-ami-builder.pkr.hcl"), "utf8");
    const vmTemplate = fs.readFileSync(path.join(process.cwd(), "images", "vm-qcow2-headless.pkr.hcl"), "utf8");
    expect(provision).toContain("bootstrap-salt-local.sh");
    expect(awsTemplate).toContain("bootstrap-salt-local.sh");
    expect(vmTemplate).toContain("bootstrap-salt-local.sh");
  });

  it("surfaces salt support in install metadata for the aws ami lane", async () => {
    const mod = await import("@/lib/workbench-install");
    const manifest = mod.getAgentEditionImageBuildManifest({ image: "aws-ami-builder", bundle: "research-node" });
    expect(manifest.packer.bootstrap_script).toBe("scripts/bootstrap-agent-edition.sh");
    expect(manifest.packer.provisioner_script).toBe("scripts/provision-agent-edition-image.sh");
    expect(manifest.packer.variables.bundle).toBe("research-node");

    const cloudInit = mod.getAgentEditionCloudInitSeed({ bundle: "research-node", mode: "headless", channel: "stable" });
    expect(cloudInit).toContain("bootstrap-agent-edition.sh --bundle research-node");
    expect(cloudInit).toContain("bootstrap-salt-local.sh --bundle research-node");
  });
});
