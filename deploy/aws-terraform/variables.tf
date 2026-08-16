variable "region" {
  type        = string
  description = "AWS region to deploy the event box into."
  default     = "us-east-1"
}

variable "instance_type" {
  type        = string
  description = "EC2 instance type. MUST be x86_64 (amd64) — the scorer image is amd64, and ARM/Graviton would need image rebuilds."
  default     = "t3.medium"
}

variable "key_name" {
  type        = string
  description = "Name of an existing EC2 key pair for SSH. Leave empty for no SSH key (use SSM Session Manager instead)."
  default     = ""
}

variable "name" {
  type        = string
  description = "Name prefix for the created resources (instance, SG, role)."
  default     = "ctf-in-a-box"
}

variable "repo_url" {
  type        = string
  description = "Git URL of the kit to clone on the box."
  default     = "https://github.com/dcotelo/ctf-in-a-box.git"
}

variable "git_ref" {
  type        = string
  description = "Git ref (tag/branch/sha) to check out. Pin a release tag for a real event."
  default     = "v0.1.0"
}

variable "domain" {
  type        = string
  description = "Public DNS name the box answers on, e.g. ctf.example.org. Required for HTTPS (Caddy auto-provisions TLS and the session cookie is only Secure over HTTPS). Leave empty to run HTTP-on-EIP for LOCAL TESTING ONLY."
  default     = ""
}

variable "route53_zone_id" {
  type        = string
  description = "Optional Route53 hosted-zone ID. If set together with domain, an A record for domain -> the box's EIP is created. Leave empty to manage DNS yourself."
  default     = ""
}

variable "tags" {
  type        = map(string)
  description = "Extra tags applied (via the provider's default_tags) to every resource, on top of the built-in Project/ManagedBy/Event tags. Use to pin the event to a cost center, owner, or expiry."
  default     = {}
}

variable "web_ingress_cidrs" {
  type        = list(string)
  description = "CIDRs allowed to reach the leaderboard/app on 80/443. Default is the whole internet (public leaderboard); narrow it for an organizer-only board."
  default     = ["0.0.0.0/0"]
}

variable "ssh_ingress_cidrs" {
  type        = list(string)
  description = "CIDRs allowed to reach SSH (22). Default is NONE — prefer SSM Session Manager. Set your own IP/32 if you need SSH."
  default     = []
}

variable "event_yaml_b64" {
  type        = string
  description = "base64 of your event.yaml (NOT a secret — org name, targets, admins, public OAuth client id). Produce with: base64 < event.yaml | tr -d '\\n'."
}

variable "ssm_prefix" {
  type        = string
  description = "SSM Parameter Store path prefix holding the event SECRETS as SecureStrings (create them OUT OF BAND — see README — so they never enter Terraform state). Expected params under this prefix: BETTER_AUTH_SECRET, SRH_TOKEN, SCORER_TOKEN, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY (and optionally GITHUB_APP_INSTALLATION_ID)."
  default     = "/ctf-in-a-box"
}

variable "root_volume_gb" {
  type        = number
  description = "Root EBS volume size (GiB). The app + scorer image builds and Docker layers need headroom."
  default     = 30
}
