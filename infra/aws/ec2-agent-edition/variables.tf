variable "region" {
  description = "AWS region for the EC2 instance."
  type        = string
}

variable "name" {
  description = "Name tag for the EC2 instance."
  type        = string
  default     = "freshcrate-agent-edition"
}

variable "hostname" {
  description = "Hostname applied by cloud-init on first boot."
  type        = string
  default     = "freshcrate-agent-edition"
}

variable "ami_id" {
  description = "AMI ID baked by the aws-ami-builder lane."
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type."
  type        = string
  default     = "t3.small"
}

variable "subnet_id" {
  description = "Subnet to launch into."
  type        = string
}

variable "security_group_ids" {
  description = "Security groups to attach to the instance."
  type        = list(string)
}

variable "iam_instance_profile_name" {
  description = "IAM instance profile name to attach."
  type        = string
  default     = null
}

variable "key_name" {
  description = "Optional EC2 key pair name."
  type        = string
  default     = null
}

variable "associate_public_ip_address" {
  description = "Whether to associate a public IP."
  type        = bool
  default     = false
}

variable "availability_zone" {
  description = "Optional AZ override. Leave null to let AWS place it in the subnet."
  type        = string
  default     = null
}

variable "bundle" {
  description = "freshcrate Agent Edition bundle to assert in first-boot receipts."
  type        = string
  default     = "research-node"
}

variable "mode" {
  description = "Install mode to assert in first-boot receipts."
  type        = string
  default     = "headless"
}

variable "channel" {
  description = "Release channel to assert in first-boot receipts."
  type        = string
  default     = "stable"
}

variable "target" {
  description = "Target platform string baked into receipts and runtime metadata."
  type        = string
  default     = "ubuntu-24.04-x86_64"
}

variable "freshcrate_home" {
  description = "Persistent freshcrate home directory on the instance."
  type        = string
  default     = "/opt/freshcrate/home"
}

variable "workspace_dir" {
  description = "Workspace directory used by bootstrap and verify scripts."
  type        = string
  default     = "/opt/freshcrate/workspace"
}

variable "user_data_template_path" {
  description = "Path to the cloud-init template used for EC2 first boot."
  type        = string
  default     = "../../../templates/cloud-init-ec2.yaml"
}

variable "root_volume_size" {
  description = "Root EBS size in GiB."
  type        = number
  default     = 32
}

variable "root_volume_type" {
  description = "Root EBS volume type."
  type        = string
  default     = "gp3"
}

variable "root_volume_iops" {
  description = "Explicit IOPS for the root volume when supported."
  type        = number
  default     = 3000
}

variable "root_volume_throughput" {
  description = "Explicit throughput for gp3 root volumes."
  type        = number
  default     = 125
}

variable "root_volume_encrypted" {
  description = "Whether to encrypt the root EBS volume."
  type        = bool
  default     = true
}

variable "detailed_monitoring" {
  description = "Enable detailed CloudWatch monitoring."
  type        = bool
  default     = false
}

variable "ebs_optimized" {
  description = "Whether to request EBS-optimized instance mode."
  type        = bool
  default     = false
}

variable "disable_api_termination" {
  description = "Protect the instance from API termination."
  type        = bool
  default     = false
}

variable "source_dest_check" {
  description = "Whether source/destination checks remain enabled."
  type        = bool
  default     = true
}

variable "shutdown_behavior" {
  description = "Instance behavior when the OS shuts down."
  type        = string
  default     = "stop"
}

variable "imds_http_tokens" {
  description = "IMDSv2 token requirement."
  type        = string
  default     = "required"
}

variable "imds_hop_limit" {
  description = "IMDS hop limit."
  type        = number
  default     = 2
}

variable "tags" {
  description = "Additional tags to merge onto the instance and root volume."
  type        = map(string)
  default     = {}
}
