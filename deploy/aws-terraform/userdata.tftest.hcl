# Renders the real user-data script at PLAN time and asserts on the result.
#
# Why this file exists: `terraform validate` never inspects rendered template
# output, so it passed this module for its entire life while the bring-up
# script was fundamentally broken — every SSM lookup and the config bake used
# a doubled dollar, which Terraform does not treat as an escape, and bash read
# the result as the shell PID. Nothing in fmt/validate/`bash -n` can see that.
#
# `mock_provider` means no AWS credentials, no network and no `apply` — this
# is a plan-time render, safe to run in CI on every PR.
mock_provider "aws" {
  # Both are indexed/parsed downstream, so the defaults have to be shaped.
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{}" }
  }
  mock_data "aws_subnets" {
    defaults = { ids = ["subnet-0000000000000000f"] }
  }
}

variables {
  # A domain keeps `event_url` — and therefore user_data — KNOWN at plan time.
  # With it empty the URL interpolates an unknown EIP address, user_data
  # becomes unknown, and every assertion below has nothing to read.
  domain = "ctf.example.test"
  # Minimal valid event.yaml: `modules:` with one entry, base64-encoded.
  event_yaml_b64 = "bW9kdWxlczoKICBzZWN1cmUtZGV2ZWxvcG1lbnQ6CiAgICB0YXJnZXRzOiBbdmFtcGldCg=="
}

run "user_data_has_no_unescaped_double_dollar" {
  command = plan

  # THE regression guard. Terraform escapes only a doubled dollar before an
  # opening brace; anywhere else it renders two literal dollars and bash reads
  # them as the PID. A literal pair surviving into the rendered script means
  # someone "escaped" a bash construct that never needed it.
  assert {
    condition     = !strcontains(aws_instance.box.user_data, "$$")
    error_message = "rendered user-data contains a literal $$ — Terraform's only escape is a doubled dollar before an opening brace, and bash reads $$ as the shell PID. Write bash's $1 and $(cmd) with a single dollar."
  }
}

run "secret_lookups_render_as_real_bash" {
  command = plan

  # The specific shapes the bug destroyed: the ssm() helper's positional arg
  # and the config bake's command substitution.
  assert {
    condition     = strcontains(aws_instance.box.user_data, "--name \"/ctf-in-a-box/$1\"")
    error_message = "the ssm() helper's positional argument did not render as bash $1"
  }
  assert {
    condition     = strcontains(aws_instance.box.user_data, "EVENT_CONFIG_B64=\"$(base64 -w0 event.yaml)\"")
    error_message = "the EVENT_CONFIG_B64 bake did not render as a bash command substitution — an unbaked config yields an empty admins list and /admin 403s for everyone"
  }
}

run "terraform_variables_still_interpolate" {
  command = plan

  # The other half of the escaping rule: real Terraform interpolation must
  # still happen. A blanket find-and-replace of dollars would break this.
  assert {
    condition     = strcontains(aws_instance.box.user_data, "EVENT_URL=https://ctf.example.test")
    error_message = "event_url did not interpolate into the rendered user-data"
  }
  assert {
    condition     = !strcontains(aws_instance.box.user_data, "$${")
    error_message = "an un-interpolated Terraform placeholder survived into the rendered user-data"
  }
}

run "missing_required_secrets_fail_closed" {
  command = plan

  # `echo "K=$(ssm K)"` swallows a failed lookup — the substitution's status is
  # discarded and echo returns 0, so `set -e` never fires and the box boots
  # half-configured. The req() helper assigns first, then checks.
  assert {
    condition     = strcontains(aws_instance.box.user_data, "req BETTER_AUTH_SECRET")
    error_message = "required secrets are not read through the fail-closed req() helper"
  }
  assert {
    condition     = strcontains(aws_instance.box.user_data, "opt GITHUB_APP_INSTALLATION_ID")
    error_message = "the optional installation id should use opt(), which tolerates absence"
  }
}
