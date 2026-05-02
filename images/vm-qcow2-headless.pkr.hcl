packer {
  required_plugins {
    qemu = {
      version = ">= 1.1.0"
      source  = "github.com/hashicorp/qemu"
    }
  }
}

variable "bundle" { type = string }
variable "mode" { type = string }
variable "channel" { type = string }
variable "version" { type = string }
variable "target" { type = string }
variable "rootfs_dir" {
  type    = string
  default = "output/ubuntu-24.04-rootfs/solo-builder-core/stable/rootfs"
}
variable "accelerator" {
  type    = string
  default = "none"
}

locals {
  target_matrix = {
    "ubuntu-24.04-x86_64" = {
      iso_url          = "https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-amd64.img"
      output_directory = "output/vm-qcow2-headless"
      vm_name_suffix   = "x86_64"
    }
    "ubuntu-24.04-arm64" = {
      iso_url          = "https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-arm64.img"
      output_directory = "output/vm-qcow2-headless-arm64"
      vm_name_suffix   = "arm64"
    }
  }
  target_config = local.target_matrix[var.target]
}

source "qemu" "agent_edition" {
  accelerator      = var.accelerator
  cd_files         = ["images/cloud-init/vm-qcow2-headless/meta-data", "images/cloud-init/vm-qcow2-headless/user-data"]
  cd_label         = "cidata"
  cpus             = 2
  memory           = 2048
  disk_image       = true
  headless         = true
  disk_interface   = "virtio"
  format           = "qcow2"
  skip_compaction  = true
  iso_url          = local.target_config.iso_url
  iso_checksum     = "none"
  output_directory = local.target_config.output_directory
  qemuargs         = [["-serial", "file:${local.target_config.output_directory}/packer-serial.log"]]
  ssh_username     = "ubuntu"
  ssh_password     = "freshcrate"
  ssh_timeout      = "20m"
  vm_name          = "freshcrate-${var.bundle}-${var.channel}-${local.target_config.vm_name_suffix}.qcow2"
}

build {
  name    = "vm-qcow2-headless"
  sources = ["source.qemu.agent_edition"]

  provisioner "shell" {
    inline = [
      "while sudo test ! -f /var/lib/cloud/instance/boot-finished; do echo '[freshcrate-agent-edition] waiting for cloud-init boot-finished'; sleep 10; done",
      "sudo cloud-init status --wait || true",
    ]
  }

  provisioner "file" {
    source      = "scripts/provision-agent-edition-image.sh"
    destination = "/tmp/provision-agent-edition-image.sh"
  }

  provisioner "file" {
    source      = "scripts/bootstrap-agent-edition.sh"
    destination = "/tmp/bootstrap-agent-edition.sh"
  }

  provisioner "file" {
    source      = "scripts/verify-agent-edition.sh"
    destination = "/tmp/verify-agent-edition.sh"
  }

  provisioner "file" {
    source      = "scripts/lib/bootstrap-common.sh"
    destination = "/tmp/bootstrap-common.sh"
  }

  provisioner "file" {
    source      = "${var.rootfs_dir}/opt/freshcrate/scripts/bootstrap-agent-edition.sh"
    destination = "/tmp/rootfs-bootstrap-agent-edition.sh"
  }

  provisioner "file" {
    source      = "${var.rootfs_dir}/opt/freshcrate/scripts/verify-agent-edition.sh"
    destination = "/tmp/rootfs-verify-agent-edition.sh"
  }

  provisioner "file" {
    source      = "${var.rootfs_dir}/opt/freshcrate/scripts/lib/bootstrap-common.sh"
    destination = "/tmp/rootfs-bootstrap-common.sh"
  }

  provisioner "file" {
    source      = "${var.rootfs_dir}/../package-manifest.txt"
    destination = "/tmp/rootfs-package-manifest.txt"
  }

  provisioner "file" {
    source      = "${var.rootfs_dir}/../image-build-receipt.txt"
    destination = "/tmp/rootfs-image-build-receipt.txt"
  }

  provisioner "shell" {
    inline = [
      "sudo mkdir -p /opt/freshcrate/scripts/lib /opt/freshcrate/rootfs-contract",
      "sudo mv /tmp/provision-agent-edition-image.sh /opt/freshcrate/scripts/provision-agent-edition-image.sh",
      "sudo mv /tmp/bootstrap-agent-edition.sh /opt/freshcrate/scripts/bootstrap-agent-edition.sh",
      "sudo mv /tmp/verify-agent-edition.sh /opt/freshcrate/scripts/verify-agent-edition.sh",
      "sudo mv /tmp/bootstrap-common.sh /opt/freshcrate/scripts/lib/bootstrap-common.sh",
      "sudo mv /tmp/rootfs-bootstrap-agent-edition.sh /opt/freshcrate/rootfs-contract/bootstrap-agent-edition.sh",
      "sudo mv /tmp/rootfs-verify-agent-edition.sh /opt/freshcrate/rootfs-contract/verify-agent-edition.sh",
      "sudo mv /tmp/rootfs-bootstrap-common.sh /opt/freshcrate/rootfs-contract/bootstrap-common.sh",
      "sudo mv /tmp/rootfs-package-manifest.txt /opt/freshcrate/rootfs-contract/package-manifest.txt",
      "sudo mv /tmp/rootfs-image-build-receipt.txt /opt/freshcrate/rootfs-contract/image-build-receipt.txt",
      "sudo chmod +x /opt/freshcrate/scripts/provision-agent-edition-image.sh /opt/freshcrate/scripts/bootstrap-agent-edition.sh /opt/freshcrate/scripts/verify-agent-edition.sh",
      "cd /opt/freshcrate/scripts && sudo FRESHCRATE_HOME=/opt/freshcrate/home WORKSPACE_DIR=/opt/freshcrate/workspace ./provision-agent-edition-image.sh ${var.bundle} ${var.mode} ${var.channel} vm-qcow2-headless /opt/freshcrate/rootfs-contract/package-manifest.txt /opt/freshcrate/rootfs-contract/image-build-receipt.txt",
    ]
  }
}
