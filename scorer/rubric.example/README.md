# Example rubric

This directory is the **instructive default** rubric baked into the scorer image
when you build `scorer/` with no `RUBRIC_DIR` override. It exists to teach the
format — `juice-shop.yaml` is commented as a tutorial. Read it first.

The targets are open source and their solutions are already public, so a rubric
is not a secret. Keeping *your* rubric private during an event is about
**scoring integrity**, not hiding answers: it stops a contestant from crafting a
patch that satisfies the exact probe string without actually fixing the vuln.

## Author your own rubric

1. Copy this directory somewhere outside the repo (or straight into
   `scorer/rubric/`, which is gitignored — see the build command below):

   ```sh
   cp -r scorer/rubric.example ./my-rubric
   ```

2. **One file per target**, named `<target>.yaml`. The `target:` field inside
   the file MUST match the filename stem, and both must match the target id used
   by the event (`event.yaml`, the consumer workflow's `TARGET`). Example:
   `juice-shop.yaml` with `target: juice-shop`.

3. Write honest, declarative probes that **assert the fix, not the exploit** —
   the tutorial comments in `juice-shop.yaml` cover the grammar, points, id
   charset, and what makes a good check.

## Build your private scorer image

`COPY` can only read paths *inside* the Docker build context, and the context is
`scorer/`. A rubric outside the repo therefore cannot be referenced with
`../my-rubric`. Place your rubric at `scorer/rubric/` (gitignored) and point
`RUBRIC_DIR` at it:

```sh
cp -r ./my-rubric scorer/rubric
docker build -t ghcr.io/<org>/score:latest --build-arg RUBRIC_DIR=rubric scorer/
```

(Omit `--build-arg` to bake this example rubric instead.)

## Keep it private during the event, publish it after

Keep the built image **private** (`ghcr.io/<org>/score` package = private) while
the event runs — see `setup/ctf-setup.sh org` for the mirror + access steps.
Once the event is over, you are encouraged to **publish your rubric** as
teaching material: this is an educational CTF and the solutions are public
anyway. A well-written rubric is a great artifact for the next cohort.
