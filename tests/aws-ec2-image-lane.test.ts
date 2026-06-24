import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { getAgentEditionImageBuildManifest, getAgentEditionManifest } from "@/lib/workbench-install";

describe("aws ec2 launch lane", () => {
  it("ships an ec2 terraform module scaffold", () => {
    const moduleDir = path.join(process.cwd(), "infra", "aws", "ec2-agent-edition");
    expect(fs.existsSync(path.join(moduleDir, "main.tf"))).toBe(true);
    expect(fs.existsSync(path.join(moduleDir, "variables.tf"))).toBe(true);
    expect(fs.existsSync(path.join(moduleDir, "outputs.tf"))).toBe(true);

    const mainTf = fs.readFileSync(path.join(moduleDir, "main.tf"), "utf8");
    expect(mainTf).toContain('resource "aws_instance" "agent_edition"');
    expect(mainTf).toContain("templatefile(var.user_data_template_path");
    expect(mainTf).toContain("metadata_options");
  });

  it("ships an ec2 cloud-init template and helper scripts", () => {
    const templatePath = path.join(process.cwd(), "templates", "cloud-init-ec2.yaml");
    const renderScriptPath = path.join(process.cwd(), "scripts", "render-agent-edition-ec2-cloud-init.sh");
    const launchScriptPath = path.join(process.cwd(), "scripts", "launch-agent-edition-ec2.sh");
    const verifyScriptPath = path.join(process.cwd(), "scripts", "verify-agent-edition-ec2-receipts.sh");

    expect(fs.existsSync(templatePath)).toBe(true);
    expect(fs.existsSync(renderScriptPath)).toBe(true);
    expect(fs.existsSync(launchScriptPath)).toBe(true);
    expect(fs.existsSync(verifyScriptPath)).toBe(true);

    const template = fs.readFileSync(templatePath, "utf8");
    expect(template).toContain("freshcrate-ec2-firstboot.sh");
    expect(template).toContain("ec2-firstboot-${bundle}.txt");
    expect(template).toContain("amazon-ssm-agent");

    const launchScript = fs.readFileSync(launchScriptPath, "utf8");
    expect(launchScript).toContain("terraform or tofu is required");
    expect(launchScript).toContain('infra/aws/ec2-agent-edition');

    const verifyScript = fs.readFileSync(verifyScriptPath, "utf8");
    expect(verifyScript).toContain("ec2-firstboot-");
    expect(verifyScript).toContain("ssh");
  });

  it("surfaces ec2 module metadata in workbench manifests for the aws ami lane", () => {
    const imageManifest = getAgentEditionImageBuildManifest({ image: "aws-ami-builder", bundle: "research-node" });
    expect(imageManifest.image.status).toBe("preview");
    expect(imageManifest.ec2?.module_path).toBe("infra/aws/ec2-agent-edition");
    expect(imageManifest.ec2?.cloud_init_template).toBe("templates/cloud-init-ec2.yaml");
    expect(imageManifest.ec2?.launch_script).toBe("scripts/launch-agent-edition-ec2.sh");
    expect(imageManifest.ec2?.render_cloud_init_command).toContain("render-agent-edition-ec2-cloud-init.sh");
    expect(imageManifest.ec2?.verify_command).toContain("verify-agent-edition-ec2-receipts.sh");

    const manifest = getAgentEditionManifest({ bundle: "research-node", mode: "headless", channel: "stable" });
    expect(manifest.ec2?.tfvars_example).toBe("infra/aws/ec2-agent-edition/dev.auto.tfvars.example");
  });

  it("adds package.json commands for ec2 launch and verification", () => {
    const packageJson = fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8");
    expect(packageJson).toContain("image:launch:ec2");
    expect(packageJson).toContain("image:verify:ec2");
  });
});
