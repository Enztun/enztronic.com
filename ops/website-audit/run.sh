#!/bin/sh
# This repository's entrypoint audits Enztronic only; it does not install cron.
set -eu
umask 077
PATH=/usr/local/bin:/usr/bin:/bin
export PATH
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec python3 "$SCRIPT_DIR/run.py" "$@"
