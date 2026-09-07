# AWS deploy: ECS Fargate + ElastiCache + ALB (Terraform)

Stand the CTF-in-a-box control plane up as a **managed AWS stack** for the
duration of an event, then tear it down. `terraform apply` up, `terraform
destroy` down.

**This replaced a single EC2 instance running docker-compose.** If you deployed
an earlier version of this module, read
[Migrating from the EC2 box](#migrating-from-the-ec2-box) before upgrading — it
is a breaking change, not an in-place one.

Full walkthrough: [`docs/aws.md`](../../docs/aws.md).

## What it builds

```
                  internet
                     │  443
              ┌──────▼──────┐
              │  ALB + ACM  │  TLS terminates here
              └──────┬──────┘
                     │  3000
        ┌────────────▼────────────┐
        │  app  (Fargate, N=2)    │────┐
        └─────────────────────────┘    │
        ┌─────────────────────────┐    │ 80
        │  scorer / sync          │────┤   (Upstash REST only)
        │  (secure-development)   │    │
        └─────────────────────────┘    │
                            ┌──────────▼──────────┐
                            │  srh (Fargate)      │  the Upstash-REST shim
                            └──────────┬──────────┘
                                       │ 6379, rediss:// + AUTH
                            ┌──────────▼──────────┐
                            │  ElastiCache Redis  │  private subnets
                            └─────────────────────┘
```

`srh` stays. The app, scorer and sync speak **only** the Upstash REST API and
never raw Redis, so ElastiCache changed exactly one thing: what `srh` connects
*to*. Everything upstream of it is the same code as the compose stack.

**The isolation is in the security groups, not the subnets** — ADR 41's rule,
carried over intact:

| from | to | port |
|---|---|---|
| `web_ingress_cidrs` | ALB | 443 (80 redirects) |
| ALB | app | 3000 |
| app, scorer, sync | srh | 80 |
| srh | ElastiCache | 6379 |

The app security group has **no route to ElastiCache**. The bearer token is not
the only thing standing between a compromised app container and the raw
keyspace; the network is.

Tasks run in **public subnets with a public IP and no permitted inbound**,
because they need egress (pull images, read secrets, and for `sync`, reach
GitHub) and the alternatives cost real money: a NAT gateway is roughly the price
of the entire EC2 instance this module replaces, per AZ, before a byte moves.
`network.tf` argues this at length. ElastiCache is the exception and stays
private — it needs no egress at all.

## What it costs

The honest headline: **this is several times the price of the EC2 box it
replaces.** Rough `us-east-1` on-demand, per month, at the defaults:

| | ~USD/mo |
|---|---|
| ALB | 16 + LCUs |
| app tasks (2 × 1 vCPU / 2 GB) | 72 |
| srh task | 9 |
| ElastiCache `cache.t4g.micro` × 2 (primary + replica) | 24 |
| CloudWatch Logs, ECR storage | a few |
| **total** | **~125–140** |
| *the EC2 box this replaced (t3.medium + EBS)* | *~35* |

Order-of-magnitude only — check the AWS calculator for your region, and note
these are *monthly* figures for a stack you are expected to `destroy` after a
weekend event, where the real bill is hours, not months.

Turn the dials if that is too much: `app_desired_count = 1` (loses zero-downtime
deploys), `cache_replica_count = 0` (loses automatic failover, single-AZ). What
the money buys is managed durability, no instance to patch, and a load balancer
that can replace a task without dropping the event.

## Prerequisites (done once, off the stack)

1. **Provision the GitHub org** from your laptop: `./setup/ctf-setup.sh org`
   (needs your `gh` auth). AWS does not provision the org.
2. **Create the GitHub OAuth app** with the callback at your final domain,
   `https://<domain>/api/auth/callback/github` — so pick the domain first.
3. **Put the secrets in SSM Parameter Store** as `SecureString`s under
   `var.ssm_prefix`. The task execution role may read `<prefix>/*` and nothing
   else; task definitions reference them by `valueFrom`, so no secret is ever a
   plaintext env var in a definition:

   ```sh
   P=/ctf-in-a-box
   aws ssm put-parameter --type SecureString --name $P/BETTER_AUTH_SECRET   --value "$(openssl rand -base64 32)"
   aws ssm put-parameter --type SecureString --name $P/SRH_TOKEN            --value "$(openssl rand -hex 24)"
   aws ssm put-parameter --type SecureString --name $P/GITHUB_CLIENT_SECRET --value "..."
   aws ssm put-parameter --type SecureString --name $P/GITHUB_TOKEN         --value "..."   # secure-development only
   ```

   `REDIS_AUTH_TOKEN` is **not** in that list: Terraform generates it and writes
   it to `<prefix>/REDIS_AUTH_TOKEN` itself, so operators and tasks read it from
   one place.

## Deploy

ECR does not exist until the first apply, so the image cannot be named on the
first pass. Three steps, once:

```sh
cd deploy/aws-terraform
cp terraform.tfvars.example terraform.tfvars    # then edit: domain, event_yaml_b64
terraform init
terraform apply -target=aws_ecr_repository.main # just the registry
./deploy.sh                                     # build with event.yaml baked in, push
terraform apply                                 # the rest of the stack
```

Afterwards a redeploy is one command:

```sh
./deploy.sh --apply
```

`deploy.sh` owns the **build-time config bake**. The app image bakes
`event.yaml` via `EVENT_CONFIG_B64`; an image built without it ships an empty
`admins` list, so `/admin` 403s for everyone and generic branding appears — the
most expensive mistake this kit has. Terraform cannot build an image, which is
why this is a script and not an `apply`.

The tag is content-addressed — `<revision>-<config-hash>` — and the ECR
repository is `IMMUTABLE`. Same code plus same config gives the same tag, so a
re-run reports "already there" and skips the build rather than failing. Change
either half and the tag changes with it. `deploy.sh --dry-run` prints every
command and runs none of them.

## Variables

Every input is in `variables.tf` with its own description;
`terraform.tfvars.example` shows each at its default. Only three have none:

| Variable | Why it is required |
|---|---|
| `domain` | The session cookie is `Secure`. There is no working HTTP mode. |
| `event_yaml_b64` | Not read by Terraform — required so the module refuses to describe a stack whose image was built without a config. |
| `app_image` | What ECS runs. `deploy.sh` writes it into `image.auto.tfvars`; the example carries a placeholder for the bootstrap apply. |

## Tear down

```sh
terraform destroy
```

The ECR repository is `force_delete` — a registry that refused to go because it
still held images would leave the teardown half-done, and the whole point of
this module is that `destroy` ends the event.

## Notes and gotchas

- **Terraform state now contains a secret.** The EC2 module could honestly say
  it did not; this one generates the ElastiCache AUTH token, and a generated
  password is in state by construction. Use an encrypted remote backend with
  restricted access for anything real.
- **Durability is snapshots, not AOF.** The EC2 box ran Redis with AOF on an
  EBS volume; ElastiCache gives daily snapshots
  (`cache_snapshot_retention_days`, default 5) plus in-memory replication. A
  restore is therefore **coarser-grained** than the old fsync-per-write story:
  you lose up to a day, not up to a second. For event content — questions,
  challenges, flags — use the app's own archive export (Admin → Event → Event
  archive), which is finer-grained, portable, and the backup that actually
  matters for re-running an event.
- **srh does not trust the OS certificate store.** It verifies TLS against
  **CAStore**, an Elixir library whose Mozilla bundle is embedded in the srh
  release, not `/etc/ssl/certs`. Two consequences: ElastiCache verifies fine
  (that bundle carries Amazon Root CA 1–4), and mounting your own CA into the
  container does nothing. If a handshake to the cache ever fails with
  `Unknown CA`, the fix is a newer `srh_image`, not an OS trust store change —
  the trust anchors are frozen at the digest you pinned.
- **`srh_image` is digest-pinned and the module refuses a floating tag.** That
  container sits between the app and every byte of event data; `:latest` there
  is a supply-chain decision, so it has to be made deliberately.
- **State is reconstructible in poll mode.** `sync` re-reads scores from the
  GitHub PR comments, so a replaced task repopulates the leaderboard. The
  poller's cursor lives in Redis, not on disk, so Fargate's ephemeral storage
  costs nothing here — at worst a restarted task re-polls.
- **DNS in another account?** Leave `route53_zone_id` empty, set
  `acm_certificate_arn` to a certificate in this region, and point your own
  record at the `alb_dns_name` output. Terraform manages the record only when
  the zone is in the same account.
- **Everything is tagged** via the provider's `default_tags`
  (`Project`/`ManagedBy`/`Event`), so one filter finds the whole event. Add
  owner/cost-centre/expiry with `var.tags`.
- **CI-validated, never applied.** `.github/workflows/terraform.yml` runs
  `fmt -check`, `validate` and `test`; `stack.tftest.hcl` renders the container
  definitions at plan time with `mock_provider` and asserts on them, because
  `validate` never inspects rendered output — which is how a fundamentally
  broken bring-up script survived in the EC2 version of this module unnoticed.
  `test/aws.bats` covers `deploy.sh`, the part Terraform cannot see. No AWS
  credentials, no network and no apply, in either.

## Migrating from the EC2 box

Breaking. The old module produced one EC2 instance with an Elastic IP and a
Redis AOF volume; this one produces an ECS stack behind an ALB. There is no
in-place upgrade path — an `apply` over the old state would destroy the instance
and build the new stack around a database that never existed.

Do it as a move, not an upgrade:

1. **Export the event** from the running box: Admin → Event → *Event archive →
   Export*. That file carries the authored content — quiz questions and their
   answer key, classic and AI challenges with flags, hints, categories — which
   is what you cannot recreate.
2. **Note what the archive does not carry**: contestant progress and teams. If
   the event is mid-flight, finish it on the old box. This migration is for
   between events.
3. **Stand the new stack up** in a fresh state file, following Deploy above.
   Keep the old one running until the new one answers on a test domain.
4. **Import the archive**: Admin → Event → *Event archive → Import*.
5. **Move DNS** to the ALB, and update the OAuth callback if the domain changed.
6. **`terraform destroy` the old stack** from its own state directory.

Secrets carry over unchanged if you keep the same `ssm_prefix` — except
`REDIS_PASSWORD` and `SCORER_TOKEN`, which this module does not use, and
`REDIS_AUTH_TOKEN`, which it creates for you.
