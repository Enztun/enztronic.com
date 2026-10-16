# Independent Enztronic audit runner

This directory belongs to the Enztronic repository and runs **Enztronic only**.
The user selected native monitoring on their Windows PC and explicitly deferred
Docker/WSL tests. Actual installation and delivery evidence is recorded in the
maintenance log. No GitHub Actions or paid AI API is used.

## Windows PC setup

The private runtime defaults to `%LOCALAPPDATA%/EnztronicAudit` on the PC's C:
drive, outside this Git checkout. Windows ACLs allow only the current owner,
SYSTEM and Administrators. A reviewed code snapshot runs from that private
directory, so later uncommitted repository edits do not alter scheduled code.

Native daily checks cover public health, TLS/expiry, configured headers and
positive signatures of exposed environment/Git files. Every 14 UTC calendar
days, native security checks fetch this public repository's `main`, scan its
history with verified Gitleaks, and check production/full lockfile advisories
and declared dependency updates. Only bounded JSON manifests and inert version
metadata are extracted: project packages, scripts and application code are
never installed or executed. Git/npm use private anonymous configuration.

**Lint, type, build and browser checks are explicitly unavailable/deferred in
native mode.** They remain visible as incomplete coverage. The current PC has
no WSL or Docker; native metadata checks do not claim the previous Linux
container/browser coverage. Private Vercel logs remain excluded by user choice.

Provision from the repository using existing private assignment/build files;
arguments contain file paths, never secret values:

```text
python ops/website-audit/setup_windows.py --public-env D:/Enztronic/.env.local --webhook-file C:/Private/monitoring.env
```

The bootstrap verifies the pinned official Gitleaks archive and executable,
sets private NTFS permissions, transfers only three public build settings,
and stores the namespaced webhook assignment in `secrets/discord.env`.
It does not activate a task unless `--activate-schedule` is explicitly used.
For later reviewed updates, the existing runtime's `secrets/discord.env` can be
the webhook input; state, reports, cadence and outbox are preserved.

Run a first full verification and inspect the concrete task plan:

```text
python "%LOCALAPPDATA%/EnztronicAudit/run.py" --mode full
powershell -NoProfile -File "%LOCALAPPDATA%/EnztronicAudit/install_windows.ps1" -Root "%LOCALAPPDATA%/EnztronicAudit"
```

After verification, invoke the same task installer with `-ActivateSchedule`.
It adds only **Enztronic Website Audit**, daily at **02:30 WIB**, plus a delayed
current-user logon catch-up trigger. The engine runs security scans when due;
the first full attempt establishes the 14-date cadence. A windowless `pythonw`
launcher suppresses raw output and writes bounded fixed-status launcher logs.
The task uses the signed-in user with limited privileges and no stored password.

Windows tries to wake a sleeping PC if wake timers permit. A powered-off or
signed-out PC cannot run the checks; catch-up waits for startup/sign-in.
Internet is needed for website, advisory and Discord checks. Pending messages
stay in the private outbox and retry on the next invocation. This PC setup is
not an independent always-on uptime service.

The website remains hosted on Vercel. The selected PC or an explicitly installed
Linux runner performs checks; it does not host or deploy the website. The runner never updates
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

On Linux, the private root defaults to `~/.local/share/enztronic-audit`. Override it with
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

## Optional Linux/Docker runner

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
