// Ingress. Replaces the Caddy container: TLS terminates here, on a certificate
// AWS renews, and the ALB health-checks the app natively.
//
// Two ways to get that certificate, and the module refuses the third:
//   - `route53_zone_id` set -> Terraform issues an ACM certificate, writes the
//     DNS validation records, waits for it, and creates the alias record.
//   - `acm_certificate_arn` -> an existing certificate is used, and DNS is the
//     operator's job.
//   - neither -> a plan-time failure with a sentence, rather than an ALB
//     listening on 443 with nothing to present.

locals {
  create_certificate = var.route53_zone_id != ""
  certificate_arn    = local.create_certificate ? aws_acm_certificate_validation.main[0].certificate_arn : var.acm_certificate_arn
}

check "tls_is_configured" {
  assert {
    condition     = var.route53_zone_id != "" || var.acm_certificate_arn != ""
    error_message = "Set route53_zone_id (Terraform issues the certificate) or acm_certificate_arn (you already have one). The session cookie is Secure, so there is no HTTP-only mode to fall back to."
  }
}

resource "aws_acm_certificate" "main" {
  count = local.create_certificate ? 1 : 0

  domain_name       = var.domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

// ONE record, not a for_each over `domain_validation_options`.
//
// The idiomatic for_each form cannot be planned: the option set is known only
// after apply, so Terraform refuses with "for_each map includes keys derived
// from resource attributes that cannot be determined until apply" — which also
// makes the module untestable. This certificate covers exactly one name and no
// SANs, so a single indexed record is both sufficient and plannable.
resource "aws_route53_record" "certificate_validation" {
  count = local.create_certificate ? 1 : 0

  zone_id         = var.route53_zone_id
  name            = tolist(aws_acm_certificate.main[0].domain_validation_options)[0].resource_record_name
  type            = tolist(aws_acm_certificate.main[0].domain_validation_options)[0].resource_record_type
  records         = [tolist(aws_acm_certificate.main[0].domain_validation_options)[0].resource_record_value]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "main" {
  count = local.create_certificate ? 1 : 0

  certificate_arn         = aws_acm_certificate.main[0].arn
  validation_record_fqdns = [aws_route53_record.certificate_validation[0].fqdn]
}

resource "aws_lb" "main" {
  name               = "${var.name}-alb"
  load_balancer_type = "application"
  subnets            = aws_subnet.public[*].id
  security_groups    = [aws_security_group.alb.id]

  idle_timeout               = 60
  drop_invalid_header_fields = true
  enable_deletion_protection = false
}

resource "aws_lb_target_group" "app" {
  name        = "${var.name}-app"
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  // `/health`, deliberately, and NOT `/` — which this checked first, on the
  // reasoning that a server-rendered page resolving the module nav through
  // Redis proves more than a liveness probe. Both halves of that turned out
  // wrong for this app.
  //
  // It proves less, not more. The app streams its shell with HTTP **200** and
  // delivers a render failure inside the body (issue #312: every /admin URL
  // returned the error boundary while every status-code probe saw 200). So a
  // 200 from `/` never established that the page rendered.
  //
  // And it is actively harmful. An unhealthy target is deregistered and its
  // task replaced, so a Redis blip would take out every app task at once —
  // while replacing them fixes nothing, because Redis is what is unwell. That
  // inverts the rule the rest of the stack follows: the pause/schedule reads
  // fail OPEN precisely so a Redis blip cannot drop live submissions, and
  // /health's own contract says a dependency check "would report the app
  // unhealthy when the app is fine, which is backwards for something a restart
  // policy acts on". An ALB health check is exactly that something.
  //
  // `/health` is liveness-only by construction: force-dynamic, no Redis, and
  // `no-store`. Whether the event's data layer is reachable is a question for
  // the admin Overview, which an organizer reads and acts on, not for a probe
  // wired to task replacement.
  health_check {
    path                = "/health"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  // Let an in-flight submission finish before a task goes away.
  deregistration_delay = 30

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = local.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

// Port 80 redirects and never serves: a contestant who types the hostname
// should still arrive, and should arrive over TLS.
resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_route53_record" "app" {
  count = local.create_certificate ? 1 : 0

  zone_id = var.route53_zone_id
  name    = var.domain
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}
