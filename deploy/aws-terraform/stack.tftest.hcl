// What `terraform validate` cannot see.
//
// The EC2 module had `userdata.tftest.hcl` for exactly this reason, recorded in
// AGENTS.md: validate does NOT inspect rendered template output, so the
// bring-up script needed a test that read it. Fargate has no user-data, and the
// equivalent blind spot is the CONTAINER DEFINITIONS — a JSON blob validate
// treats as an opaque string. Everything that could silently ship wrong lives
// in there: image references, the srh-to-ElastiCache wiring, whether a secret
// is a reference or a value, and whether the health check proves anything.
//
// `command = plan` throughout: these assert what WOULD be created, and need no
// AWS credentials.

// Mocked providers: no credentials, no network, no apply — the same posture
// the EC2 module's user-data test used. Mocks fill in COMPUTED attributes
// only, so everything this file actually asserts (container definitions,
// security group references, the connection string) is the module's own
// configured value, not a mock.
mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "123456789012"
    }
  }

  mock_data "aws_partition" {
    defaults = {
      partition = "aws"
    }
  }

  // `.json` on a mocked policy document is a mock STRING, and the IAM
  // resources parse it — so it has to be real JSON or every plan fails before
  // reaching an assertion.
  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }

  mock_data "aws_availability_zones" {
    defaults = {
      names = ["us-east-1a", "us-east-1b"]
    }
  }

  // The certificate's validation options are computed, and the DNS record
  // reads them — without a default the plan cannot resolve the index.
  mock_resource "aws_acm_certificate" {
    defaults = {
      arn = "arn:aws:acm:us-east-1:123456789012:certificate/11111111-2222-3333-4444-555555555555"
      domain_validation_options = [{
        domain_name           = "ctf.example.org"
        resource_record_name  = "_acme.ctf.example.org."
        resource_record_type  = "CNAME"
        resource_record_value = "validation.acm-validations.aws."
      }]
    }
  }

  // Several resources validate that an ARN handed to them looks like one, so
  // the mocked roles need real-shaped values rather than the random ids a bare
  // mock produces.
  mock_resource "aws_iam_role" {
    defaults = {
      arn = "arn:aws:iam::123456789012:role/mock-role"
    }
  }

  mock_resource "aws_lb" {
    defaults = {
      arn      = "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/mock/0123456789abcdef"
      dns_name = "mock-alb-123456789.us-east-1.elb.amazonaws.com"
      zone_id  = "Z35SXDOTRQ7X7K"
    }
  }

  mock_resource "aws_lb_target_group" {
    defaults = {
      arn = "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/mock/0123456789abcdef"
    }
  }

  mock_resource "aws_service_discovery_service" {
    defaults = {
      arn = "arn:aws:servicediscovery:us-east-1:123456789012:service/srv-mock"
    }
  }

  // The listener validates that its certificate is a real ARN, so the mocked
  // validation has to hand back one.
  mock_resource "aws_acm_certificate_validation" {
    defaults = {
      certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/11111111-2222-3333-4444-555555555555"
    }
  }

  // The one computed value the srh wiring depends on. A realistic ElastiCache
  // endpoint, so the "reach it by hostname" assertion is meaningful.
  mock_resource "aws_elasticache_replication_group" {
    defaults = {
      primary_endpoint_address = "ctf-redis.abc123.ng.0001.use1.cache.amazonaws.com"
    }
  }
}

mock_provider "random" {

  mock_resource "random_password" {
    defaults = {
      result = "MOCKAUTHTOKENvalue0000000000000000000000000000000000000000000000"
    }
  }
}

variables {
  domain          = "ctf.example.org"
  route53_zone_id = "Z0123456789ABCDEFGHIJ"
  event_yaml_b64  = "ZXZlbnQ6CiAgbmFtZTogVGVzdAo="
  app_image       = "123456789012.dkr.ecr.us-east-1.amazonaws.com/owasp-ctf-app:v1"
  scorer_image    = "ghcr.io/example/scorer:v1"
  sync_image      = "ghcr.io/example/sync:v1"
}

// --- the input contracts, each one refused at PLAN time --------------------
//
// These four were added with the validations they exercise (PR #354's
// review). Every one of them was previously a mid-apply AWS API error, which
// is the failure mode variables.tf's header says these blocks exist to
// prevent — and the only way to keep that promise honest is to assert the
// refusal rather than assume it.

run "an_over_long_name_is_refused_before_the_alb_rejects_it" {
  command = plan

  variables {
    // 29 characters: legal under the old 3-32 rule, and fatal once alb.tf
    // appends `-alb` and `-app` against AWS's 32-character cap.
    name = "abcdefghij-abcdefghij-abcdef1"
  }

  expect_failures = [var.name]
}

run "secure_development_without_a_scorer_image_is_refused" {
  command = plan

  variables {
    enable_secure_development = true
    scorer_image              = ""
  }

  expect_failures = [var.scorer_image]
}

run "poll_mode_without_a_sync_image_is_refused" {
  command = plan

  variables {
    enable_secure_development = true
    score_ingest              = "poll"
    sync_image                = ""
  }

  expect_failures = [var.sync_image]
}

// The complement of the run above, and the reason sync_image's rule is
// narrower than scorer_image's: push mode has the fork's Action POST to the
// scorer directly, so there is no poller and no image to demand. Without this
// the validation could tighten to "always required" and no test would notice.
run "push_mode_needs_no_sync_image" {
  command = plan

  variables {
    enable_secure_development = true
    score_ingest              = "push"
    sync_image                = ""
  }

  assert {
    condition     = length(aws_ecs_service.sync) == 0
    error_message = "Push mode runs no poller, so it must not require a sync image."
  }
}

run "an_event_with_no_certificate_source_is_refused" {
  command = plan

  variables {
    route53_zone_id     = ""
    acm_certificate_arn = ""
  }

  // alb.tf's `check` block reports the same condition, but a failed check is
  // a WARNING: the apply would continue and hand the HTTPS listener an empty
  // certificate ARN. This asserts the input is refused outright.
  expect_failures = [var.acm_certificate_arn]
}

// --- module enablement follows the compose profiles -----------------------

run "secure_development_event_runs_scorer_and_sync" {
  command = plan

  variables {
    enable_secure_development = true
    score_ingest              = "poll"
  }

  assert {
    condition     = length(aws_ecs_service.scorer) == 1 && length(aws_ecs_service.sync) == 1
    error_message = "A poll-mode secure-development event runs both the scorer and sync."
  }

  assert {
    condition     = aws_ecs_service.app.desired_count >= 1
    error_message = "The app runs on every event."
  }

  assert {
    condition = anytrue([
      for e in jsondecode(aws_ecs_task_definition.app.container_definitions)[0].environment :
      e.name == "SCORE_IMAGE" && e.value == var.scorer_image
    ])
    error_message = "app container must receive SCORE_IMAGE so the default module set matches the deployment"
  }
}

run "push_mode_runs_no_poller" {
  command = plan

  variables {
    enable_secure_development = true
    score_ingest              = "push"
  }

  assert {
    condition     = length(aws_ecs_service.scorer) == 1
    error_message = "Push mode still needs the scorer — the fork's Action POSTs to it."
  }

  assert {
    // sync carries the ["poll"] profile alone: in push mode there is nothing
    // to poll, and a running poller would be a second ingest path.
    condition     = length(aws_ecs_service.sync) == 0
    error_message = "Push mode must run no sync: the fork POSTs directly, so there is nothing to poll."
  }
}

run "quiz_only_event_runs_neither" {
  command = plan

  variables {
    enable_secure_development = false
    scorer_image              = ""
    sync_image                = ""
  }

  assert {
    condition     = length(aws_ecs_service.scorer) == 0 && length(aws_ecs_service.sync) == 0
    error_message = "An event without secure-development must bring up neither service — it has no forks, and no scorer image to pull."
  }

  assert {
    condition = anytrue([
      for e in jsondecode(aws_ecs_task_definition.app.container_definitions)[0].environment :
      e.name == "SCORE_IMAGE" && e.value == ""
    ])
    error_message = "A quiz-only event must hand the app an empty SCORE_IMAGE — the SD toggle must be refused by default."
  }
}

// --- inputs that would produce a broken stack -----------------------------

run "a_floating_srh_tag_is_refused" {
  command = plan

  variables {
    srh_image = "hiett/serverless-redis-http:latest"
  }

  expect_failures = [var.srh_image]
}

run "a_missing_event_config_is_refused" {
  command = plan

  variables {
    event_yaml_b64 = ""
  }

  // An app image built without it silently has an empty admins list, so
  // /admin 403s for everyone. Failing here beats discovering that at the door.
  expect_failures = [var.event_yaml_b64]
}

run "snapshots_cannot_be_turned_off" {
  command = plan

  variables {
    cache_snapshot_retention_days = 0
  }

  // At 0 ElastiCache takes no backups at all, and this cache IS the event.
  expect_failures = [var.cache_snapshot_retention_days]
}

// --- the srh <-> ElastiCache wiring ---------------------------------------

// `apply`, not `plan`: the connection string embeds the ElastiCache endpoint
// and the generated token, both computed, and a plan cannot evaluate a
// condition that reads them. Nothing is created — the providers are mocked.
run "srh_talks_tls_to_the_cache_by_hostname" {
  command = apply

  assert {
    // `rediss://` is what turns TLS on inside srh — it detects the scheme
    // rather than taking a flag. A plain `redis://` here would silently
    // downgrade the whole data path to plaintext.
    condition     = startswith(local.redis_url, "rediss://")
    error_message = "srh's connection string must use rediss:// — that scheme is how srh decides to enable TLS at all."
  }

  assert {
    // srh verifies the hostname (pkix_verify_hostname_match_fun(:https)), so
    // the endpoint has to be the name on the certificate, never an address.
    condition     = can(regex("@[a-z0-9.-]+[a-z][a-z0-9.-]*:6379$", local.redis_url))
    error_message = "srh must reach ElastiCache by hostname: hostname verification is on, and a certificate does not match an IP."
  }

  assert {
    condition     = aws_elasticache_replication_group.main.transit_encryption_enabled
    error_message = "In-transit encryption must stay on — srh supports it, so there is no reason to run the data path in the clear."
  }
}

// --- ADR 41: the app has no path to Redis ---------------------------------

run "only_srh_may_reach_elasticache" {
  command = plan

  assert {
    condition     = aws_vpc_security_group_ingress_rule.cache_from_srh.referenced_security_group_id == aws_security_group.srh.id
    error_message = "ElastiCache must accept traffic from srh's security group and nothing else — that is ADR 41's boundary."
  }

  assert {
    condition     = aws_vpc_security_group_ingress_rule.cache_from_srh.referenced_security_group_id != aws_security_group.app.id
    error_message = "The app must never reach Redis directly; it speaks Upstash-REST to srh (ADR 41)."
  }

  assert {
    condition     = aws_vpc_security_group_ingress_rule.app_from_alb.referenced_security_group_id == aws_security_group.alb.id
    error_message = "The app must be reachable only from the ALB."
  }
}

// --- secrets are references, never values ---------------------------------

run "no_secret_is_baked_into_a_task_definition" {
  command = plan

  assert {
    // A task definition is readable by anyone with
    // ecs:DescribeTaskDefinition, so a secret in `environment` is a secret
    // published. Every one must arrive through `secrets[].valueFrom`.
    condition     = alltrue([for s in local.app_secrets : startswith(s.valueFrom, "arn:")])
    error_message = "Every app secret must be an SSM ARN reference, not a literal value."
  }

  assert {
    condition     = alltrue([for s in local.worker_secrets : startswith(s.valueFrom, "arn:")])
    error_message = "Every worker secret must be an SSM ARN reference, not a literal value."
  }

  assert {
    // The AUTH token is the one secret Terraform generates rather than reads,
    // which makes it the one most likely to end up somewhere plain.
    condition     = !strcontains(aws_ecs_task_definition.app.container_definitions, random_password.cache_auth.result)
    error_message = "The Redis AUTH token must never appear in the app task definition."
  }

  assert {
    // srh TOO, which is the half this suite used to miss. The earlier version
    // asserted only the app, reasoning that "the app has no business holding
    // it — only srh does" — and that reasoning is exactly what let the token
    // sit in srh's `environment` in plaintext until PR #354's review. srh
    // needing the value does not mean srh's task definition should publish
    // it: `ecs:DescribeTaskDefinition` reads both alike.
    condition     = !strcontains(aws_ecs_task_definition.srh.container_definitions, random_password.cache_auth.result)
    error_message = "The Redis AUTH token must never appear in the srh task definition either — it arrives through secrets[].valueFrom."
  }

  assert {
    // The positive half of the assertion above. Absence alone could also mean
    // the variable was dropped entirely, which would leave srh unable to
    // connect and this suite still green.
    //
    // Decoded rather than string-matched: under `mock_provider` the parameter
    // ARN is a random placeholder, so asserting the task definition contains
    // the ARN (or the parameter name) tests the mock, not the wiring. What
    // matters structurally is that the variable is in `secrets` and NOT in
    // `environment`.
    // `valueFrom` is checked, not just the name: a secret entry with the right
    // name and an empty reference satisfies "is present" while ECS rejects the
    // task definition outright, so name-only would be a green test for a
    // stack that cannot deploy.
    condition = anytrue([
      for s in jsondecode(aws_ecs_task_definition.srh.container_definitions)[0].secrets :
      s.name == "SRH_CONNECTION_STRING" && try(s.valueFrom != null && s.valueFrom != "", false)
    ])
    error_message = "srh must still receive SRH_CONNECTION_STRING, through a non-empty secrets[].valueFrom."
  }

  assert {
    condition = !anytrue([
      for e in jsondecode(aws_ecs_task_definition.srh.container_definitions)[0].environment :
      e.name == "SRH_CONNECTION_STRING"
    ])
    error_message = "SRH_CONNECTION_STRING must not be an `environment` entry — that publishes the AUTH token to ecs:DescribeTaskDefinition."
  }

  assert {
    condition     = aws_ssm_parameter.cache_auth.type == "SecureString"
    error_message = "The generated AUTH token must be stored as a SecureString."
  }

  assert {
    condition     = aws_ssm_parameter.redis_url.type == "SecureString"
    error_message = "The assembled connection string embeds the AUTH token, so it must be a SecureString, not a String."
  }

  assert {
    // Both generated parameters must use the event's own key, or the scoped
    // kms:Decrypt grant cannot read them and the tasks fail to start.
    condition     = aws_ssm_parameter.cache_auth.key_id == aws_kms_key.secrets.arn && aws_ssm_parameter.redis_url.key_id == aws_kms_key.secrets.arn
    error_message = "Both generated SecureStrings must be encrypted with this event's KMS key."
  }
}

// --- the execution role's decrypt grant names one key ----------------------

run "the_secret_grants_name_resources_never_a_wildcard" {
  command = plan

  assert {
    // `kms:Decrypt` on "*" with only a `kms:ViaService` condition lets this
    // role decrypt every SecureString in the account that delegates to IAM —
    // another event's, another team's. Naming the key is the fix; this is
    // what stops the wildcard coming back.
    //
    // Asserted against the LOCAL, not a data source's rendered json: see the
    // note in iam.tf. The data source's json is provider-computed, so under
    // mock_provider its Statement list is empty and this very assertion
    // passed while proving nothing.
    condition     = alltrue([for s in local.execution_secrets_policy.Statement : !contains(s.Resource, "*")])
    error_message = "No statement in the execution role's secret policy may use a \"*\" resource — kms:Decrypt must name this event's key."
  }

  assert {
    // Non-vacuity guard for the assertion above: it is an `alltrue` over a
    // list, so an empty (or renamed) policy would satisfy it trivially. This
    // pins that the two statements are actually there.
    condition     = length(local.execution_secrets_policy.Statement) == 2
    error_message = "Expected exactly two statements (read parameters, decrypt them) — update these assertions deliberately if that changes."
  }

  assert {
    condition = anytrue([
      for s in local.execution_secrets_policy.Statement :
      contains(s.Action, "kms:Decrypt") && s.Resource == [aws_kms_key.secrets.arn]
    ])
    error_message = "The execution role still needs kms:Decrypt, scoped to this event's key — the grant should be narrowed, not removed."
  }

  assert {
    // The parameter-read grant, pinned to the event's own prefix.
    //
    // The `contains(s.Resource, "*")` assertion above does NOT cover this: it
    // matches an element equal to `"*"`, and a wildcard INSIDE an ARN is a
    // different thing — which this statement legitimately uses, as
    // `…:parameter/<prefix>/*`. So a resource widened to `…:parameter/*`, or
    // to another event's prefix, would pass every other check here. Equality
    // against the intended ARN is what actually pins it.
    condition = anytrue([
      for s in local.execution_secrets_policy.Statement :
      contains(s.Action, "ssm:GetParameters") &&
      s.Resource == ["arn:${data.aws_partition.current.partition}:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${var.ssm_prefix}/*"]
    ])
    error_message = "ssm:GetParameters must be scoped to this event's parameter prefix, not a wider path."
  }
}

// --- the health check has to prove Redis, not liveness --------------------

run "srh_health_check_issues_a_real_command" {
  command = plan

  assert {
    // srh's own source: Redix opens the connection lazily, so srh starts green
    // against an unreachable ElastiCache or a wrong AUTH token. A check that
    // only proves the process is up would report a healthy stack whose data
    // path is broken, and the first contestant submission would find out.
    condition     = strcontains(aws_ecs_task_definition.srh.container_definitions, "Authorization: Bearer")
    error_message = "srh's health check must issue an authenticated request — an unauthenticated or TCP-only probe passes while Redis is unreachable."
  }

  assert {
    condition     = strcontains(aws_ecs_task_definition.srh.container_definitions, "grep -q result")
    error_message = "srh's health check must require a real reply body: srh answers before it has ever contacted Redis."
  }
}

// --- the app's health check is liveness-only, unlike srh's ----------------

run "the_app_health_check_does_not_depend_on_redis" {
  command = plan

  assert {
    // The opposite of the assertion above, on purpose. srh's job IS to reach
    // Redis, so a probe that proves it did belongs there. The app's job is to
    // serve an event whose pause/schedule reads deliberately fail OPEN, so a
    // Redis blip must not cost it anything — and an unhealthy target here is
    // deregistered and its task replaced, which cannot fix Redis and would
    // take out every task at once.
    //
    // `/` was the original choice and is wrong twice over: the app streams its
    // shell with HTTP 200 and puts render failures in the BODY (#312), so a 200
    // from `/` never proved the page rendered either.
    condition     = aws_lb_target_group.app.health_check[0].path == "/health"
    error_message = "The ALB must health-check /health, not a page that reads Redis: a blip would deregister every app task, and a 200 from a streamed shell does not prove it rendered anyway (#312)."
  }
}

// --- the app reaches Redis only through srh -------------------------------

run "the_app_is_pointed_at_srh_not_at_redis" {
  command = plan

  assert {
    condition     = strcontains(aws_ecs_task_definition.app.container_definitions, local.upstash_url)
    error_message = "The app must be given srh's URL as UPSTASH_REDIS_REST_URL."
  }

  assert {
    condition     = !strcontains(aws_ecs_task_definition.app.container_definitions, "rediss://")
    error_message = "The app must never be handed a raw Redis URL — it speaks Upstash-REST only (ADR 41)."
  }
}
