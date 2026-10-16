# Security dependency follow-up and recurring audit - 16 October 2026

## Current automation status - separate runner pending

The user chose an independent Enztronic server/runner. The Enztronic-only
automation is prepared in this repository but is **not installed or scheduled
on a dedicated runner**; its destination has not been provided. No next full
audit date is established. The first full attempt on that runner will establish
its own 14-day cadence. Earlier shared-host results below remain historical
verification evidence, not a claim of current Enztronic scheduling there.

The shared host's operator verified its current scheduler and repository
allowlist are restricted to Qianlima, with Enztronic configuration retained only
as private historical state. This repository now has no runtime dependency on
that host, its paths, deploy keys, deployment lock, state or Discord secret.

The new entrypoint audits only `enztun/enztronic.com` over anonymous HTTPS. Its
private root defaults to `~/.local/share/enztronic-audit`, outside Git checkouts,
with separate state/cache/locks and a separately provisioned owner-only Discord
file. Installation requires an explicit destination; schedule activation is a
separate explicit option. Host OS checks are outside this Vercel website profile.
The localhost browser isolation, source checks, report/outbox protections and
unsuppressed dependency findings remain intact. No GitHub Actions, new server,
remote installation, schedule, deployment or external notification was activated
by this preparation. See [runner instructions](../ops/website-audit/README.md).

The independent-runner preparation passes **88 local fixture tests: 87 passed,
one skipped** because Windows lacks filesystem-symlink permission. Mocked
parent/lock symlink rejection still passes. Python compilation and diff checks
pass. These tests did not contact SSH, Docker, browsers, Discord or production;
the future dedicated host still requires installation and first-run verification.

## Dependency release and historical verification

The website now uses Next/eslint-config-next 16.4.2, Sanity/vision 5.31.2,
next-sanity 13.3.4, PostCSS 8.5.30 and Sharp 0.35.5, plus compatible lockfile
security fixes. React 19.2.7 is preserved; Playwright is pinned to 1.62.1.
No unsupported transitive override, framework downgrade or forced major migration
was used. The generated Next root-params type reference is retained.

The fresh production dependency audit improved from 33 to 17 entries:
**0 critical, 10 high, 7 moderate**, previously 1 critical. Full audit improved
from 39 to 19 entries: **0 critical, 12 high, 7 moderate**. Registry advisory
counts can change; these are measured snapshots, not a security certificate.

Remaining underlying packages are `adm-zip` 0.5.18, `braces` 3.0.3,
vendor-pinned `js-yaml` 3.13.1, `sprintf-js` 1.0.3 and `typeid-js`'s UUID 10.
Most enter through Sanity's CLI dependency tree retained in its production
package; source/package presence is not proof of a public exploit. No compatible
upstream fix was available for these chains at review. Monitoring must continue
to report these high findings as failures, without suppressing or downgrading them.

Validation: clean install, zero-error/zero-warning ESLint, TypeScript, production
build, four UX network-guard tests and Sharp PNG/resize/WebP smoke all pass.
The existing browser suite is restricted to an exact local HTTP origin/port,
uses an empty nonpersistent browser context, and blocks service workers,
WebSockets, external requests and unmocked writes. Form/chat writes are mocked.
The full audit runs it in a second container with network access disabled.
CMS-backed primary builds and the separate offline UI fixture build are labeled
independently. Real CMS/providers/email submissions are outside offline UI coverage.

Earlier verification used the shared `ops/website-audit` engine on the Qianlima
VPS at **19:30 UTC / 02:30 WIB (Asia/Jakarta)**, with full scans every
**14 UTC calendar days**. That Enztronic schedule has since been removed from
the shared entrypoint. The first full summary was accepted by Discord; this
confirms historical delivery, not a clean audit or a current dedicated schedule.
Those historical full scans included dependency advisories, available updates,
Git-history secret detection, lint/type/build and local UI tests. Historical
daily checks included public routes, TLS/expiry, configured headers, exposure
signatures and shared-host maintenance status. No GitHub Actions or paid AI API
was used. The new dedicated profile excludes runner OS checks, as stated above.

At that historical checkpoint the shared engine was synchronized byte-identically
across both repositories and the VPS installation. Its operations suite ran **78 tests:
77 passed and one skipped** because Windows lacked filesystem-symlink permission;
separate mocked symlink-rejection coverage passed.

Private Vercel runtime logs are excluded by the user's explicit choice. The
monitoring host has no Enztronic private runtime-log credential. Keep webhook
values and private reports out of Git and public deployment uploads. Install
one Enztronic scheduler on its independently chosen runner. Original checkout and production secrets are never
mounted into the disposable audit worktree.

Next hardening: resolve upstream CLI dependency chains, review the current
minimal public CSP, add provider-native frontend error/dead-man alerts when
desired, and exercise real provider-backed workflows with dedicated test data.
The independent local `apps/**` installations are outside this public website
dependency audit; the back office remains excluded from public Vercel uploads.

## Reviewed Git-history scanner false positives

The first history scan reported nine `generic-api-key` candidates. Each exact
historical match was inspected in memory without printing candidate values or
reading environment files. The repository `.gitleaksignore` records only these
nine commit/path/rule/line fingerprints; no path-wide or rule-wide exclusion is
used, and credential findings remain reportable.

Seven matches in commit `4871fcaa4462cded988f5b15813d137d3d5bffa7`,
`apps/meteora-lp/src/lib/mock-data.ts` lines 17, 42, 67, 164, 182, 200 and 218,
are `tokenBMint` fields in exported `mockPositions` and `mockCandidates` demo
data. The domain contracts define them as token-mint strings. Three values recur
in both arrays and have 32-byte public-address shape; the final value is a mock
placeholder. No private-key, secret-key or signing operation occurs in that
fixture. These are public mint identifiers or mock data, not authentication keys.

Two matches in commit `bf195dcd2fed7a4f2e1ec6f305a9aa165006dec5`,
`dist/static/sanity-BAlIdGYY.js` lines 1380 and 1626, come from generated Sanity
vendor code. The first is unquoted JavaScript member access and a comparison,
not a credential literal. The second is a static 12-character array-item `_key`;
the exact value also occurs in installed Sanity source, where AST inspection
places it inside the nested `PATHS` array. The generated historical bundle is
no longer tracked. These exceptions do not suppress dependency advisories or new
findings. The subsequent normal full-run history scan reported **zero remaining
unsuppressed findings** with the reviewed allowlist. This is scanner coverage
evidence, not proof that all credentials or all history are safe.

References: [Next release](https://github.com/vercel/next.js/releases/tag/v16.4.2),
[Sharp advisory](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w),
[PostCSS advisory](https://github.com/postcss/postcss/security/advisories/GHSA-fxqj-rqcc-2cmp),
[unpatched braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).


## Live release checks

The dependency release `1cf41112` passed its Vercel preview and production build;
production deployment `dpl_CwRgyvqeo2jYMebkcVhFn3sUaJMc` was READY. Later source
changes contain the shared audit engine and the exact false-positive list; they
preserve the same application code. GET-only production smoke passed home,
Indonesian/Chinese locales, contact, portfolio, blog and studio. English `/en/*`
redirects to the canonical unprefixed routes and HTTP upgrades to HTTPS.

The existing `www` hostname still serves HTTP 200 with an apex canonical tag;
a forced www-to-apex redirect remains follow-up SEO/host consistency work. The
existing CSP header contains base/frame/object protection but no script/default-source
restriction; broader public script policy hardening remains open.

Using `localhost` consistently for the server bind and the harness's exact local
origin restored the expected English HTTP 200 response. A direct retained-build
rerun passed, followed by a verified normal full run started at
`2026-10-15T23:57:28+00:00` against source
`718cc18f5882c427a609f8495b4ee4c15168cd76`.

That normal run passed installation, ESLint with zero errors and warnings,
TypeScript, browser toolchain, four network-guard tests, the primary production
build and the separate offline fixture build. The actual browser phase passed
**28 UI test groups with zero errors** in a Docker container with network access
disabled. The previous UI finding cleared. These checks do not verify live
provider, email or customer-data workflows.

The history scan reported **zero unsuppressed findings**. Production dependency
audit still reports **17 entries: 0 critical, 10 high, 7 moderate**; full audit
reports **19 entries: 0 critical, 12 high, 7 moderate**. These advisories keep the
overall result **FAIL**. Available updates for 17 packages and routine host
maintenance checks remain warnings. Discord accepted the full summary and the
outbox was empty afterward. Cleanup left no audit work directories, tool
directories or containers; the shared scheduler retained one managed entry and
seven existing jobs.
