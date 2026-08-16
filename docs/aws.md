---
title: Deploy on AWS
---

# Deploy on AWS (single-shot, Terraform)

The kit is Docker Compose, so the simplest cloud deploy is **one x86_64 EC2
instance running the compose stack**, brought up by `user-data` and torn down
when the event ends. A Terraform module ships this: `terraform apply` up,
`terraform destroy` down — the single-shot lifecycle for an ephemeral event.

The module lives at
[`deploy/aws-terraform/`](https://github.com/dcotelo/ctf-in-a-box/tree/main/deploy/aws-terraform);
this page is the walkthrough. It stands up the **runtime** control plane only —
provisioning the GitHub org is a separate one-time step (below).

## Why a single EC2, not ECS/EKS

- The app image **bakes `event.yaml` at build time** (`EVENT_CONFIG_B64`) and
  `sync`/scorer are built from source — a plain `docker compose … up --build`
  on one host is far less friction than translating build steps to a task
  definition.
- **Poll mode** (the default) needs **no inbound** for scoring: `sync` polls
  GitHub outbound. Inbound `443`/`80` only serve the public leaderboard and
  sign-in. Minimal attack surface.
- The box is **reconstructible**: poll mode re-reads scores from the GitHub PR
  comments, so a replaced instance repopulates its leaderboard from GitHub.

## Prerequisites (once, off the box)

1. **Provision the org** from your laptop: `./setup/ctf-setup.sh org` (uses your
   `gh` auth + local `docker login ghcr.io`). See the
   [Quickstart](hosting.md#quickstart-zero-to-a-scored-event).
2. **Pick the domain first**, then create the two GitHub apps with the OAuth
   callback at `https://<domain>/api/auth/callback/github` (`ctf-setup.sh
   app-manifest`/`app-config` and `oauth-app`/`oauth-config`).
3. **Store the secrets in SSM Parameter Store** as `SecureString`s under a path
   prefix (default `/ctf-in-a-box`) so they never enter Terraform state. The
   full `aws ssm put-parameter` list is in the module
   [README](https://github.com/dcotelo/ctf-in-a-box/tree/main/deploy/aws-terraform#prerequisites-done-once-off-the-box).

## Deploy

```sh
cd deploy/aws-terraform
cp terraform.tfvars.example terraform.tfvars   # edit: domain, region, event_yaml_b64, ssm_prefix
terraform init
terraform apply
```

Terraform creates an EC2 instance (Amazon Linux 2023, x86_64), an Elastic IP, a
locked-down security group (in: 443/80; SSH only if you ask), an instance role
that can read **only** this event's SSM secrets, and — if you set
`route53_zone_id` — the DNS A record. `user-data` then installs Docker, clones
the pinned release, fetches the secrets, **builds the scorer on the box** (so no
GHCR credentials are needed), and runs
`docker compose --profile poll --profile app up -d --build`.

Watch the bring-up without opening SSH:

```sh
aws ssm start-session --target <instance_id>   # from the terraform output
sudo tail -f /var/log/ctf-bringup.log
```

## Tear down

```sh
terraform destroy
```

## Notes

- **x86_64 only** — the scorer image is amd64.
- **HTTPS is required for a real event.** Set `domain`; Caddy auto-provisions
  TLS and the session cookie is only `Secure` over HTTPS (see the
  [hardening note](hosting.md#github-oauth-app)). An empty `domain` runs HTTP on
  the EIP — local testing only.
- **Secrets stay out of Terraform state** — they live in SSM and are read by the
  instance role at boot. Keep them out of `.tfvars`, and use an encrypted remote
  backend for a real event.
- **Everything is tagged** (`Project` / `ManagedBy` / `Event`, extend with
  `var.tags`) so the event's resources are easy to filter and tear down.
- **DNS in another account** (e.g. the box in a throwaway account, the zone in
  your main one): leave `route53_zone_id` empty and create the A record yourself
  in that account, pointing at the module's `public_ip` output. Terraform only
  manages the record when the zone is in the same account.
- **Changes to the module are CI-validated** —
  `.github/workflows/terraform.yml` runs `terraform fmt -check` + `validate` on
  any change under `deploy/aws-terraform/`. It never applies infrastructure;
  real applies are run by an operator locally.
- Kubernetes is tracked separately (Helm chart,
  [issue #54](https://github.com/dcotelo/ctf-in-a-box/issues/54)).
