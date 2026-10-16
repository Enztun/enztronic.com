# Independent Enztronic audit runner

This directory belongs to the Enztronic repository and runs **Enztronic only**.
The dedicated runner is **not installed or scheduled yet**; its destination is
pending. Checking in these files does not activate a service, cron or GitHub
Actions. No paid AI API is used.

The website remains hosted on Vercel. A separately chosen Linux runner performs
the checks; it does not host or deploy the website. The runner never updates
dependencies, restarts production, writes production data, or submits real
contact/chat/email requests. Private Vercel logs remain outside coverage by the
user's choice.

## Project configuration and private runtime

The checked-in `sites/enztronic.json` contains only Enztronic's public URLs and
check policy. `run.py` supplies the executable and private paths at runtime; use
this entrypoint rather than passing the template directly to `audit.py`.
The repository wrapper fetches only the public HTTPS repository
`https://github.com/enztun/enztronic.com.git`, branch `main`. It does not need a
deploy key, SSH agent, GitHub token or another website's configuration.
Public Git commands use a separate empty private HOME, disable credential
helpers/global configuration, and reject a credential file in that HOME.

The private root defaults to `~/.local/share/enztronic-audit`. Override it with
`--root /absolute/private/directory` or `ENZTRONIC_AUDIT_ROOT`. It must be outside
all Git checkouts, owned by the runner account, and must not be HOME, the
filesystem root, traverse a symlink or contain `..`. Its directories are mode
0700 and private files mode 0600:

- `bin/gitleaks`: separately provisioned, verified scanner.
- `sites/enztronic-public-env.json`: representative public build settings.
- `secrets/discord.env`: this runner's separately provisioned Discord assignment.
- `mirrors/`, `cache/`, `state/`, `locks/`: independent working data and locks.

No secrets or existing monitor state are copied from another server. Provision
an independent Discord webhook assignment named `ENZTRONIC_DISCORD_WEBHOOK_URL`
in `secrets/discord.env` using a private editor; do not put its value in shell
arguments, Git, the site JSON or deployment uploads. Notification runs require
this owner-only file. `--no-discord` explicitly disables delivery for a manual
verification. Ambient webhook variables do not override the dedicated file.
Reports and pending notifications remain private.

The public build JSON accepts only `NEXT_PUBLIC_SANITY_PROJECT_ID`,
`NEXT_PUBLIC_SANITY_DATASET` and optional `NEXT_PUBLIC_SITE_URL`; project and
dataset are required. No Sanity token or other provider secret is permitted.
The installer can extract only those keys from an explicitly supplied local
environment file, without transferring the other values.

## Prerequisites and explicit installation

Use a dedicated Linux/Python 3.12+ runner with Git, Docker and sufficient free
disk/RAM for two sequential builds. Docker phases are limited to two CPUs and
3 GiB each. Provision official Gitleaks 8.30.1 after verifying its release
archive checksum; the Linux x64 archive SHA256 is
`551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`.
No automatic package or scanner installation is performed.

After the destination is explicitly chosen and its private root, scanner and
separate Discord file are provisioned, an operator can install over existing
authorized SSH access:

```text
python ops/website-audit/install.py --target audit@DEDICATED_RUNNER --public-env /local/path/to/build.env
```

The installer requires `--target`, verifies transfer checksums, and installs only
this project. `--root` selects an absolute path on that destination. Omitting
`--activate-schedule` installs files without adding or activating a schedule.
It performs no audit or Discord delivery. An existing schedule is preserved;
the installer reports whether this invocation explicitly activated one.

For manual verification on the chosen runner:

```text
python3 /path/to/installed/run.py --root /private/enztronic-audit --mode full --no-discord
python3 /path/to/installed/run.py --root /private/enztronic-audit --mode daily
```

Only after installation, first full results and Discord delivery are verified,
repeat the installer with explicit `--activate-schedule` if desired. Scheduling
requires UTC and adds one namespaced Enztronic cron block at **19:30 UTC daily
(02:30 WIB)**, preserving unrelated jobs and a private pre-install backup.
`--mode due` adds a full scan every **14 UTC calendar days**; the new runner's
first full attempt establishes its own cadence. No next full date is promised
before that first run. Runner/site/repository locks prevent overlapping work.

## Checks, isolation and limitations

Daily checks cover public HTTP routes, configured headers, HTTPS/TLS expiry and
bounded positive-signature probes for exposed environment/Git files. Host OS,
Docker runtime logs and private Vercel logs are explicitly outside this website
profile: the audit machine's packages are not Vercel's runtime packages.

Full scans add full Git-history Gitleaks, production/full npm advisories,
available versions, zero-warning lint, TypeScript, network-policy tests, and a
representative public-CMS production build. The fixed Playwright 1.62.1 image is
pinned by digest. A separately labeled fixture build omits CMS configuration;
the second container runs the actual UI suite with **network disabled**, no
published ports, no production credentials, and no Docker socket. Form/chat
writes are mocked and other writes blocked. Live providers/CMS/customer-data
flows are outside this offline browser coverage.

Both Next's bind host and the browser origin use `localhost:3100` to keep locale
rewrites on the same origin. Readiness requires `HEAD /icon.png` HTTP 200 within
a bounded deadline; real page navigation and assertions run in the UI suite.
Nonzero test exit, zero/missing/duplicate success summaries, timeouts, invalid
reports or missing prerequisites cannot become a pass. Failed synthetic UI
runs retain only bounded private stdout/stderr tails in
`state/enztronic/offline-ux-diagnostics.json`; raw diagnostics never enter Discord.
Disposable work/tools and the exact audit containers are cleaned afterward.

An exact trusted-HEAD `.gitleaksignore` may suppress only reviewed complete
`commit:path:rule:line` fingerprints. Wildcards, broad paths/rules, traversal and
ambient mirror ignore files are rejected. High dependency advisories remain
failures; previous findings stay visible until the relevant check completes
again. Existing Enztronic dependency findings are not waived by this runner.

Reports use bounded metadata, durable Discord outbox retry/deduplication and
90-day report retention. Delivery is at least once, so a crash after Discord
acceptance can duplicate a summary. A daily probe is not instant uptime
monitoring; an independent dead-man alert is needed to detect runner failure.
No production or historical server logs are deleted by this setup.

## Local fixture tests

```text
python -m unittest discover -s ops/website-audit/tests -v
```

Tests use fixtures and local child processes without real SSH, Docker, browsers,
Discord or website requests. The dedicated host still needs its own first-run
installation, permission, resource, source/build/browser and delivery verification.
