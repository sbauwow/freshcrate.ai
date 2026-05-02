import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("qcow2 image lane", () => {
  it("rebuilds the minimal rootfs in a temp dir when the default rootfs parent is stale and not writable", () => {
    const script = fs.readFileSync(path.join(process.cwd(), "scripts", "build-agent-edition-image.sh"), "utf8");
    expect(script).toContain('DEFAULT_ROOTFS_DIR="output/ubuntu-24.04-rootfs/${BUNDLE}/${CHANNEL}/rootfs"');
    expect(script).toContain('DEFAULT_ROOTFS_PARENT="$(dirname "$DEFAULT_ROOTFS_DIR")"');
    expect(script).toContain('ROOTFS_REBUILD_OUTPUT_DIR="$(mktemp -d)"');
    expect(script).toContain('qcow2 lane found stale default rootfs ownership; rebuilding in temp dir');
    expect(script).toContain('bash scripts/build-agent-edition-rootfs.sh "${ROOTFS_BUILD_ARGS[@]}"');
  });

  it("validates the vm template against a temporary rootfs contract instead of a prebuilt output tree", () => {
    const script = fs.readFileSync(path.join(process.cwd(), "scripts", "validate-agent-edition-templates.sh"), "utf8");
    expect(script).toContain("create_validate_rootfs_contract()");
    expect(script).toContain("VALIDATE_ROOTFS_DIR=\"\"");
    expect(script).toContain("create_validate_rootfs_contract");
    expect(script).toContain('PACKER_VALIDATE_ARGS+=( -var "rootfs_dir=${VALIDATE_ROOTFS_DIR}" )');
    expect(script).toContain(': > "${temp_dir}/package-manifest.txt"');
    expect(script).toContain(': > "${temp_dir}/image-build-receipt.txt"');
  });

  it("passes the rebuilt rootfs contract through to the vm packer template", () => {
    const template = fs.readFileSync(path.join(process.cwd(), "images", "vm-qcow2-headless.pkr.hcl"), "utf8");
    expect(template).toContain('cpus             = 2');
    expect(template).toContain('memory           = 2048');
    expect(template).toContain('skip_compaction  = true');
    expect(template).toContain('qemuargs         = [["-serial", "file:${local.target_config.output_directory}/packer-serial.log"]]');
    expect(template).toContain('vm_name          = "freshcrate-${var.bundle}-${var.channel}-${local.target_config.vm_name_suffix}.qcow2"');
    expect(template).toContain("while sudo test ! -f /var/lib/cloud/instance/boot-finished");
    expect(template).toContain('sudo cloud-init status --wait || true');
    expect(template).toContain('source      = "${var.rootfs_dir}/opt/freshcrate/scripts/bootstrap-agent-edition.sh"');
    expect(template).toContain('source      = "${var.rootfs_dir}/../package-manifest.txt"');
    expect(template).toContain('source      = "${var.rootfs_dir}/../image-build-receipt.txt"');
  });
});
