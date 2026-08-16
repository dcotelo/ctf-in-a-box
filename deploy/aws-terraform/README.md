# Single-shot AWS deploy (Terraform)

Stand the CTF-in-a-box control plane up on **one x86_64 EC2 instance** for the
duration of an event, then tear it down. `terraform apply` up, `terraform
destroy` down. This is the runtime box only — see the prerequisites.

The box runs the compose stack in **poll mode**, so it needs no inbound network
for scoring (the `sync` service polls GitHub outbound). Inbound `443`/`80` only
serve the public leaderboard and GitHub sign-in.

Full walkthrough: [`docs/aws.md`](../../docs/aws.md).

## Prerequisites (done once, OFF the box)

1. **Provision the GitHub org** from your laptop: `./setup/ctf-setup.sh org`
   (needs your `gh` auth). The AWS box does not provision the org.
2. **Create the two GitHub apps** with the OAuth callback at your final domain:
   `https://<domain>/api/auth/callback/github` — so pick the domain first.
   Use `./setup/ctf-setup.sh app-manifest`/`app-config` (GitHub App) and
   `oauth-app`/`oauth-config` (OAuth app) locally to get the values.
3. **Put the SECRETS in SSM Parameter Store** as `SecureString`s under
   `var.ssm_prefix` — so they never enter Terraform state. Example:

   ```sh
   P=/ctf-in-a-box
   aws ssm put-parameter --type SecureString --name $P/BETTER_AUTH_SECRET     --value "$(openssl rand -base64 32)"
   aws ssm put-parameter --type SecureString --name $P/SRH_TOKEN              --value "$(openssl rand -hex 24)"
   aws ssm put-parameter --type SecureString --name $P/SCORER_TOKEN           --value "$(openssl rand -hex 24)"
   aws ssm put-parameter --type SecureString --name $P/GITHUB_CLIENT_ID       --value "Ov23li..."
   aws ssm put-parameter --type SecureString --name $P/GITHUB_CLIENT_SECRET   --value "..."
   aws ssm put-parameter --type SecureString --name $P/GITHUB_APP_ID          --value "123456"
   aws ssm put-parameter --type SecureString --name $P/GITHUB_APP_PRIVATE_KEY --value "$(base64 < app.private-key.pem | tr -d '\n')"
   # optional: aws ssm put-parameter --type SecureString --name $P/GITHUB_APP_INSTALLATION_ID --value "..."
   ```

## Deploy

```sh
cd deploy/aws-terraform
cp terraform.tfvars.example terraform.tfvars   # then edit
terraform init
terraform apply
```

Then, per the `next_steps` output: point DNS at the EIP (unless you set
`route53_zone_id`), confirm the OAuth callback matches the domain, and watch
`/var/log/ctf-bringup.log` via SSM Session Manager.

## Tear down

```sh
terraform destroy
```

## Notes / gotchas

- **x86_64 only.** The scorer image is amd64; ARM/Graviton would need rebuilds.
  The scorer is built **on the box**, so no GHCR credentials are needed.
- **Terraform state holds no secrets** by design — they live in SSM and are
  fetched by the instance role at boot. Do **not** move them into `.tfvars`
  (that would put them in state). Still use an encrypted remote backend for a
  real event.
- **HTTPS is required for a real event.** Set `domain`; Caddy provisions TLS and
  the session cookie is only `Secure` over HTTPS. An empty `domain` runs HTTP on
  the EIP — local testing only.
- **Everything is tagged** via the provider's `default_tags`
  (`Project=ctf-in-a-box`, `ManagedBy=terraform`, `Event=<name>`) so the whole
  event is easy to filter and clean up. Add your own (owner, cost center,
  expiry) with `var.tags`.
- **DNS in another account?** Leave `route53_zone_id` empty and create the A
  record yourself, in whatever account holds the zone, pointing at the
  `public_ip` output. Terraform only manages the record when the zone is in the
  same account (`route53_zone_id` set) — it does not reach across accounts.
- **Shell without SSH:** `aws ssm start-session --target <instance_id>` (the
  instance has the SSM core policy). Set `ssh_ingress_cidrs` only if you must.
- **State is reconstructible:** poll mode re-reads scores from the GitHub PR
  comments, so a replaced box repopulates its leaderboard from GitHub.
- **CI-validated:** `.github/workflows/terraform.yml` runs `fmt -check` +
  `validate` on any change here (never `apply`).

