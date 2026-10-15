# Read-only website audit runner

`audit.py` uses Python 3's standard library. It performs checks and writes private reports; it never updates dependencies, installs server packages, deploys code, restarts services, or performs authenticated website/payment mutations. It uses no GitHub Actions or paid AI API.

Run an installed, trusted site profile:

```text
python3 /home/deploy/website-audit/audit.py --config /home/deploy/website-audit/sites/qianlima.json --state-dir /home/deploy/website-audit/state --mode due
```

`--mode daily` runs HTTP, TLS, exposure and server/log probes. `--mode full` also runs repository checks. `--mode due` runs daily probes and adds a full audit when no full audit has run or the configured interval is due. The default is **every 14 UTC calendar days**; the daily scheduler supplies the execution hour. A manual first run at 23:00 UTC is due again on day 14 even when that day's cron runs at 19:30 UTC. `"cadence": "monthly"` uses the next calendar month's date, clamping the day for short months. Actual run timestamps remain recorded. Delayed/missed daily invocations can delay execution until the next invocation. Run `--no-discord` for local-only reports; delivery is explicitly recorded as disabled. Scheduling/installing is a separate operator step.

## Site profile

Profiles are trusted operational configuration, not user-submitted content. Commands execute with the runner's OS permissions, without a shell. Root-provided wrappers must enforce their own read-only, isolated Docker/source workflow. Original application checkouts and production secrets are not mounted. Builds write only to disposable Git archives and their separate package cache.

```json
{
  "id": "qianlima",
  "name": "Qianlima",
  "interval_days": 14,
  "urls": [
    {
      "url": "https://qianlima.co.id/",
      "status": 200,
      "required_headers": {
        "strict-transport-security": "max-age=",
        "content-security-policy": "default-src",
        "x-content-type-options": "nosniff"
      }
    }
  ],
  "docker_containers": ["qianlima_backend"],
  "commands": [
    {
      "name": "frontend",
      "argv": ["python3", "/home/deploy/website-audit/repository_check.py", "qianlima-frontend"],
      "timeout": 2400,
      "full_only": true,
      "parser": "check-bundle"
    }
  ],
  "discord_env": "DISCORD_WEBHOOK_URL",
  "discord_secret_file": "/home/deploy/.config/website-audit/discord.env",
  "retention_days": 90,
  "disk_path": "/"
}
```

Configure a separate bundle command for each required repository. The Qianlima profile normally has frontend and backend bundles; Enztronic normally has its own repository bundle. URL `status` accepts an integer or an array of acceptable integers. Header requirements are case-insensitive name-to-substring mappings; an empty substring means the header must exist. Per-URL `timeout` is bounded to 1–30 seconds. `tls_expiry_days` defaults to 14. HTTP redirects are capped at five, may only reach host/port pairs explicitly present in the URL list, and may not downgrade an HTTPS probe to HTTP. Include both canonical and redirect host URLs when both are expected.

The runner reads at most 128 KiB per HTTP response, uses socket/read deadlines, verifies HTTPS chains/host names and separately checks TLS expiry. `/.env` and `/.git/HEAD` probes report exposure only when a concrete secret-assignment or Git HEAD signature is present. A generic 200 HTML page is not a positive exposure. An unsuccessful probe remains an error; a negative bounded probe is not proof about every file/path on the server.

Container checks inspect runtime/health state and count structured severity levels from at most 2,000 log lines within 24 hours. They never include raw log messages, HTTP request bodies, customer records, or process output in reports or Discord. Missing health checks, unstructured logs and truncated output remain visible. Host checks read filesystem usage, the Linux reboot marker, and **cached** APT upgrade information/cache age. They do not refresh APT, install updates, reboot, or prune Docker.

`docker_checks_required` defaults to `true`: an empty container list remains an explicit skip and makes coverage incomplete. A site intentionally outside Docker monitoring can set `"docker_checks_required": false` with `"docker_containers": []`. Its informational `docker-scope` result states only that Docker checks are outside that site's configuration; it does not claim any container is healthy. The Enztronic profile uses this explicit scope because it is Vercel hosted and private Vercel logs were excluded by user choice. Configured containers are still probed even when this flag is false. HTTP, TLS, repository and required log failures/coverage remain unchanged.

## Repository check contract

`parser: "check-bundle"` accepts one JSON object:

```json
{
  "revision": "0123456789abcdef0123456789abcdef01234567",
  "checks": [
    {"name": "production-audit", "category": "audit-prod", "status": "pass", "metrics": {"high": 0, "critical": 0}},
    {"name": "lint", "category": "lint", "status": "blocked", "metrics": {"exit_code": 1}}
  ]
}
```

Each bundle must cover `audit-prod`, `audit-full`, `outdated`, `lint`, `typecheck`, `unit`, `build` and `gitleaks`. Several distinctly named checks may share a category; `setup`, `install` and `schema` are additional categories that do not satisfy required coverage. Missing categories are explicit skips **per repository**, even when another repository passed them. A JavaScript-only backend can explicitly exclude TypeScript from that bundle's `required_categories`; its separate Prisma schema check retains its own label. Statuses are `pass`, `warn`, `fail`, or `blocked` (recorded as an error). Wrapper exits 0/1/2 are accepted for all-pass/failure/warnings respectively, but a nonzero exit contradicting all-pass results is an error. Invalid or oversized JSON never becomes a pass. No raw diagnostic/message fields from bundles are copied into reports.

Metrics use a numeric/boolean allowlist: `exit_code`, `errors`, `warnings`, `findings`, `packages`, `info`, `low`, `moderate`, `high`, `critical`, `total`, `tests`, `passed`, `failed`, `skipped`, `duration_seconds`, `cache_age_days`, `available_packages`, plus bounded execution/coverage flags; nested `vulnerabilities` counters are supported. A `revision` metric or top-level bundle revision may contain only a hexadecimal Git hash. Other fields are discarded; nonnumeric values in a recognized counter invalidate the bundle. Secret scanning must use the official Gitleaks binary with redacted findings; this runner does not implement a substitute scanner.

Single-command parsers are also available: `generic` (exit status only), `npm-audit` (JSON vulnerability counts), `npm-outdated` (JSON package count), `eslint` (JSON error/warning counts), and `gitleaks` (redacted JSON finding count or official scanner exit status). Commands accept `name`, `argv`, optional `cwd`, `timeout` (up to 7,200 seconds), `full_only` (default true), and `category` (defaults to name). If Gitleaks runs separately, set each bundle's `required_categories` to its other seven categories and provide a standalone `category: "gitleaks"` command. Global full coverage defaults to all eight categories. Source output is drained with at most 512 KiB retained in memory; truncated structured output is an error. Timed-out POSIX commands and their process groups are killed.

## Reports and Discord

Each site's state directory is mode 0700; JSON state, report/outbox files and logs are mode 0600 on POSIX. A per-site OS lock prevents overlapping runs. Reports are JSON plus Markdown, retained for at most 90 days. `audit.log` rotates at 1 MiB to one previous file while preserving the current log. Deployment/bootstrap must run under an appropriate dedicated OS account and secure the parent path; Windows `chmod` does not replace an NTFS ACL review.

Set `DISCORD_WEBHOOK_URL` in the environment, or use an owner-only mode-0600 file containing a plain assignment to that variable. The file is parsed as data, never sourced or executed. Environment configuration takes precedence. Only `https://discord.com/api[/vN]/webhooks/...` URLs are accepted; redirects, credentials, custom ports, fragments and preexisting query strings are rejected. The secret is removed from child-process environments and never written to reports/logs. Do not put it in a checked-in JSON profile or command argument.

Daily issue summaries are deduplicated by UTC day and stable issue identity/status. Healthy daily runs remain in the private reports without a Discord message. Full summaries always queue, including clean runs. Discord delivery uses `wait=true` and `allowed_mentions: {"parse": []}`. A 429 retries up to three attempts, honoring `retry_after`/`Retry-After`; delays over 30 seconds defer delivery instead of retrying too early. Failed delivery retains the durable outbox and does not advance notification state. The next run retries that outbox before sending newer summaries. Pending messages are retained until delivery, independently of report retention. Delivery is at least once; a crash after Discord accepts a message but before local state is written can produce a duplicate.

A failed source audit remains visible in later daily reports until that named check completes again. A healthy HTTP check or unavailable scanner cannot clear a dependency/build/security failure. Current daily health/log probes can recover independently. A completed full attempt advances the scan schedule even if it found issues; Discord delivery state advances only after successful delivery. Exit codes: 0 for pass/warning results, 1 for failed/incomplete checks, 2 for delivery/operational failure, 75 when another run holds the site lock. These checks do not certify authenticated browser journeys, OAuth/WeChat, real payments, uploads, native PDF viewers or device media behavior.

## Tests

```text
python3 -m unittest discover -s ops/website-audit/tests -v
```

Tests use local processes and fixtures, with no real Discord calls, server mutations, production logs or external network. They cover cadence, overlap, timeouts/bounded output, positive-only exposure detection, redirect restrictions, secret-file parsing/redaction, 429 handling, outbox recovery, daily deduplication, failed-check persistence, per-repository coverage, structured parser failures, retention/permissions, log rotation and secret-free child environments.

## Installed VPS layout and reuse

The reviewed profiles in `sites/` share one engine on the existing Qianlima VPS.
Qianlima covers two repositories; Enztronic has its own read-only Git deploy key
and repository bundle. A copy can be kept in each website repository. Install
one shared engine per host rather than enabling duplicate cron jobs per copy.

Requirements: Linux/Python 3.12+, Git/OpenSSH, Docker, `flock`, trusted GitHub
known-host entries, and read-only deploy keys at the paths in `REPOSITORIES`.
Provision the official Gitleaks binary in `bin/gitleaks` after verifying the
release archive checksum. This installation uses Gitleaks 8.30.1; its linux x64
archive SHA256 is `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`.
Store the Discord assignment in `/home/deploy/.config/website-audit/discord.env`
with mode 0600 and a mode-0700 parent. Never put it in a profile or shell command.

`repository_check.py` pins its container images, limits resources, and serializes
work with `/var/www/qianlima/.pipeline/pipeline.lock`, also used by deployment.
On another host provision the shared lock first and adapt `ROOT`, repo/key maps,
profile paths and wrapper path. `WEBSITE_AUDIT_PIPELINE_LOCK` overrides the lock
path. A busy pipeline waits up to 180 seconds and then reports an incomplete scan.

From the reviewed source directory, install using an existing authorized SSH key:

```text
python ops/website-audit/install.py --target deploy@YOUR_SERVER --enztronic-public-env D:/Enztronic/.env.local --activate-schedule
```

The installer reads only three whitelisted public Enztronic build settings from
that local file. It does not transfer other environment variables or private
keys. Transfers are checksum-verified; scripts/profiles remain owner-only. It
preserves unrelated crontab jobs and keeps a private pre-install crontab backup.
Activation requires a UTC server timezone and installs **19:30 UTC daily
(02:30 Asia/Jakarta)**. The wrapper and per-site locks prevent overlapping runs.
Omit `--activate-schedule` to install without scheduling. Re-run after reviewed
engine/profile changes; repository application revisions are fetched afresh.

Verify first runs and actual Discord acceptance for both profiles before relying
on scheduling. Reports, per-site state and the durable outbox live in `state/`;
the private `MAINTENANCE_LOG.md` records installation and verification. Existing
historical application/deployment logs are preserved.

This configuration deliberately excludes **private Vercel frontend logs**, as
requested. It monitors bounded Qianlima backend Docker logs, public frontend/API
health and source checks. Add independent external uptime/dead-man monitoring to
detect loss of this VPS, and provider-native alerts if frontend private logs are
needed later. A single daily check cannot guarantee instant incident detection.

The Qianlima profile also runs `production_smoke.py` daily: matching and rotating
protected-page nonces, spoof rejection, anonymous CV/session read rejection,
CV preview isolation headers and public-catalog offset pagination. It performs
only bounded, credential-free GETs and prints booleans; it never submits a job,
form, payment, uploaded document or login attempt against production.


A reviewed `.gitleaksignore` in the exact trusted Git HEAD may contain only
full `commit:path:rule:line` fingerprints. The wrapper reads at most32KiB,
validates literal relative paths/rules/positive line numbers, and passes a private
copy explicitly to the scanner. Wildcard, traversal, rule-only and broad directory
exclusions are rejected. Missing files add no suppression. Ambient mirror ignore
files are rejected and scanning runs from a private tools directory. Per-repository
reviewed fingerprints do not suppress findings in other repositories. Re-review
new findings individually.
