import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("live usb image lane", () => {
  it("exposes package.json commands for the live usb lane", () => {
    const packageJson = fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8");
    expect(packageJson).toContain("image:build:liveusb");
    expect(packageJson).toContain("image:smoke:liveusb");
    expect(packageJson).toContain("image:verify:liveusb");
  });

  it("extends the packaging script to support the live usb image lane", () => {
    const script = fs.readFileSync(path.join(process.cwd(), "scripts", "package-agent-edition-image.sh"), "utf8");
    expect(script).toContain("iso-live-persistent-x86_64");
    expect(script).toContain("FINAL_EXTENSION=\".iso\"");
  });

  it("ships a dedicated live usb builder that injects nocloud seed without autoinstall and replaces the stock live root with the minimal AE rootfs", () => {
    const script = fs.readFileSync(path.join(process.cwd(), "scripts", "build-agent-edition-live-usb.sh"), "utf8");
    expect(script).toContain("iso-live-persistent-x86_64");
    expect(script).toContain("ubuntu-24.04-live-server-amd64.iso");
    expect(script).toContain("build-agent-edition-rootfs.sh");
    expect(script).toContain("grep -qx 'cloud-init'");
    expect(script).toContain("$ROOTFS_DIR/usr/bin/cloud-init");
    expect(script).toContain('ROOTFS_DEFAULT_PARENT="$(dirname "$ROOTFS_DIR")"');
    expect(script).toContain('ROOTFS_SEED_PARENT="${ROOTFS_DIR}/var/lib/cloud/seed"');
    expect(script).toContain('ROOTFS_FORCE_TEMP_REBUILD=1');
    expect(script).toContain('ROOTFS_REBUILD_OUTPUT_DIR="${WORK_DIR}/rootfs-rebuild"');
    expect(script).toContain('ROOTFS_BUILD_ARGS+=(--output-dir "$ROOTFS_REBUILD_OUTPUT_DIR")');
    expect(script).toContain("mksquashfs");
    expect(script).toContain("ubuntu-server-minimal.squashfs");
    expect(script).toContain("unmkinitramfs");
    expect(script).toContain("gzip -c > \"$CASPER_DIR/initrd\"");
    expect(script).toContain("var/lib/cloud/seed/nocloud");
    expect(script).toContain("25adduser");
    expect(script).toContain("55disable_snap_refresh");
    expect(script).toContain('scripts/casper-bottom/ORDER');
    expect(script).toContain('"/scripts/casper-bottom/{name} " in stripped');
    expect(script).toContain("persistent");
    expect(script).toContain("/cdrom/nocloud/");
    expect(script).not.toContain("autoinstall ds=nocloud");
  });

  it("ships live boot persistence config assets with first-boot bootstrap service", () => {
    expect(fs.existsSync(path.join(process.cwd(), "images", "cloud-init", "iso-live-persistent-x86_64", "meta-data"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "images", "cloud-init", "iso-live-persistent-x86_64", "user-data"))).toBe(true);
    const userData = fs.readFileSync(path.join(process.cwd(), "images", "cloud-init", "iso-live-persistent-x86_64", "user-data"), "utf8");
    expect(userData).toContain("freshcrate-live-bootstrap.service");
    expect(userData).toContain("freshcrate-live-bootstrap.sh");
    expect(userData).toContain("/cdrom/freshcrate-live/scripts");
    expect(userData).toContain("boot_count");
    expect(userData).not.toContain("count=$((count + 1))");
    expect(userData).toContain("count=1");
  });

  it("ships bootstrap common helpers that tolerate a missing HOME env in systemd/cloud-init contexts", () => {
    const common = fs.readFileSync(path.join(process.cwd(), "scripts", "lib", "bootstrap-common.sh"), "utf8");
    expect(common).toContain('HOME_DEFAULT="${HOME:-/root}"');
    expect(common).toContain('FRESHCRATE_HOME_DEFAULT="${HOME_DEFAULT}/.freshcrate"');
    expect(common).toContain('WORKSPACE_DEFAULT="${HOME_DEFAULT}/workspace"');
  });

  it("ships a qemu smoke test for the live usb lane", () => {
    const script = fs.readFileSync(path.join(process.cwd(), "scripts", "qemu-smoke-test-live-usb.sh"), "utf8");
    expect(script).toContain("qemu-system-x86_64");
    expect(script).toContain("persistent");
    expect(script).toContain("GNU GRUB");
  });

  it("ships a qemu persistence verifier that follows the live lane's embedded nocloud datasource", () => {
    const script = fs.readFileSync(path.join(process.cwd(), "scripts", "qemu-verify-live-usb-persistence.sh"), "utf8");
    expect(script).toContain("mkfs.ext4");
    expect(script).toContain("casper-rw");
    expect(script).toContain("/cdrom/nocloud/");
    expect(script).not.toContain("CIDATA");
    expect(script).not.toContain("freshcrate-live-usb-seed.iso");
    expect(script).toContain("cloud-init-local.service");
    expect(script).toContain('PERSISTENCE_UPPER_PREFIX="upper/var/lib/freshcrate-live"');
    expect(script).toContain("assert_persistence_state \"1\" \"no\"");
    expect(script).toContain("assert_persistence_state \"2\" \"yes\"");
  });

  it("ships a helper to create the casper-rw persistence partition on a USB device", () => {
    const script = fs.readFileSync(path.join(process.cwd(), "scripts", "create-live-usb-persistence.sh"), "utf8");
    expect(script).toContain("--device");
    expect(script).toContain("--size");
    expect(script).toContain("--dry-run");
    expect(script).toContain("--yes");
    expect(script).toContain("casper-rw");
    expect(script).toContain("mkfs.ext4");
    expect(script).toContain("lsblk -f");
    expect(script).toContain("parted -s");
  });
});
