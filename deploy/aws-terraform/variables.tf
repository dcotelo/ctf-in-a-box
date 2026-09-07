// Inputs to the ECS deployment. Every variable that can be set to something
// this module cannot honour carries a `validation` block, so the failure lands
// at plan time with a sentence rather than mid-apply with an AWS API error.

variable "region" {
  description = "AWS region for the whole stack."
  type        = string
  default     = "us-east-1"
}

variable "name" {
  description = "Name prefix for every resource, and the ECS cluster name."
  type        = string
  default     = "ctf-in-a-box"

  // 28, not 32. AWS caps both an ALB name and a target group name at 32
  // characters, and this value reaches them as `${var.name}-alb` and
  // `${var.name}-app` (alb.tf) — four characters each. A 29-to-32 character
  // name passed this check and then failed mid-apply, which is precisely what
  // the file header says these blocks exist to prevent.
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,26}[a-z0-9]$", var.name))
    error_message = "name must be 3-28 lowercase alphanumerics or hyphens, not starting or ending with a hyphen. The cap is 28 rather than 32 because this prefixes the ALB (`-alb`) and target group (`-app`) names, which AWS limits to 32."
  }
}

variable "tags" {
  description = "Extra tags merged into the provider's default_tags."
  type        = map(string)
  default     = {}
}

variable "vpc_cidr" {
  description = "CIDR for the event VPC. Needs room for four subnets."
  type        = string
  default     = "10.42.0.0/16"

  validation {
    condition     = can(cidrsubnet(var.vpc_cidr, 4, 3))
    error_message = "vpc_cidr must leave room for at least four subnets four bits narrower (a /16 or /18 is ample)."
  }
}

variable "web_ingress_cidrs" {
  description = "Who may reach the ALB. Default is the public internet; narrow it for a private event."
  type        = list(string)
  default     = ["0.0.0.0/0"]

  validation {
    condition     = length(var.web_ingress_cidrs) > 0
    error_message = "web_ingress_cidrs cannot be empty — the event would be unreachable."
  }
}

// --- naming and TLS --------------------------------------------------------

variable "domain" {
  description = "Public hostname for the event, e.g. ctf.example.org. Required: the session cookie is Secure, so there is no usable HTTP-only mode."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$", var.domain))
    error_message = "domain must be a hostname such as ctf.example.org."
  }
}

variable "route53_zone_id" {
  description = "Route 53 zone for `domain`, IN THIS ACCOUNT. Set it and Terraform issues the ACM certificate and creates the alias record. Leave it empty and you must supply acm_certificate_arn and create the record yourself."
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "Existing ACM certificate for `domain`, in THIS region. Required when route53_zone_id is empty."
  type        = string
  default     = ""

  validation {
    condition     = var.acm_certificate_arn == "" || can(regex("^arn:aws[a-z-]*:acm:", var.acm_certificate_arn))
    error_message = "acm_certificate_arn must be an ACM certificate ARN."
  }

  // The TLS requirement, ENFORCED rather than warned about.
  //
  // alb.tf's `check` block reports the same condition, but a failed `check` is
  // a warning: the apply proceeds, `local.certificate_arn` resolves to "", and
  // `aws_lb_listener.https` is handed an empty `certificate_arn` to fail on —
  // an AWS API error in place of the sentence the check wrote. The check stays
  // (it re-reports the same requirement on later plans, including ones where
  // the certificate has gone away), but the input is now refused up front.
  validation {
    condition     = var.acm_certificate_arn != "" || var.route53_zone_id != ""
    error_message = "Set route53_zone_id (Terraform issues the certificate) or acm_certificate_arn (you already have one). The session cookie is Secure, so there is no HTTP-only mode to fall back to."
  }
}

// --- what this event runs --------------------------------------------------

variable "event_yaml_b64" {
  description = "base64 of event.yaml. BAKED INTO THE APP IMAGE at build time, not read here — deploy.sh passes it to the build. Kept as a required input so the module refuses to describe a stack whose image was built without it."
  type        = string

  validation {
    condition     = length(var.event_yaml_b64) > 0
    error_message = "event_yaml_b64 is required: an app image built without it silently has an empty admins list, so /admin 403s for everyone (see AGENTS.md)."
  }
}

variable "enable_secure_development" {
  description = "This event runs the secure-development module (GitHub forks + PR scoring). When false, no scorer and no sync run at all — the compose profiles' behaviour, ported."
  type        = bool
  default     = true
}

variable "score_ingest" {
  description = "How fork scores reach the box. 'poll' runs sync (which polls GitHub); 'push' has the fork's Action POST to the scorer and runs no sync."
  type        = string
  default     = "poll"

  validation {
    condition     = contains(["poll", "push"], var.score_ingest)
    error_message = "score_ingest must be \"poll\" or \"push\"."
  }
}

// --- images ----------------------------------------------------------------

variable "app_image" {
  description = "Fully qualified app image, e.g. <account>.dkr.ecr.<region>.amazonaws.com/ctf-app:v0.4.0. Built and pushed by deploy.sh — Terraform cannot build images — into the ECR repository this module creates."
  type        = string
}

variable "scorer_image" {
  description = "Fully qualified scorer image. Ignored unless enable_secure_development, and REQUIRED when it is on."
  type        = string
  default     = ""

  // The empty default is only legal while the module builds no scorer task.
  // With secure-development enabled it is passed straight through as a
  // container image, and ECS rejects a task definition with an empty one — so
  // the default turns into a mid-apply API error rather than a plan-time
  // sentence. Cross-variable validation needs Terraform 1.9; versions.tf
  // already requires 1.10.
  validation {
    condition     = !var.enable_secure_development || var.scorer_image != ""
    error_message = "scorer_image is required when enable_secure_development is true — the scorer task definition names it as its image."
  }
}

variable "sync_image" {
  description = "Fully qualified sync image. Ignored unless enable_secure_development and score_ingest == \"poll\", and REQUIRED in that combination."
  type        = string
  default     = ""

  // Narrower than scorer_image's rule on purpose, and for the same reason the
  // compose profiles differ: push mode has the fork's Action POST to the
  // scorer directly, so there is no poller to run and no image to demand.
  validation {
    condition     = !(var.enable_secure_development && var.score_ingest == "poll") || var.sync_image != ""
    error_message = "sync_image is required when enable_secure_development is true and score_ingest is \"poll\" — that combination runs the sync task. Push mode needs no poller."
  }
}

variable "srh_image" {
  description = "The Upstash-REST shim. Digest-pinned by default: this third-party image sits directly in the score read/write path, exactly as docker-compose.yml pins it."
  type        = string
  default     = "hiett/serverless-redis-http@sha256:5b0bb9239fce53abf87b2018a7a0deb9ec7bd900c5360738fe5fbeeb426f9150"

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.srh_image))
    error_message = "srh_image must be digest-pinned (...@sha256:<64 hex>) — it is in the scoring path, and a floating tag there is a supply-chain hole (ADR 51)."
  }
}

// --- capacity --------------------------------------------------------------

variable "app_cpu" {
  description = "Fargate CPU units for the app task (1024 = 1 vCPU)."
  type        = number
  default     = 1024
}

variable "app_memory" {
  description = "Fargate memory (MiB) for the app task."
  type        = number
  default     = 2048
}

variable "app_desired_count" {
  description = "How many app tasks to run. 2 keeps the event up through a deployment; 1 is cheaper."
  type        = number
  default     = 2

  validation {
    condition     = var.app_desired_count >= 1
    error_message = "app_desired_count must be at least 1."
  }
}

variable "cache_node_type" {
  description = "ElastiCache node type. t4g.micro carries an event of this size comfortably."
  type        = string
  default     = "cache.t4g.micro"
}

variable "cache_replica_count" {
  description = "Read replicas. 1 gives automatic failover across the two AZs; 0 is cheaper and single-AZ."
  type        = number
  default     = 1

  validation {
    condition     = var.cache_replica_count >= 0 && var.cache_replica_count <= 5
    error_message = "cache_replica_count must be between 0 and 5."
  }
}

variable "cache_snapshot_retention_days" {
  description = "Daily ElastiCache snapshots to keep. This is the module's durability story — see README: it is coarser than the EC2 box's AOF, and the event archive is the content-level backup."
  type        = number
  default     = 5

  validation {
    condition     = var.cache_snapshot_retention_days >= 1
    error_message = "cache_snapshot_retention_days must be at least 1: at 0 ElastiCache takes no backups at all, and a node replacement loses the event."
  }
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for every service."
  type        = number
  default     = 30
}

// --- secrets ---------------------------------------------------------------

variable "ssm_prefix" {
  description = "SSM Parameter Store prefix holding the event's SecureString secrets. The task execution role is scoped to exactly this prefix."
  type        = string
  default     = "/ctf-in-a-box"

  validation {
    condition     = can(regex("^/[A-Za-z0-9._/-]*[A-Za-z0-9._-]$", var.ssm_prefix))
    error_message = "ssm_prefix must start with / and not end with one."
  }
}
