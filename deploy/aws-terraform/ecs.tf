// The four services, mirroring the compose stack one for one.
//
//   app     always on, behind the ALB
//   srh     always on, internal — the ONLY thing that talks to ElastiCache
//   scorer  when this event runs secure-development (poll AND push)
//   sync    when it runs secure-development in POLL mode only
//
// That last pair is the compose profiles, ported: `scorer` carries
// ["poll","push"] and `sync` carries ["poll"], so a quiz-only event brings up
// neither and never needs the scorer image at all.
//
// Service discovery is AWS Cloud Map, so the app reaches srh at a stable name
// the way compose gave it one. Without it the app would need an address for a
// task that is replaced on every deploy.

resource "aws_ecs_cluster" "main" {
  name = var.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_service_discovery_private_dns_namespace" "main" {
  name        = "${var.name}.internal"
  description = "Internal names for ${var.name}"
  vpc         = aws_vpc.main.id
}

resource "aws_service_discovery_service" "srh" {
  name = "srh"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id

    dns_records {
      ttl  = 10
      type = "A"
    }

    routing_policy = "MULTIVALUE"
  }
}

resource "aws_cloudwatch_log_group" "main" {
  for_each = toset(compact([
    "app",
    "srh",
    local.run_scorer ? "scorer" : "",
    local.run_sync ? "sync" : "",
  ]))

  name              = "/ecs/${var.name}/${each.key}"
  retention_in_days = var.log_retention_days
}

locals {
  event_url = "https://${var.domain}"
  srh_host  = "srh.${aws_service_discovery_private_dns_namespace.main.name}"

  // What every service uses instead of raw Redis. The app, scorer and sync
  // speak Upstash-REST and nothing else — that is what keeps ADR 41's boundary
  // meaningful.
  upstash_url = "http://${local.srh_host}"

  // Every secret arrives by reference. Nothing here interpolates a secret
  // value into an environment variable, where it would sit in the task
  // definition — readable by anyone holding ecs:DescribeTaskDefinition.
  //
  // That claim was FALSE for srh until PR #354's review: the assembled
  // `rediss://` URL embeds the generated AUTH token, and it was passed as an
  // `environment` entry. It now lives in SSM as a SecureString
  // (`aws_ssm_parameter.redis_url`, elasticache.tf) and arrives the way every
  // other secret does. stack.tftest.hcl asserts the token is absent from BOTH
  // task definitions, so the invariant is checked rather than merely stated.
  secret_arn_prefix = "arn:${data.aws_partition.current.partition}:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${var.ssm_prefix}"

  app_secrets = [
    { name = "BETTER_AUTH_SECRET", valueFrom = "${local.secret_arn_prefix}/BETTER_AUTH_SECRET" },
    { name = "GITHUB_CLIENT_SECRET", valueFrom = "${local.secret_arn_prefix}/GITHUB_CLIENT_SECRET" },
    { name = "UPSTASH_REDIS_REST_TOKEN", valueFrom = "${local.secret_arn_prefix}/SRH_TOKEN" },
  ]

  worker_secrets = [
    { name = "UPSTASH_REDIS_REST_TOKEN", valueFrom = "${local.secret_arn_prefix}/SRH_TOKEN" },
    { name = "GITHUB_TOKEN", valueFrom = "${local.secret_arn_prefix}/GITHUB_TOKEN" },
  ]

  log_configuration = {
    for service in keys(aws_cloudwatch_log_group.main) : service => {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.main[service].name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }
}

// --- srh -------------------------------------------------------------------

resource "aws_ecs_task_definition" "srh" {
  family                   = "${var.name}-srh"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name      = "srh"
    image     = var.srh_image
    essential = true

    portMappings = [{ containerPort = 80, protocol = "tcp" }]

    environment = [
      { name = "SRH_MODE", value = "env" },
    ]

    secrets = [
      { name = "SRH_TOKEN", valueFrom = "${local.secret_arn_prefix}/SRH_TOKEN" },
      // The ARN, not the URL. `aws_ssm_parameter.redis_url` is referenced
      // directly rather than rebuilt from `local.secret_arn_prefix` so this
      // cannot drift from the resource that actually holds the value.
      { name = "SRH_CONNECTION_STRING", valueFrom = aws_ssm_parameter.redis_url.arn },
    ]

    // THE health check this stack turns on, and why it is not a liveness
    // probe. srh's own source says it:
    //
    //   # NOTE: Redix only seems to open the connection when the first command
    //   # is sent. This means that this will return :ok even if the connection
    //   # string may not actually be connectable
    //
    // So srh starts green against a wrong endpoint, a wrong AUTH token, or an
    // unreachable ElastiCache. A TCP open or a bare "is the process up" would
    // report a healthy stack whose Redis connection is broken, and the first
    // contestant submission would be what discovered it.
    //
    // This issues a REAL command through the REST interface with the bearer
    // token and requires a result back. It fails when Redis is unreachable,
    // when AUTH is wrong, and when TLS does not verify.
    healthCheck = {
      command = [
        "CMD-SHELL",
        "wget -q -O - --header=\"Authorization: Bearer $SRH_TOKEN\" http://127.0.0.1:80/ping | grep -q result || exit 1",
      ]
      interval    = 15
      timeout     = 5
      retries     = 3
      startPeriod = 20
    }

    logConfiguration = local.log_configuration["srh"]
  }])
}

resource "aws_ecs_service" "srh" {
  name            = "srh"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.srh.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.srh.id]
    assign_public_ip = true
  }

  service_registries {
    registry_arn = aws_service_discovery_service.srh.arn
  }

  // srh is the whole stack's data path: going to zero during a deploy means
  // the event is down, so a new task comes up before the old one leaves.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  wait_for_steady_state = true
}

// --- app -------------------------------------------------------------------

resource "aws_ecs_task_definition" "app" {
  family                   = "${var.name}-app"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.app_cpu
  memory                   = var.app_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name      = "app"
    image     = var.app_image
    essential = true

    portMappings = [{ containerPort = 3000, protocol = "tcp" }]

    environment = [
      { name = "NODE_ENV", value = "production" },
      // Read by BETTER_AUTH_URL, the HTTPS start-up guard and the CSRF origin
      // check. It differs per deployment, which is why it is not baked.
      { name = "EVENT_URL", value = local.event_url },
      { name = "BETTER_AUTH_URL", value = local.event_url },
      { name = "UPSTASH_REDIS_REST_URL", value = local.upstash_url },
      { name = "SCORE_INGEST", value = var.score_ingest },
      // Same contract as docker-compose.yml's SCORE_IMAGE: non-empty means
      // this deployment runs Secure Development (the scorer task exists),
      // and that is the ONLY module enabled before an organizer switches
      // others on in /admin (issue #386).
      { name = "SCORE_IMAGE", value = var.enable_secure_development ? var.scorer_image : "" },
      // Config v2 (#386): no build-time bake. The app reads these from its
      // own environment now, plain (non-secret) values, the same way
      // SCORE_IMAGE travels above.
      { name = "GITHUB_ORG", value = var.github_org },
      { name = "ADMIN_LOGINS", value = var.admin_logins },
    ]

    secrets = local.app_secrets

    logConfiguration = local.log_configuration["app"]
  }])
}

resource "aws_ecs_service" "app" {
  name            = "app"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.app_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = 3000
  }

  // The app cannot serve a page before srh answers, and the ALB health check
  // reads a page that touches Redis. Starting it first would fail that check
  // for real reasons and churn tasks while srh comes up.
  depends_on = [
    aws_ecs_service.srh,
    aws_lb_listener.https,
  ]

  health_check_grace_period_seconds = 60
  wait_for_steady_state             = true
}

// --- scorer ----------------------------------------------------------------

resource "aws_ecs_task_definition" "scorer" {
  count = local.run_scorer ? 1 : 0

  family                   = "${var.name}-scorer"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name      = "scorer"
    image     = var.scorer_image
    essential = true

    environment = [
      { name = "UPSTASH_REDIS_REST_URL", value = local.upstash_url },
      { name = "SCORE_INGEST", value = var.score_ingest },
    ]

    secrets          = local.worker_secrets
    logConfiguration = local.log_configuration["scorer"]
  }])
}

resource "aws_ecs_service" "scorer" {
  count = local.run_scorer ? 1 : 0

  name            = "scorer"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.scorer[0].arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.worker.id]
    assign_public_ip = true
  }

  depends_on = [aws_ecs_service.srh]
}

// --- sync ------------------------------------------------------------------

resource "aws_ecs_task_definition" "sync" {
  count = local.run_sync ? 1 : 0

  family                   = "${var.name}-sync"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name      = "sync"
    image     = var.sync_image
    essential = true

    environment = [
      { name = "UPSTASH_REDIS_REST_URL", value = local.upstash_url },
      // sync refuses to start without this (sync/src/config.js) — it decides
      // which org's PRs it polls, unlike the app's fallback to bare repo names.
      { name = "GITHUB_ORG", value = var.github_org },
    ]

    secrets          = local.worker_secrets
    logConfiguration = local.log_configuration["sync"]
  }])
}

// No volume, deliberately. The compose stack gave sync one for its cursor; the
// cursor lives in Redis (`ctf:sync:status`), so ephemeral Fargate storage costs
// nothing here — a restarted task resumes from the stored cursor rather than
// re-polling from the beginning.
resource "aws_ecs_service" "sync" {
  count = local.run_sync ? 1 : 0

  name            = "sync"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.sync[0].arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.worker.id]
    assign_public_ip = true
  }

  // Exactly one poller, never two: a second would double-ingest every score
  // comment. The old task goes before the new one arrives.
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  depends_on = [aws_ecs_service.srh]
}
