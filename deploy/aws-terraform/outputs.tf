output "event_url" {
  description = "Where the leaderboard/app answers. Use this as the OAuth app's base + callback host."
  value       = local.event_url
}

output "public_ip" {
  description = "The box's Elastic IP — point your DNS A record here if you did not set route53_zone_id."
  value       = aws_eip.box.public_ip
}

output "instance_id" {
  description = "EC2 instance id (for `aws ssm start-session --target <id>`)."
  value       = aws_instance.box.id
}

output "next_steps" {
  description = "What to do after apply."
  value       = <<-EOT
    1. If you did not set route53_zone_id, create a DNS A record: ${var.domain != "" ? var.domain : "<your-domain>"} -> ${aws_eip.box.public_ip}
    2. Ensure the OAuth app callback is https://${var.domain != "" ? var.domain : "<your-domain>"}/api/auth/callback/github
    3. Watch bring-up:  aws ssm start-session --target ${aws_instance.box.id}  then  tail -f /var/log/ctf-bringup.log
    4. Tear down when the event ends:  terraform destroy
  EOT
}
