// Two roles per the ECS split, kept genuinely distinct.
//
//   - EXECUTION role: what the ECS agent uses to START a task — pull the
//     image, resolve `secrets[].valueFrom`, write to the log group. The
//     container never holds these credentials.
//   - TASK role: what the application code inside the container gets. Created
//     with NO policies attached, deliberately: nothing in this stack calls an
//     AWS API at runtime. The app speaks to srh, srh speaks to ElastiCache,
//     sync speaks to GitHub. Attaching anything here would hand a
//     contestant-facing container an AWS identity it has no use for.
//
// The execution role's secret access is scoped to the event's own SSM prefix
// rather than `ssm:*`: an execution role that can read every parameter in the
// account is a lateral-movement primitive, and this one needs a handful of
// values.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    // Confused-deputy guard: assumable only on behalf of a task in THIS
    // account.
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "execution" {
  name_prefix        = "${var.name}-exec-"
  description        = "ECS agent: pull images, read this event's secrets, write logs"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    sid     = "ReadThisEventsSecrets"
    effect  = "Allow"
    actions = ["ssm:GetParameters"]
    resources = [
      "arn:${data.aws_partition.current.partition}:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${var.ssm_prefix}/*",
    ]
  }

  // SecureStrings are decrypted with the account's default SSM key unless the
  // operator chose another. The grant is narrowed to SSM's use of KMS rather
  // than to KMS generally, so this role cannot decrypt anything that did not
  // come through Parameter Store.
  statement {
    sid       = "DecryptSecureStrings"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "read-event-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

// Deliberately policy-less — see the header. It exists so every task
// definition names one, which makes "this container has no AWS permissions" an
// explicit statement rather than an omission somebody later fills in by
// accident.
resource "aws_iam_role" "task" {
  name_prefix        = "${var.name}-task-"
  description        = "Application identity. No policies: nothing here calls an AWS API."
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}
