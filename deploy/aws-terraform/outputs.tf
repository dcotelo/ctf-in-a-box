output "event_url" {
  description = "Where the leaderboard and sign-in answer. Use this as the OAuth app's base, with its callback at /api/auth/callback/github."
  value       = local.event_url
}

output "alb_dns_name" {
  description = "The load balancer's hostname. Point your DNS at this if you did not set route53_zone_id."
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "Hosted-zone id of the ALB, for an alias record in a zone this module does not manage."
  value       = aws_lb.main.zone_id
}

output "ecr_app_repository_url" {
  description = "Push the app image here — deploy.sh does. Terraform cannot build images."
  value       = aws_ecr_repository.main["app"].repository_url
}

output "cluster_name" {
  description = "ECS cluster, for `aws ecs execute-command` and the console."
  value       = aws_ecs_cluster.main.name
}

output "redis_primary_endpoint" {
  description = "ElastiCache primary endpoint. srh alone can reach it; nothing else has a route."
  value       = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "services_running" {
  description = "Which services this event actually runs, following the enabled modules."
  value = compact([
    "app",
    "srh",
    local.run_scorer ? "scorer" : "",
    local.run_sync ? "sync" : "",
  ])
}

output "next_steps" {
  description = "What to do after apply."
  value       = <<-EOT
    1. Put the event secrets in SSM as SecureStrings under ${var.ssm_prefix}:
         BETTER_AUTH_SECRET, GITHUB_CLIENT_SECRET, GITHUB_TOKEN, SRH_TOKEN
       (REDIS_AUTH_TOKEN is written there by Terraform.)
    2. Build and push the app image with event.yaml baked in:  ./deploy.sh
    3. If you did not set route53_zone_id, point ${var.domain} at ${aws_lb.main.dns_name}
    4. Set the OAuth app callback to ${local.event_url}/api/auth/callback/github
    5. Tear the event down when it ends:  terraform destroy
  EOT
}
