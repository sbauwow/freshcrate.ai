terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

locals {
  common_tags = merge(
    {
      Name       = var.name
      Project    = "freshcrate-agent-edition"
      Bundle     = var.bundle
      Channel    = var.channel
      ManagedBy  = "terraform"
      Provision  = "cloud-init"
      Runtime    = "ec2"
    },
    var.tags,
  )

  rendered_user_data = templatefile(var.user_data_template_path, {
    hostname        = var.hostname
    bundle          = var.bundle
    mode            = var.mode
    channel         = var.channel
    target          = var.target
    freshcrate_home = var.freshcrate_home
    workspace_dir   = var.workspace_dir
  })
}

resource "aws_instance" "agent_edition" {
  ami                                  = var.ami_id
  instance_type                        = var.instance_type
  subnet_id                            = var.subnet_id
  associate_public_ip_address          = var.associate_public_ip_address
  vpc_security_group_ids               = var.security_group_ids
  iam_instance_profile                 = var.iam_instance_profile_name
  key_name                             = var.key_name
  user_data                            = local.rendered_user_data
  user_data_replace_on_change          = true
  monitoring                           = var.detailed_monitoring
  availability_zone                    = var.availability_zone
  ebs_optimized                        = var.ebs_optimized
  disable_api_termination              = var.disable_api_termination
  source_dest_check                    = var.source_dest_check
  instance_initiated_shutdown_behavior = var.shutdown_behavior

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = var.imds_http_tokens
    http_put_response_hop_limit = var.imds_hop_limit
    instance_metadata_tags      = "enabled"
  }

  root_block_device {
    volume_size           = var.root_volume_size
    volume_type           = var.root_volume_type
    encrypted             = var.root_volume_encrypted
    delete_on_termination = true
    iops                  = contains(["gp3", "io1", "io2"], var.root_volume_type) ? var.root_volume_iops : null
    throughput            = var.root_volume_type == "gp3" ? var.root_volume_throughput : null
    tags                  = merge(local.common_tags, { Role = "root-volume" })
  }

  tags = local.common_tags
}
