#!/bin/sh
# ctf sync — container entrypoint.
#
# Exists for one reason: the state directory. sync runs as `node` (uid 1000)
# and keeps its poll cursor at STATE_PATH. On a single-machine Fly deploy that
# is /data/sync/state.json, under the one volume a machine allows, shared with
# redis. A fresh Fly volume is root-owned, so state.js's
# `mkdirSync(dirname(STATE_PATH))` fails with EACCES before the first poll —
# and with the compose default (/state, ephemeral) the cursor is simply lost
# on every restart. Nothing else in the image runs as root and a volume has no
# hook of its own, so this does what the redis image's entrypoint does: create
# the directory as root, hand it to the service user, then drop privileges and
# exec the real command. Locally nothing changes — /state is created and
# chowned at build time and the chown here is a no-op on it.
#
# `su-exec` rather than busybox's setpriv: the setpriv node:alpine ships is
# built without --reuid/--regid. su-exec sets uid/gid (and the group list from
# the passwd entry) and execs in place, so node stays PID 1 for signals.
set -eu

if [ "$(id -u)" = "0" ]; then
  state_path="${STATE_PATH:-/state/state.json}"
  dir="$(dirname "$state_path")"
  mkdir -p "$dir"
  # The directory itself, never recursive: a STATE_PATH pointed at the volume
  # root would otherwise re-own redis's data underneath it.
  chown node:node "$dir"
  if [ -e "$state_path" ]; then
    chown node:node "$state_path"
  fi
  exec su-exec node:node "$@"
fi

# Already unprivileged (a `user:` override, or run by hand): nothing to fix.
exec "$@"
