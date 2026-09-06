// The event's own VPC: two AZs, a public tier for the ALB and the Fargate
// tasks, a private tier for ElastiCache alone.
//
// WHY TASKS SIT IN PUBLIC SUBNETS. The issue left this open (NAT gateway vs
// VPC endpoints vs public subnets with `assignPublicIp`). Fargate tasks need
// egress to pull images from ECR, read secrets, and — for `sync` — reach
// GitHub. The three ways to give them that:
//
//   - NAT gateway: roughly the cost of the entire EC2 instance this module
//     replaces, per AZ, before a byte moves.
//   - VPC endpoints: ECR (api + dkr), S3, Secrets Manager, SSM and CloudWatch
//     Logs, each an hourly charge per AZ, plus the ones you forget.
//   - Public subnets with `assign_public_ip = true`: no extra charge, egress
//     through the internet gateway.
//
// The third is chosen, and it is defensible precisely because the isolation in
// this stack was never the subnet: ADR 41 puts the boundary in the security
// groups, and it stays there (see security.tf — nothing reaches a task except
// the ALB, and nothing reaches ElastiCache except srh). A public subnet with a
// public IP and no permitted inbound is not reachable from the internet.
//
// ElastiCache is the exception and stays private: it needs no egress at all,
// so there is no reason to give it a route to the internet gateway.

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  // Two AZs: ElastiCache's subnet group wants more than one, and an ALB
  // requires at least two. Deliberately not more — a third adds cost and
  // spreads an event this size thinner than it needs.
  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = var.name }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = var.name }
}

resource "aws_subnet" "public" {
  count = length(local.azs)

  vpc_id            = aws_vpc.main.id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index)
  // The tasks that need a public IP say so themselves, in their service's
  // network configuration. Handing one to everything launched here by default
  // would quietly extend that to anything added later.
  map_public_ip_on_launch = false

  tags = { Name = "${var.name}-public-${local.azs[count.index]}" }
}

// No route to the internet gateway, by construction: ElastiCache has no reason
// to reach the internet, and the absence of a route says that more firmly than
// a security group rule about it would.
resource "aws_subnet" "private" {
  count = length(local.azs)

  vpc_id            = aws_vpc.main.id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + length(local.azs))

  tags = { Name = "${var.name}-private-${local.azs[count.index]}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "${var.name}-public" }
}

resource "aws_route_table_association" "public" {
  count = length(aws_subnet.public)

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}
