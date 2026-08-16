# Single-shot AWS deploy of the CTF-in-a-box control plane: one x86_64 EC2
# instance running the compose stack in poll mode, brought up by user-data.
# `terraform apply` stands the event box up; `terraform destroy` tears it down.
#
# PREREQUISITES (done once, OFF this box — see README.md):
#   1. Provision the GitHub org forks with `ctf-setup.sh org` from your laptop.
#   2. Create the sync GitHub App + the sign-in OAuth app, with the OAuth
#      callback at https://<domain>/api/auth/callback/github.
#   3. Put the event SECRETS in SSM Parameter Store as SecureStrings under
#      var.ssm_prefix (so they never enter Terraform state).

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# Latest Amazon Linux 2023, x86_64 (amd64 — required for the scorer image).
data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

locals {
  # HTTPS when a domain is set (Caddy auto-TLS); otherwise HTTP on the EIP for
  # LOCAL TESTING ONLY — the session cookie is not Secure over plain HTTP.
  event_url = var.domain != "" ? "https://${var.domain}" : "http://${aws_eip.box.public_ip}"
}

resource "aws_security_group" "box" {
  name_prefix = "${var.name}-"
  description = "CTF-in-a-box event control plane"
  vpc_id      = data.aws_vpc.default.id

  # Poll mode needs NO inbound for scoring (sync polls GitHub outbound); these
  # rules only serve the public leaderboard / GitHub sign-in.
  ingress {
    description = "HTTPS (leaderboard + sign-in)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.web_ingress_cidrs
  }
  ingress {
    description = "HTTP (ACME challenge + redirect to HTTPS)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = var.web_ingress_cidrs
  }

  dynamic "ingress" {
    for_each = length(var.ssh_ingress_cidrs) > 0 ? [1] : []
    content {
      description = "SSH"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = var.ssh_ingress_cidrs
    }
  }

  egress {
    description = "All outbound (GitHub API poll, ACME, image pulls)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = var.name }
}

# Instance role: read ONLY this event's SSM secrets (+ decrypt with the AWS
# managed SSM key). Nothing else. SSM Session Manager access is included so you
# can shell in without opening SSH.
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "box" {
  name_prefix        = "${var.name}-"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

data "aws_iam_policy_document" "secrets" {
  statement {
    sid       = "ReadEventSecrets"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = ["arn:aws:ssm:${var.region}:*:parameter${var.ssm_prefix}", "arn:aws:ssm:${var.region}:*:parameter${var.ssm_prefix}/*"]
  }
  statement {
    sid       = "DecryptSecrets"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "secrets" {
  name_prefix = "${var.name}-secrets-"
  role        = aws_iam_role.box.id
  policy      = data.aws_iam_policy_document.secrets.json
}

# SSM Session Manager (shell without SSH).
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.box.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "box" {
  name_prefix = "${var.name}-"
  role        = aws_iam_role.box.name
}

resource "aws_eip" "box" {
  domain = "vpc"
  tags   = { Name = var.name }
}

resource "aws_instance" "box" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.instance_type
  subnet_id              = data.aws_subnets.default.ids[0]
  vpc_security_group_ids = [aws_security_group.box.id]
  iam_instance_profile   = aws_iam_instance_profile.box.name
  key_name               = var.key_name != "" ? var.key_name : null

  root_block_device {
    volume_size = var.root_volume_gb
    volume_type = "gp3"
    encrypted   = true
  }

  user_data = templatefile("${path.module}/user-data.sh.tftpl", {
    repo_url       = var.repo_url
    git_ref        = var.git_ref
    region         = var.region
    ssm_prefix     = var.ssm_prefix
    event_yaml_b64 = var.event_yaml_b64
    event_url      = local.event_url
  })
  # Re-run user-data when the bring-up inputs change (replaces the instance).
  user_data_replace_on_change = true

  tags = { Name = var.name }
}

resource "aws_eip_association" "box" {
  instance_id   = aws_instance.box.id
  allocation_id = aws_eip.box.id
}

resource "aws_route53_record" "box" {
  count   = var.domain != "" && var.route53_zone_id != "" ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.domain
  type    = "A"
  ttl     = 300
  records = [aws_eip.box.public_ip]
}
