// Where deploy.sh pushes the image ECS pulls.
//
// The EC2 box built its images ON the instance from a git checkout. Fargate
// pulls prebuilt ones, which moves the build off the box and into a deploy
// step. deploy.sh owns that; Terraform cannot build an image. Config v2
// (#386) removed the app's build-time config — GITHUB_ORG and ADMIN_LOGINS
// are runtime environment reads (ecs.tf) now, so the image itself no longer
// varies per event.
//
// Scanning is on: this image carries the event, and a base-image CVE is worth
// hearing about from the registry rather than from a contestant.

locals {
  // sync exists only in poll mode; in push mode the fork's Action POSTs to the
  // scorer directly. Both exist only when this event runs secure-development.
  // Same rule as the compose profiles, and the reason a quiz-only event brings
  // up neither.
  run_scorer = var.enable_secure_development
  run_sync   = var.enable_secure_development && var.score_ingest == "poll"

  // Only the app is built by this module's own deploy.sh. The scorer and sync
  // images are the kit's own and are pulled from wherever the operator points
  // them.
  repositories = toset(["app"])
}

resource "aws_ecr_repository" "main" {
  for_each = local.repositories

  name = "${var.name}-${each.key}"

  // Immutable tags: a deploy that reuses a tag with different content would
  // make "which image is running" unanswerable after the fact.
  image_tag_mutability = "IMMUTABLE"

  // The whole point of this module is that `terraform destroy` ends the event.
  // A repository that refuses to go because it still holds images would leave
  // that half-done.
  force_delete = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

// An event is a handful of deploys and every one keeps a tag. Ten is enough to
// roll back through a bad afternoon without paying to store a year of them.
resource "aws_ecr_lifecycle_policy" "main" {
  for_each = aws_ecr_repository.main

  repository = each.value.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}
