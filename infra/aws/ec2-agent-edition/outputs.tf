output "instance_id" {
  description = "EC2 instance ID."
  value       = aws_instance.agent_edition.id
}

output "instance_arn" {
  description = "EC2 instance ARN."
  value       = aws_instance.agent_edition.arn
}

output "availability_zone" {
  description = "Availability zone where the instance was placed."
  value       = aws_instance.agent_edition.availability_zone
}

output "private_ip" {
  description = "Private IPv4 address."
  value       = aws_instance.agent_edition.private_ip
}

output "public_ip" {
  description = "Public IPv4 address when assigned."
  value       = aws_instance.agent_edition.public_ip
}

output "user_data_sha256" {
  description = "SHA256 digest of the rendered cloud-init payload."
  value       = sha256(local.rendered_user_data)
}
