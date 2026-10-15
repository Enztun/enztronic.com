#!/bin/sh
# Installed under the deploy account; cron and manual runs share this lock.
set -u
umask 077
PATH=/usr/local/bin:/usr/bin:/bin
export PATH
ROOT=/home/deploy/website-audit
exec 9>"$ROOT/scheduler.lock"
flock -n 9 || exit 75
status=0
for site in qianlima enztronic; do
    python3 "$ROOT/audit.py" --config "$ROOT/sites/$site.json" --state-dir "$ROOT/state" --mode due || status=1
done
exit "$status"
